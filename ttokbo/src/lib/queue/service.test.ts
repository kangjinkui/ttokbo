import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/client";
import { migrate } from "../db/migrate";
import { seedIfEmpty } from "../db/seed";
import { estimateQueue } from "./estimate";
import * as q from "./service";
import type { Actor } from "./types";

const staff = (id: number): Actor => ({ id, role: "staff" });
const desk: Actor = { id: 11, role: "secretary" }; // 행정국장실(1) 담당
const otherDesk: Actor = { id: 12, role: "secretary" };
const ROOM = 1;

let db: Db;

beforeEach(async () => {
  db = await createDb("memory");
  await migrate(db);
  await seedIfEmpty(db);
});
afterEach(async () => db.close());

async function join(userId: number, minutes = 10) {
  return (await q.joinQueue(db, staff(userId), { roomId: ROOM, expectedMinutes: minutes })).request;
}

async function order() {
  const { rows } = await db.query<{ user_id: number }>(
    `SELECT user_id FROM requests WHERE room_id = $1 AND status IN ('waiting','called') ORDER BY position`, [ROOM]);
  return rows.map((r) => r.user_id);
}

async function notes(userId: number) {
  const { rows } = await db.query<{ stage: string; channel: string; status: string; body: string }>(
    `SELECT stage, channel, status, body FROM notifications WHERE recipient_id = $1 ORDER BY id`, [userId]);
  return rows;
}

describe("신청", () => {
  it("멱등 키가 같으면 여러 번 눌러도 한 건만 접수된다", async () => {
    const a = await q.joinQueue(db, staff(1), { roomId: ROOM, expectedMinutes: 10, idempotencyKey: "k1" });
    const b = await q.joinQueue(db, staff(1), { roomId: ROOM, expectedMinutes: 10, idempotencyKey: "k1" });
    expect(b.duplicate).toBe(true);
    expect(b.request.id).toBe(a.request.id);
    const { rows } = await db.query(`SELECT * FROM requests`);
    expect(rows).toHaveLength(1);
  });

  it("같은 보고실 활성 신청은 1인 1건이고 대기번호는 고유하게 증가한다", async () => {
    const a = await join(1);
    const b = await join(2);
    expect([a.ticket_no, b.ticket_no]).toEqual([1, 2]);
    await expect(join(1)).rejects.toMatchObject({ code: "ALREADY_ACTIVE" });
  });

  it("일시중지된 보고실은 설정에 따라 신규 접수를 막는다", async () => {
    await q.setRoomStatus(db, desk, ROOM, "paused");
    await expect(join(1)).rejects.toMatchObject({ code: "ROOM_PAUSED" });
    await db.query(`UPDATE rooms SET accepts_when_paused = true WHERE id = $1`, [ROOM]);
    await expect(join(1)).resolves.toBeTruthy();
  });
});

describe("권한·개인정보", () => {
  it("직원 홈에는 다른 직원의 이름·제목이 없다", async () => {
    await q.joinQueue(db, staff(1), { roomId: ROOM, expectedMinutes: 10, title: "예산 편성 보고(대외비)" });
    await join(2);
    const home = await q.staffHome(db, staff(2));
    const text = JSON.stringify(home);
    expect(text).not.toContain("김민수");
    expect(text).not.toContain("대외비");
    expect(home.rooms[0].myRequest).toMatchObject({ ticketNo: 2, ahead: 1 });
  });

  it("다른 직원의 신청은 조회·변경할 수 없다", async () => {
    const a = await join(1);
    await expect(q.myRequest(db, staff(2), a.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(q.cancelBySelf(db, staff(2), a.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("담당이 아닌 비서실은 대기열을 조작할 수 없다", async () => {
    await join(1);
    await expect(q.call(db, otherDesk, ROOM)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(q.deskView(db, staff(1), ROOM)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("현황판에는 번호만 나온다", async () => {
    await q.joinQueue(db, staff(1), { roomId: ROOM, expectedMinutes: 10, title: "비밀" });
    const text = JSON.stringify(await q.boardView(db, ROOM));
    expect(text).not.toContain("김민수");
    expect(text).not.toContain("비밀");
  });
});

describe("순서 미루기 (최대 5회)", () => {
  it("1~3칸 뒤로 이동하고 6번째는 거부된다", async () => {
    for (const id of [1, 2, 3, 4, 5, 6]) await join(id);
    const mine = (await db.query<{ id: number }>(`SELECT id FROM requests WHERE user_id = 1`)).rows[0].id;

    const r1 = await q.deferBySelf(db, staff(1), mine, 2);
    expect(r1.moved).toBe(2);
    expect(await order()).toEqual([2, 3, 1, 4, 5, 6]);

    // 남은 4회 사용 (마지막 순서에 닿으면 앞으로 다시 보내 횟수를 소모)
    for (let i = 0; i < 4; i++) {
      await db.query(`UPDATE requests SET position = 0 WHERE id = $1`, [mine]); // 테스트용으로 맨 앞에 둠
      await q.deferBySelf(db, staff(1), mine, 1);
    }
    await db.query(`UPDATE requests SET position = 0 WHERE id = $1`, [mine]);
    await expect(q.deferBySelf(db, staff(1), mine, 1)).rejects.toMatchObject({ code: "DEFER_LIMIT" });
  });

  it("마지막 순서에서는 미룰 수 없고 횟수도 쓰지 않는다", async () => {
    await join(1);
    const b = await join(2);
    await expect(q.deferBySelf(db, staff(2), b.id, 1)).rejects.toMatchObject({ code: "CANNOT_DEFER" });
    const d = await q.myRequest(db, staff(2), b.id);
    expect(d.request.defersLeft).toBe(5);
  });

  it("4칸 이상은 거부된다", async () => {
    const a = await join(1);
    await expect(q.deferBySelf(db, staff(1), a.id, 4)).rejects.toMatchObject({ code: "INVALID_STEPS" });
  });
});

describe("단계형 알림", () => {
  it("순번이 바뀔 때마다 알림이 쌓이지 않는다", async () => {
    for (const id of [1, 2, 3, 4, 5, 6]) await join(id);
    // 6번 직원: 앞 5건 → 준비 알림(기본 3건) 전
    expect(await notes(6)).toHaveLength(0);
    const first = (await db.query<{ id: number }>(`SELECT id FROM requests WHERE user_id = 1`)).rows[0].id;
    await q.call(db, desk, ROOM);
    await q.start(db, desk, first);
    await q.end(db, desk, first);
    const second = (await db.query<{ id: number }>(`SELECT id FROM requests WHERE user_id = 2`)).rows[0].id;
    await q.call(db, desk, ROOM);
    await q.start(db, desk, second);
    await q.end(db, desk, second);
    // 앞 3건이 되면 준비 알림 1회만
    const n6 = await notes(6);
    expect(n6.filter((n) => n.stage === "prepare")).toHaveLength(1);
    expect(n6.every((n) => n.channel === "inapp")).toBe(true); // 준비 알림 알림톡은 기본 꺼짐
  });

  it("다음 순서가 되면 임박 알림, 호출은 알림톡(연락처 없으면 skipped)으로 간다", async () => {
    const a = await join(1);
    expect((await notes(1)).map((n) => n.stage)).toEqual(["imminent"]);
    await q.call(db, desk, ROOM);
    const n = await notes(1);
    const call = n.filter((x) => x.stage === "call");
    expect(call.map((x) => [x.channel, x.status])).toEqual([["inapp", "delivered"], ["kakao", "skipped"]]);
    expect(call[0].body).not.toContain("제목");
    expect(a.id).toBeGreaterThan(0);
  });

  it("연락처가 있으면 호출 알림톡이 발송 대기(pending)로 쌓인다", async () => {
    await db.query(`INSERT INTO user_contacts VALUES (1, '+821012345678', now(), 'v1')`);
    await join(1);
    await q.call(db, desk, ROOM);
    const k = (await notes(1)).find((x) => x.stage === "call" && x.channel === "kakao");
    expect(k?.status).toBe("pending");
  });

  it("준비 알림 기준을 사용자가 바꿀 수 있다 (앞 1건)", async () => {
    await db.query(`INSERT INTO notification_prefs (user_id, prepare_value) VALUES (4, 1)`);
    for (const id of [1, 2, 3, 4]) await join(id);
    expect((await notes(4)).filter((n) => n.stage === "prepare")).toHaveLength(0);
  });
});

describe("비서실 운영", () => {
  it("긴급보고를 삽입해도 기존 신청이 유실되지 않고 밀린 직원은 변경 알림을 1회 받는다", async () => {
    for (const id of [1, 2, 3]) await join(id);
    await q.call(db, desk, ROOM); // 1번 호출 중
    await q.insertUrgent(db, desk, { roomId: ROOM, userId: 5, expectedMinutes: 5, reason: "민원 긴급 대응" });
    expect(await order()).toEqual([1, 5, 2, 3]);
    expect((await notes(2)).filter((n) => n.stage === "change")).toHaveLength(2); // inapp + kakao(skipped)
    expect((await notes(1)).filter((n) => n.stage === "change")).toHaveLength(0); // 호출 중인 사람은 안 밀림
  });

  it("순서를 바꾸면 관련 직원의 순번과 예상시각이 갱신된다", async () => {
    for (const id of [1, 2, 3]) await join(id, 10);
    const c = (await db.query<{ id: number }>(`SELECT id FROM requests WHERE user_id = 3`)).rows[0].id;
    await q.moveTo(db, desk, c, 0);
    expect(await order()).toEqual([3, 1, 2]);
    const d = await q.myRequest(db, staff(3), c);
    expect(d.ahead).toBe(0);
    expect(d.etaMinutes).toBe(0);
  });

  it("무응답이어도 자동 취소하지 않고, 다음 순번 먼저 처리 시 바로 뒤로 간다", async () => {
    for (const id of [1, 2]) await join(id);
    const { requestId } = await q.call(db, desk, ROOM);
    await db.query(`UPDATE requests SET call_expires_at = now() - interval '1 minute' WHERE id = $1`, [requestId]);
    const view = await q.deskView(db, desk, ROOM);
    expect(view.queue[0]).toMatchObject({ status: "called", noResponse: true });
    await q.skipNoResponse(db, desk, requestId);
    expect(await order()).toEqual([2, 1]);
    const d = await q.myRequest(db, staff(1), requestId);
    expect(d.request).toMatchObject({ status: "waiting", defersLeft: 5 });
  });

  it("비서실 취소는 사유와 함께 알림된다", async () => {
    const a = await join(1);
    await q.cancelByDesk(db, desk, a.id, "국장님 외부 일정");
    const change = (await notes(1)).filter((n) => n.stage === "change");
    expect(change[0].body).toContain("국장님 외부 일정");
  });

  it("종료 후 다음 호출을 한 번에 한다", async () => {
    const a = await join(1);
    await join(2);
    await q.call(db, desk, ROOM);
    await q.start(db, desk, a.id);
    const r = await q.end(db, desk, a.id, true);
    expect(r.next).not.toBeNull();
    const view = await q.deskView(db, desk, ROOM);
    expect(view.queue[0]).toMatchObject({ name: "이서연", status: "called" });
  });

  it("보고실 일시중지 시 대기열은 유지되고 예상시각은 '확인 중'(null)이 된다", async () => {
    const a = await join(1);
    await join(2);
    await q.setRoomStatus(db, desk, ROOM, "external", "구청장 회의");
    expect(await order()).toEqual([1, 2]);
    const d = await q.myRequest(db, staff(2), (await db.query<{ id: number }>(`SELECT id FROM requests WHERE user_id = 2`)).rows[0].id);
    expect(d.etaMinutes).toBeNull();
    expect((await notes(1)).some((n) => n.stage === "change")).toBe(true);
    expect(a.id).toBeGreaterThan(0);
  });

  it("호출·시작·종료 이력이 행위자와 함께 기록된다", async () => {
    const a = await join(1);
    await q.call(db, desk, ROOM);
    await q.start(db, desk, a.id);
    await q.end(db, desk, a.id);
    const { rows } = await db.query<{ to_status: string; actor_id: number }>(
      `SELECT to_status, actor_id FROM status_events WHERE request_id = $1 ORDER BY id`, [a.id]);
    expect(rows).toEqual([
      { to_status: "waiting", actor_id: 1 },
      { to_status: "called", actor_id: 11 },
      { to_status: "in_progress", actor_id: 11 },
      { to_status: "done", actor_id: 11 },
    ]);
  });
});

describe("호출 응답과 1회용 링크", () => {
  it("링크는 이번 호출에만 유효하다", async () => {
    await join(1);
    const first = await q.call(db, desk, ROOM);
    const token1 = first.link.split("/c/")[1];
    expect((await q.resolveCallToken(db, token1))?.valid).toBe(true);
    const second = await q.call(db, desk, ROOM, first.requestId); // 재호출
    expect((await q.resolveCallToken(db, token1))?.valid).toBe(false);
    expect((await q.resolveCallToken(db, second.link.split("/c/")[1]))?.valid).toBe(true);
    expect(await q.resolveCallToken(db, "nope")).toBeNull();
  });

  it("[5분 뒤 가능]은 유예시간을 늘리고 [이동 중]은 무응답 경고를 없앤다", async () => {
    await join(1);
    const { requestId } = await q.call(db, desk, ROOM);
    const before = (await db.query<{ call_expires_at: Date }>(`SELECT call_expires_at FROM requests WHERE id = $1`, [requestId])).rows[0];
    await q.respondToCall(db, staff(1), requestId, "delay_5", "link");
    const after = (await db.query<{ call_expires_at: Date }>(`SELECT call_expires_at FROM requests WHERE id = $1`, [requestId])).rows[0];
    expect(after.call_expires_at.getTime() - before.call_expires_at.getTime()).toBeGreaterThanOrEqual(5 * 60_000 - 1000);

    await q.respondToCall(db, staff(1), requestId, "on_way");
    await db.query(`UPDATE requests SET call_expires_at = now() - interval '1 minute' WHERE id = $1`, [requestId]);
    const view = await q.deskView(db, desk, ROOM);
    expect(view.queue[0]).toMatchObject({ noResponse: false, lastResponse: "on_way" });
  });
});

describe("예상시각 계산", () => {
  it("진행 중 잔여 + 앞선 보고 + 전환시간", () => {
    const now = new Date("2026-11-02T10:00:00+09:00");
    const est = estimateQueue(
      [{ id: 1, expectedMinutes: 10 }, { id: 2, expectedMinutes: 5 }],
      { expectedMinutes: 15, startedAt: new Date("2026-11-02T09:55:00+09:00") },
      { transitionMinutes: 1, certain: true, now },
    );
    expect(est).toEqual([
      { id: 1, ahead: 1, etaMinutes: 11 },
      { id: 2, ahead: 2, etaMinutes: 22 },
    ]);
  });

  it("예정보다 길어져도 잔여는 최소 1분", () => {
    const now = new Date("2026-11-02T10:30:00+09:00");
    const est = estimateQueue([{ id: 1, expectedMinutes: 10 }],
      { expectedMinutes: 10, startedAt: new Date("2026-11-02T10:00:00+09:00") },
      { transitionMinutes: 0, certain: true, now });
    expect(est[0].etaMinutes).toBe(1);
  });
});
