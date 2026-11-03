import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/client";
import { migrate } from "../db/migrate";
import { seedIfEmpty } from "../db/seed";
import * as q from "../queue/service";
import { drainOutbox } from "./outbox";
import type { MessagingProvider, OutboundMessage } from "./provider";
import { formatKoreanDateTime, renderAlimtalk, TEMPLATES } from "./templates";

describe("알림톡 템플릿 (똑닥식 강조표기형)", () => {
  it("접수일시를 '2026.11.03 (화) 오후 02:43' 형식으로 쓴다", () => {
    expect(formatKoreanDateTime(new Date("2026-11-03T14:43:00+09:00"))).toBe("2026.11.03 (화) 오후 02:43");
    expect(formatKoreanDateTime(new Date("2026-11-03T09:05:00+09:00"))).toBe("2026.11.03 (화) 오전 09:05");
  });

  it("강조 제목·목록·버튼을 채우고, 문자 대체 본문에는 링크를 넣는다", () => {
    const r = renderAlimtalk(
      "prepare",
      { 이름: "김민수", 대기번호: "23", 보고실: "행정국장실", 위치: "본관 5층 502호", 접수일시: "2026.11.03 (화) 오후 02:43", 앞건수: "3", 예상시간: "약 25분 후 호출 예상" },
      "https://ttokbo.example/c/abc",
    );
    expect(r.emphasisSubtitle).toBe("현재 대기순서");
    expect(r.emphasisTitle).toBe("23번");
    expect(r.text).toContain("- 접수일: 2026.11.03 (화) 오후 02:43");
    expect(r.text).toContain("- 보고실: 행정국장실");
    expect(r.text).toContain("내 앞에 3건 남았어요. (약 25분 후 호출 예상)");
    expect(r.button).toEqual({ name: "실시간 대기순서 확인", url: "https://ttokbo.example/c/abc" });
    expect(r.smsText).toContain("실시간 대기순서 확인: https://ttokbo.example/c/abc");
    expect(r.text).not.toMatch(/#\{/);
  });

  it("모든 템플릿 변수는 서비스가 채우는 값만 쓴다 (보고 제목 변수 없음)", () => {
    const allowed = new Set(["이름", "대기번호", "보고실", "위치", "접수일시", "앞건수", "예상시간", "유예시간", "안내"]);
    for (const t of Object.values(TEMPLATES)) {
      for (const [, v] of `${t.emphasisSubtitle}${t.emphasisTitle}${t.body}${t.extra}`.matchAll(/#\{([^}]+)\}/g)) {
        expect(allowed.has(v)).toBe(true);
      }
    }
  });
});

describe("알림톡 발송 내용", () => {
  let db: Db;
  const sent: OutboundMessage[] = [];
  const provider: MessagingProvider = { name: "t", send: async (m) => (sent.push(m), { status: "delivered", providerMessageId: `m${sent.length}` }) };

  beforeEach(async () => {
    sent.length = 0;
    db = await createDb("memory");
    await migrate(db);
    await seedIfEmpty(db);
    await db.query(`INSERT INTO user_contacts VALUES (2, '+821011112222', now(), 'v1')`);
    await db.query(`INSERT INTO notification_prefs (user_id, kakao_for_prepare) VALUES (2, true)`);
  });
  afterEach(async () => db.close());

  it("준비 알림톡에는 로그인 없이 대기순서를 보는 링크가 달린다", async () => {
    await q.joinQueue(db, { id: 1, role: "staff" }, { roomId: 1, expectedMinutes: 10 });
    const { request } = await q.joinQueue(db, { id: 2, role: "staff" }, { roomId: 1, expectedMinutes: 10 });
    await drainOutbox(db, provider);
    const m = sent.find((s) => s.stage === "prepare")!;
    expect(m.alimtalk.emphasisTitle).toBe(`${request.ticket_no}번`);
    expect(m.alimtalk.text).toContain("- 신청자: 이서연");
    const token = m.alimtalk.button!.url.split("/c/")[1];
    const t = await q.resolveCallToken(db, token);
    expect(t).toMatchObject({ kind: "view", valid: true, requestId: request.id });

    // 신청이 끝나면 조회 링크도 무효
    await q.cancelBySelf(db, { id: 2, role: "staff" }, request.id);
    expect((await q.resolveCallToken(db, token))?.valid).toBe(false);
  });

  it("조회 링크로 연 상태에서 호출되면 그 회차로 응답할 수 있다", async () => {
    const { request } = await q.joinQueue(db, { id: 2, role: "staff" }, { roomId: 1, expectedMinutes: 10 });
    await db.query(`UPDATE notification_prefs SET kakao_for_imminent = true WHERE user_id = 2`);
    await q.cancelBySelf(db, { id: 2, role: "staff" }, request.id);
    const again = await q.joinQueue(db, { id: 2, role: "staff" }, { roomId: 1, expectedMinutes: 10 });
    await drainOutbox(db, provider);
    const token = sent.find((s) => s.stage === "imminent")!.alimtalk.button!.url.split("/c/")[1];
    await q.call(db, { id: 11, role: "secretary" }, 1);
    const t = (await q.resolveCallToken(db, token))!;
    expect(t).toMatchObject({ kind: "view", valid: true, callNo: 1 });
    await q.respondToCall(db, { id: 2, role: "staff" }, again.request.id, "on_way", "link", t.callNo);
  });
});
