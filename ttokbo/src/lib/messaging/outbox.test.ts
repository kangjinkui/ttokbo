import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/client";
import { migrate } from "../db/migrate";
import { seedIfEmpty } from "../db/seed";
import * as q from "../queue/service";
import { applyDeliveryReport, drainOutbox } from "./outbox";
import type { MessagingProvider, OutboundMessage } from "./provider";

let db: Db;
const desk = { id: 11, role: "secretary" as const };

beforeEach(async () => {
  db = await createDb("memory");
  await migrate(db);
  await seedIfEmpty(db);
  await db.query(`INSERT INTO user_contacts VALUES (1, '+821012345678', now(), 'v1')`);
  await q.joinQueue(db, { id: 1, role: "staff" }, { roomId: 1, expectedMinutes: 10, title: "대외비 제목" });
  await q.call(db, desk, 1);
});
afterEach(async () => db.close());

async function kakaoRow() {
  return (await db.query<{ status: string; attempts: number; error: string | null; provider_message_id: string | null }>(
    `SELECT status, attempts, error, provider_message_id FROM notifications WHERE channel = 'kakao' AND stage = 'call'`)).rows[0];
}

describe("알림톡 아웃박스", () => {
  it("호출 알림톡을 보내고 보고 제목은 넣지 않는다", async () => {
    const sent: OutboundMessage[] = [];
    const provider: MessagingProvider = { name: "t", send: async (m) => (sent.push(m), { status: "sent", providerMessageId: "m1" }) };
    const fx = await drainOutbox(db, provider);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "+821012345678", stage: "call" });
    expect(sent[0].alimtalk.button?.url).toMatch(/\/c\//);
    expect(JSON.stringify(sent[0])).not.toContain("대외비");
    expect(fx.rooms.has(1)).toBe(true);
    expect((await kakaoRow()).status).toBe("sent");

    // 웹훅으로 SMS 대체발송 결과 반영
    await applyDeliveryReport(db, { providerMessageId: "m1", status: "fallback_sms" });
    expect((await kakaoRow()).status).toBe("fallback_sms");
    const view = await q.deskView(db, desk, 1);
    expect(view.queue[0].delivery).toContainEqual(expect.objectContaining({ channel: "kakao", status: "fallback_sms" }));
  });

  it("두 번 비워도 한 번만 보낸다", async () => {
    let count = 0;
    const provider: MessagingProvider = { name: "t", send: async () => (count++, { status: "delivered", providerMessageId: "m" }) };
    await drainOutbox(db, provider);
    await drainOutbox(db, provider);
    expect(count).toBe(1);
  });

  it("실패하면 재시도하고 3회 후 failed로 남는다", async () => {
    const provider: MessagingProvider = { name: "t", send: async () => { throw new Error("timeout"); } };
    for (let i = 0; i < 3; i++) {
      await db.query(`UPDATE notifications SET next_attempt_at = now()`);
      await drainOutbox(db, provider);
    }
    expect(await kakaoRow()).toMatchObject({ status: "failed", attempts: 3, error: "timeout" });
  });
});
