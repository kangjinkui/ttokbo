import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/client";
import { migrate } from "../db/migrate";
import { seedIfEmpty } from "../db/seed";
import * as q from "../queue/service";
import { drainOutbox, pollDeliveries } from "./outbox";
import { solapiState, type DeliveryState, type MessagingProvider, type OutboundMessage } from "./provider";
import { formatKoreanDateTime, renderSms, TEMPLATES, toDomesticNumber } from "./templates";

describe("문자 문구 (똑닥식 대기순서 안내)", () => {
  it("접수일시를 '2026.11.03 (화) 오후 02:43' 형식으로 쓴다", () => {
    expect(formatKoreanDateTime(new Date("2026-11-03T14:43:00+09:00"))).toBe("2026.11.03 (화) 오후 02:43");
    expect(formatKoreanDateTime(new Date("2026-11-03T09:05:00+09:00"))).toBe("2026.11.03 (화) 오전 09:05");
  });

  it("번호 강조·목록·링크를 채운 장문 문자를 만든다", () => {
    const r = renderSms(
      "prepare",
      { 이름: "김민수", 대기번호: "23", 보고실: "행정국장실", 위치: "본관 5층 502호", 접수일시: "2026.11.03 (화) 오후 02:43", 앞건수: "3", 예상시간: "약 25분 후 호출 예상" },
      "https://ttokbo.example/c/abc",
    );
    expect(r.subject).toBe("[똑보] 23번 곧 차례예요");
    expect(r.text).toContain("[똑보] 현재 대기순서\n■ 23번");
    expect(r.text).toContain("- 접수일: 2026.11.03 (화) 오후 02:43");
    expect(r.text).toContain("내 앞에 3건 남았어요. (약 25분 후 호출 예상)");
    expect(r.text).toContain("▶ 실시간 대기순서\nhttps://ttokbo.example/c/abc");
    expect(r.text).not.toMatch(/#\{/);
    // LMS 한도(2,000바이트) 안
    expect(Buffer.byteLength(r.text, "utf8")).toBeLessThan(2000);
  });

  it("템플릿 변수는 서비스가 채우는 값만 쓴다 (보고 제목 변수 없음)", () => {
    const allowed = new Set(["이름", "대기번호", "보고실", "위치", "접수일시", "앞건수", "예상시간", "유예시간", "안내"]);
    for (const t of Object.values(TEMPLATES)) {
      for (const [, v] of `${t.subject}${t.headline}${t.emphasis}${t.body}`.matchAll(/#\{([^}]+)\}/g)) {
        expect(allowed.has(v)).toBe(true);
      }
    }
  });

  it("국내 번호 형식으로 바꾼다", () => {
    expect(toDomesticNumber("+821012345678")).toBe("01012345678");
  });

  it("솔라피 상태 코드: 4000 수신, 2000·3000 진행 중, 그 외 실패", () => {
    expect(solapiState("4000")).toEqual({ status: "delivered" });
    expect(solapiState("2000")).toEqual({ status: "pending" });
    expect(solapiState("3000")).toEqual({ status: "pending" });
    expect(solapiState("3059", "전송 실패")).toEqual({ status: "failed", reason: "3059 전송 실패" });
    expect(solapiState("1022", "발신번호 미등록")).toEqual({ status: "failed", reason: "1022 발신번호 미등록" });
    expect(solapiState(null)).toEqual({ status: "pending" });
  });
});

describe("문자 발송 흐름", () => {
  let db: Db;
  const sent: OutboundMessage[] = [];
  const states: Record<string, DeliveryState> = {};
  const provider: MessagingProvider = {
    name: "t",
    send: async (m) => (sent.push(m), { status: "sent", providerMessageId: `M${sent.length}` }),
    getStatuses: async (ids) => Object.fromEntries(ids.map((id) => [id, states[id] ?? { status: "pending" }])),
  };

  beforeEach(async () => {
    sent.length = 0;
    for (const k of Object.keys(states)) delete states[k];
    db = await createDb("memory");
    await migrate(db);
    await seedIfEmpty(db);
    await db.query(`INSERT INTO user_contacts VALUES (2, '+821011112222', now(), 'v1')`);
    await db.query(`INSERT INTO notification_prefs (user_id, sms_for_prepare) VALUES (2, true)`);
  });
  afterEach(async () => db.close());

  it("준비 문자에는 로그인 없이 대기순서를 보는 링크가 들어간다", async () => {
    await q.joinQueue(db, { id: 1, role: "staff" }, { roomId: 1, expectedMinutes: 10 });
    const { request } = await q.joinQueue(db, { id: 2, role: "staff" }, { roomId: 1, expectedMinutes: 10 });
    await drainOutbox(db, provider);
    const m = sent.find((s) => s.stage === "prepare")!;
    expect(m.sms.text).toContain(`■ ${request.ticket_no}번`);
    expect(m.sms.text).toContain("- 신청자: 이서연");
    const token = m.sms.parts.link!.url.split("/c/")[1];
    expect(await q.resolveCallToken(db, token)).toMatchObject({ kind: "view", valid: true, requestId: request.id });

    await q.cancelBySelf(db, { id: 2, role: "staff" }, request.id);
    expect((await q.resolveCallToken(db, token))?.valid).toBe(false);
  });

  it("상태 조회로 수신 완료·실패를 반영한다", async () => {
    await q.joinQueue(db, { id: 1, role: "staff" }, { roomId: 1, expectedMinutes: 10 });
    await q.joinQueue(db, { id: 2, role: "staff" }, { roomId: 1, expectedMinutes: 10 });
    await drainOutbox(db, provider);
    const status = async () => (await db.query<{ status: string; error: string | null }>(
      `SELECT status, error FROM notifications WHERE channel = 'sms' AND recipient_id = 2`)).rows[0];
    expect((await status()).status).toBe("sent");

    await pollDeliveries(db, provider); // 아직 전송 중
    expect((await status()).status).toBe("sent");

    states.M1 = { status: "failed", reason: "3059 전송 실패" };
    const fx = await pollDeliveries(db, provider);
    expect(await status()).toEqual({ status: "failed", error: "3059 전송 실패" });
    expect(fx.users.has(2)).toBe(true);
  });

  it("1시간 넘게 결과가 없으면 실패로 본다", async () => {
    await q.joinQueue(db, { id: 1, role: "staff" }, { roomId: 1, expectedMinutes: 10 });
    await q.joinQueue(db, { id: 2, role: "staff" }, { roomId: 1, expectedMinutes: 10 });
    await drainOutbox(db, provider);
    await db.query(`UPDATE notifications SET sent_at = now() - interval '2 hours' WHERE channel = 'sms'`);
    await pollDeliveries(db, provider);
    const { rows } = await db.query<{ status: string; error: string }>(`SELECT status, error FROM notifications WHERE channel = 'sms'`);
    expect(rows[0]).toEqual({ status: "failed", error: "TIMEOUT" });
  });
});
