// 코드 리뷰 지적사항 회귀 테스트
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/client";
import { migrate } from "../db/migrate";
import { seedIfEmpty } from "../db/seed";
import { applyDeliveryReport, drainOutbox } from "../messaging/outbox";
import type { MessagingProvider, OutboundMessage } from "../messaging/provider";
import * as q from "./service";
import type { Actor } from "./types";

const staff = (id: number): Actor => ({ id, role: "staff" });
const desk: Actor = { id: 11, role: "secretary" };
const ROOM = 1;
let db: Db;

beforeEach(async () => {
  db = await createDb("memory");
  await migrate(db);
  await seedIfEmpty(db);
});
afterEach(async () => db.close());

const join = async (u: number) => (await q.joinQueue(db, staff(u), { roomId: ROOM, expectedMinutes: 10 })).request;
const order = async () =>
  (await db.query<{ user_id: number }>(
    `SELECT user_id FROM requests WHERE room_id = $1 AND status IN ('waiting','called') ORDER BY position`, [ROOM])).rows.map((r) => r.user_id);
const capture = () => {
  const sent: OutboundMessage[] = [];
  const provider: MessagingProvider = { name: "t", send: async (m) => (sent.push(m), { status: "sent", providerMessageId: `m${sent.length}` }) };
  return { sent, provider };
};

describe("#2 중복 호출 방지", () => {
  it("호출 중인 사람이 있으면 [다음 순번 호출]이 두 번째 사람을 부르지 않는다", async () => {
    await join(1);
    await join(2);
    await q.call(db, desk, ROOM);
    await expect(q.call(db, desk, ROOM)).rejects.toMatchObject({ code: "ALREADY_CALLED" });
    const { rows } = await db.query(`SELECT 1 FROM requests WHERE status = 'called'`);
    expect(rows).toHaveLength(1);
  });

  it("[종료 후 다음 호출]도 이미 호출된 사람이 있으면 추가로 부르지 않는다", async () => {
    const a = await join(1);
    await join(2);
    await join(3);
    await q.call(db, desk, ROOM);
    await q.start(db, desk, a.id);
    await q.call(db, desk, ROOM); // 2번을 미리 호출
    const r = await q.end(db, desk, a.id, true);
    expect(r.next).toBeNull();
  });
});

describe("#3 날짜 넘김", () => {
  it("지난 날짜 대기는 마감 처리되고 오늘 다시 줄설 수 있으며 번호가 겹치지 않는다", async () => {
    const a = await join(1);
    await db.query(`UPDATE requests SET service_date = service_date - 1 WHERE id = $1`, [a.id]);
    const b = await join(1);
    expect(b.ticket_no).toBe(1);
    const old = (await db.query<{ status: string; cancel_reason: string }>(`SELECT status, cancel_reason FROM requests WHERE id = $1`, [a.id])).rows[0];
    expect(old).toEqual({ status: "cancelled", cancel_reason: "closed" });
    expect(await order()).toEqual([1]);
  });

  it("워커용 closePreviousDays가 모든 보고실을 정리한다", async () => {
    const a = await join(1);
    await db.query(`UPDATE requests SET service_date = service_date - 1`);
    const fx = await q.closePreviousDays(db);
    expect(fx.rooms.has(ROOM)).toBe(true);
    expect((await db.query<{ status: string }>(`SELECT status FROM requests WHERE id = $1`, [a.id])).rows[0].status).toBe("cancelled");
  });
});

describe("#1 #16 1회용 링크", () => {
  it("응답 시 링크 회차를 잠금 안에서 다시 확인한다", async () => {
    const a = await join(1);
    await q.call(db, desk, ROOM);
    await q.call(db, desk, ROOM, a.id); // 재호출 → 2회차
    await expect(q.respondToCall(db, staff(1), a.id, "on_way", "link", 1)).rejects.toMatchObject({ code: "LINK_EXPIRED" });
    await expect(q.respondToCall(db, staff(1), a.id, "on_way", "link", 2)).resolves.toBeTruthy();
  });

  it("만료된 토큰은 상태만 알려준다", async () => {
    const a = await join(1);
    const { link } = await q.call(db, desk, ROOM);
    await q.start(db, desk, a.id);
    const t = await q.resolveCallToken(db, link.split("/c/")[1]);
    expect(t).toMatchObject({ valid: false, status: "in_progress" });
  });
});

describe("#7 5분 뒤 가능은 호출당 1회", () => {
  it("두 번째는 거부된다", async () => {
    const a = await join(1);
    await q.call(db, desk, ROOM);
    await q.respondToCall(db, staff(1), a.id, "delay_5");
    await expect(q.respondToCall(db, staff(1), a.id, "delay_5")).rejects.toMatchObject({ code: "DELAY_USED" });
  });
});

describe("#4 #12 #13 #15 알림톡 아웃박스", () => {
  beforeEach(async () => {
    await db.query(`INSERT INTO user_contacts VALUES (1, '+821012345678', now(), 'v1')`);
  });

  it("발송 전에 이미 보고가 시작됐으면 호출 알림톡을 보내지 않는다", async () => {
    const a = await join(1);
    await q.call(db, desk, ROOM);
    await q.start(db, desk, a.id);
    const { sent, provider } = capture();
    await drainOutbox(db, provider);
    expect(sent).toHaveLength(0);
    const row = (await db.query<{ status: string; error: string }>(`SELECT status, error FROM notifications WHERE channel = 'kakao' AND stage = 'call'`)).rows[0];
    expect(row).toEqual({ status: "skipped", error: "STALE" });
  });

  it("SMS 대체 문구에 응답 링크가 있고, 발송 뒤 링크(토큰)는 DB에 남지 않는다", async () => {
    await join(1);
    await q.call(db, desk, ROOM);
    const { sent, provider } = capture();
    await drainOutbox(db, provider);
    expect(sent[0].alimtalk.smsText).toMatch(/지금 응답하기: http.*\/c\//);
    const { rows } = await db.query(`SELECT link FROM notifications WHERE link IS NOT NULL`);
    expect(rows).toHaveLength(0);
  });

  it("늦게 온 실패 웹훅이 도달 상태를 덮어쓰지 않는다", async () => {
    await join(1);
    await q.call(db, desk, ROOM);
    const { provider } = capture();
    await drainOutbox(db, provider);
    await applyDeliveryReport(db, { providerMessageId: "m1", status: "delivered" });
    await applyDeliveryReport(db, { providerMessageId: "m1", status: "failed", error: "late" });
    const row = (await db.query<{ status: string }>(`SELECT status FROM notifications WHERE provider_message_id = 'm1'`)).rows[0];
    expect(row.status).toBe("delivered");
  });
});

describe("#8 #9 #10 #17 #18 대기열 규칙", () => {
  it("호출된 건이 맨 앞이 아니어도 보류 해제는 호출 건 바로 뒤로 간다", async () => {
    for (const u of [1, 2, 3]) await join(u);
    const c = (await db.query<{ id: number }>(`SELECT id FROM requests WHERE user_id = 3`)).rows[0].id;
    const h = (await db.query<{ id: number }>(`SELECT id FROM requests WHERE user_id = 1`)).rows[0].id;
    await q.call(db, desk, ROOM, c); // [1, 2, 3(호출)]
    await q.hold(db, desk, h, "자료 보완");
    await q.resume(db, desk, h);
    expect(await order()).toEqual([2, 3, 1]);
  });

  it("보고 재개 시 대기자와 보류자에게 안내한다", async () => {
    const a = await join(1);
    const b = await join(2);
    await q.hold(db, desk, b.id, "");
    await q.setRoomStatus(db, desk, ROOM, "paused", "회의");
    await q.setRoomStatus(db, desk, ROOM, "open");
    for (const id of [a.user_id, b.user_id]) {
      const { rows } = await db.query<{ body: string }>(
        `SELECT body FROM notifications WHERE recipient_id = $1 AND stage = 'change' AND channel = 'inapp'`, [id]);
      expect(rows.some((r) => r.body.includes("재개"))).toBe(true);
    }
  });

  it("임박 알림을 꺼도 준비 알림은 온다", async () => {
    await db.query(`INSERT INTO notification_prefs (user_id, imminent_enabled) VALUES (1, false)`);
    await join(1);
    const { rows } = await db.query<{ stage: string }>(`SELECT stage FROM notifications WHERE recipient_id = 1`);
    expect(rows.map((r) => r.stage)).toEqual(["prepare"]);
  });

  it("잘못된 위치·사용자 입력은 거부된다", async () => {
    const a = await join(1);
    await expect(q.moveTo(db, desk, a.id, Number.NaN)).rejects.toMatchObject({ code: "BAD_PARAM" });
    await expect(q.insertUrgent(db, desk, { roomId: ROOM, userId: 41, expectedMinutes: 5, reason: "x" })).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
    await expect(q.insertUrgent(db, desk, { roomId: ROOM, userId: 9999, expectedMinutes: 5, reason: "x" })).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
    await expect(q.joinQueue(db, staff(2), { roomId: ROOM, expectedMinutes: 5, title: 123 as never })).rejects.toMatchObject({ code: "INVALID_TITLE" });
  });
});
