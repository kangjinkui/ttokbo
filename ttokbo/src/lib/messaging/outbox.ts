import type { Db } from "../db/client";
import { Effects } from "../queue/types";
import type { MessagingProvider, Stage } from "./provider";
import { renderSms } from "./templates";

const MAX_ATTEMPTS = 3;

interface Pending {
  id: number;
  request_id: number | null;
  recipient_id: number;
  room_id: number | null;
  stage: Stage;
  dedupe_key: string;
  body: string;
  link: string | null;
  template_vars: Record<string, string> | null;
  attempts: number;
  phone: string | null;
  req_status: string | null;
  call_count: number | null;
}

/** 발송 시점에 이미 의미가 없어진 알림인지 (예: 호출 후 이미 보고 시작·취소·재호출됨) */
function staleReason(n: Pending): string | null {
  if (n.request_id == null) return null;
  if (n.stage === "call") {
    const callNo = Number(n.dedupe_key.split(":")[2]);
    if (n.req_status !== "called" || callNo !== n.call_count) return "STALE";
  }
  if ((n.stage === "prepare" || n.stage === "imminent") && n.req_status !== "waiting") return "STALE";
  return null;
}

/**
 * 문자 아웃박스를 한 번 비운다. 발송 결과에 따라 화면 갱신 대상을 Effects로 돌려준다.
 * 행을 'sent'로 먼저 표시하지 않고 시도 횟수만 올린 뒤 호출하므로, 실패하면 백오프 후 재시도한다.
 */
export async function drainOutbox(db: Db, provider: MessagingProvider, limit = 20): Promise<Effects> {
  const fx = new Effects();
  const { rows } = await db.query<Pending>(
    `SELECT n.id, n.request_id, n.recipient_id, r.room_id, n.stage, n.dedupe_key, n.body, n.link, n.template_vars,
            n.attempts, c.phone_e164 AS phone, r.status AS req_status, r.call_count
       FROM notifications n
       LEFT JOIN requests r ON r.id = n.request_id
       LEFT JOIN user_contacts c ON c.user_id = n.recipient_id
      WHERE n.channel = 'sms' AND n.status = 'pending' AND n.next_attempt_at <= now()
      ORDER BY n.id LIMIT $1`,
    [limit],
  );

  for (const n of rows) {
    if (n.room_id) fx.rooms.add(n.room_id);
    fx.users.add(n.recipient_id);
    const skip = !n.phone ? "NO_CONTACT" : staleReason(n);
    if (skip) {
      await db.query(`UPDATE notifications SET status = 'skipped', error = $2, link = NULL WHERE id = $1`, [n.id, skip]);
      continue;
    }
    // 잡은 행은 60초 동안 다른 워커가 다시 고르지 않는다 (임대). 응답 없이 죽으면 그 뒤 재시도된다.
    const claimed = await db.query(
      `UPDATE notifications SET attempts = attempts + 1, next_attempt_at = now() + interval '60 seconds'
        WHERE id = $1 AND status = 'pending' AND attempts = $2 RETURNING id`,
      [n.id, n.attempts],
    );
    if (!claimed.rows.length) continue;

    try {
      const result = await provider.send({
        idempotencyKey: n.dedupe_key,
        to: n.phone!, // NO_CONTACT는 위에서 걸러진다
        stage: n.stage,
        sms: renderSms(n.stage, n.template_vars ?? {}, n.link),
      });
      await db.query(
        `UPDATE notifications SET status = $2, provider_message_id = $3, sent_at = now(),
                delivered_at = CASE WHEN $2 = 'delivered' THEN now() END, error = NULL, link = NULL
          WHERE id = $1`,
        [n.id, result.status, result.providerMessageId],
      );
    } catch (err) {
      const attempts = n.attempts + 1;
      const message = err instanceof Error ? err.message : String(err);
      if (attempts >= MAX_ATTEMPTS) {
        await db.query(`UPDATE notifications SET status = 'failed', error = $2, link = NULL WHERE id = $1`, [n.id, message.slice(0, 500)]);
      } else {
        await db.query(
          `UPDATE notifications SET error = $2, next_attempt_at = now() + ($3 || ' seconds')::interval WHERE id = $1`,
          [n.id, message.slice(0, 500), String(10 * 2 ** attempts)],
        );
      }
    }
  }
  return fx;
}

/**
 * 접수(sent) 상태로 남은 문자의 수신 결과를 대행사에 물어 반영한다.
 * 구청 내부망처럼 웹훅을 받을 수 없어도 비서실 화면에 "도달/실패"가 뜨게 한다.
 */
export async function pollDeliveries(db: Db, provider: MessagingProvider): Promise<Effects> {
  const fx = new Effects();
  if (!provider.getStatuses) return fx;
  const { rows } = await db.query<{ provider_message_id: string; sent_at: Date }>(
    `SELECT provider_message_id, sent_at FROM notifications
      WHERE channel = 'sms' AND status = 'sent' AND provider_message_id IS NOT NULL
        AND sent_at > now() - interval '24 hours'
      ORDER BY id LIMIT 50`,
  );
  if (!rows.length) return fx;
  const states = await provider.getStatuses(rows.map((r) => r.provider_message_id));
  for (const r of rows) {
    const st = states[r.provider_message_id];
    if (!st) continue;
    if (st.status === "pending") {
      // 1시간이 지나도 결과가 없으면 실패로 보고 비서실이 전화하도록 한다
      if (Date.now() - r.sent_at.getTime() < 60 * 60_000) continue;
      merge(fx, await applyDeliveryReport(db, { providerMessageId: r.provider_message_id, status: "failed", error: "TIMEOUT" }));
      continue;
    }
    merge(fx, await applyDeliveryReport(db, {
      providerMessageId: r.provider_message_id,
      status: st.status,
      error: st.status === "failed" ? st.reason : undefined,
    }));
  }
  return fx;
}

function merge(into: Effects, from: Effects) {
  from.rooms.forEach((r) => into.rooms.add(r));
  from.users.forEach((u) => into.users.add(u));
}

/** 대행사 결과(웹훅·상태 조회) 반영 */
export async function applyDeliveryReport(
  db: Db,
  report: { providerMessageId: string; status: "delivered" | "failed"; error?: string },
): Promise<Effects> {
  const fx = new Effects();
  const { rows } = await db.query<{ recipient_id: number; room_id: number | null }>(
    `WITH updated AS (
       UPDATE notifications SET status = $2, error = $3,
              delivered_at = CASE WHEN $2 = 'delivered' THEN now() ELSE delivered_at END
        WHERE provider_message_id = $1 AND status = 'sent' -- 최종 상태는 되돌리지 않는다
        RETURNING recipient_id, request_id)
     SELECT u.recipient_id, r.room_id FROM updated u LEFT JOIN requests r ON r.id = u.request_id`,
    [report.providerMessageId, report.status, report.error ?? null],
  );
  for (const r of rows) {
    fx.users.add(r.recipient_id);
    if (r.room_id) fx.rooms.add(r.room_id);
  }
  return fx;
}
