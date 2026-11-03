import type { Tx } from "../db/client";
import { formatKoreanDateTime } from "../messaging/templates";
import type { Effects } from "./types";

export type Stage = "prepare" | "imminent" | "call" | "change";

export interface Message {
  title: string;
  body: string;
  link?: string;
  /** 문자 문구 치환값. 보고 제목은 절대 넣지 않는다 (PRD §5.4.1). */
  vars: Record<string, string>;
}

/**
 * 알림을 아웃박스에 쌓는다. dedupeKey가 같으면 다시 쌓지 않으므로
 * 같은 단계 알림이 순번 변동마다 반복되지 않는다.
 */
export async function enqueue(
  tx: Tx,
  fx: Effects,
  args: {
    requestId: number | null;
    recipientId: number;
    stage: Stage;
    dedupeKey: string;
    inapp: boolean;
    sms: boolean;
    message: Message;
    /** 문자 링크가 없을 때 만들 함수 (실제 발송할 때만 토큰을 발급) */
    smsLink?: () => Promise<string>;
  },
) {
  const { requestId, recipientId, stage, dedupeKey, message } = args;
  const channels: ("inapp" | "sms")[] = [];
  if (args.inapp) channels.push("inapp");
  if (args.sms) channels.push("sms");

  for (const channel of channels) {
    let status = channel === "inapp" ? "delivered" : "pending";
    let error: string | null = null;
    if (channel === "sms") {
      const { rows } = await tx.query(`SELECT 1 FROM user_contacts WHERE user_id = $1`, [recipientId]);
      if (rows.length === 0) {
        status = "skipped";
        error = "NO_CONTACT";
      }
    }
    let link: string | null = null;
    if (channel === "sms" && status === "pending") {
      const { rows: dup } = await tx.query(`SELECT 1 FROM notifications WHERE dedupe_key = $1`, [`${dedupeKey}:sms`]);
      if (dup.length) continue;
      link = message.link ?? (args.smsLink ? await args.smsLink() : null);
    }
    const { rows } = await tx.query(
      `INSERT INTO notifications
         (request_id, recipient_id, stage, channel, dedupe_key, title, body, link, template_vars, status, error,
          sent_at, delivered_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
               CASE WHEN $4 = 'inapp' THEN now() END, CASE WHEN $4 = 'inapp' THEN now() END)
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING id`,
      [requestId, recipientId, stage, channel, `${dedupeKey}:${channel}`, message.title, message.body,
       link, JSON.stringify(message.vars), status, error],
    );
    if (rows.length === 0) continue;
    fx.users.add(recipientId);
    if (status === "pending") fx.outbox = true;
  }
}

/** 모든 문자 문구에 공통으로 들어가는 값 (똑닥식 "- 접수일 / - 보고실 …" 목록) */
export interface MessageBase {
  name: string;
  room: { name: string; location: string };
  ticket: number;
  createdAt: Date;
}

function baseVars(b: MessageBase): Record<string, string> {
  return {
    이름: b.name,
    대기번호: String(b.ticket),
    보고실: b.room.name,
    위치: b.room.location || "-",
    접수일시: formatKoreanDateTime(b.createdAt),
  };
}

export const messages = {
  prepare: (b: MessageBase, v: { ahead: number; eta: number | null }): Message => ({
    title: `${b.room.name} 곧 차례입니다`,
    body: `${b.name}님, 앞에 ${v.ahead}건 남았습니다${v.eta != null ? ` (약 ${v.eta}분)` : ""}. 준비해 주세요.`,
    vars: { ...baseVars(b), 앞건수: String(v.ahead), 예상시간: v.eta != null ? `약 ${v.eta}분 후 호출 예상` : "예상시간 확인 중" },
  }),
  imminent: (b: MessageBase): Message => ({
    title: `${b.room.name} 다음 순서입니다`,
    body: `${b.name}님, 다음 순서입니다. 자리에서 출발할 준비를 해 주세요.`,
    vars: baseVars(b),
  }),
  call: (b: MessageBase, v: { grace: number; link: string }): Message => ({
    title: `[똑보] ${b.room.name} 보고 차례입니다`,
    body: `${b.name}님, ${b.room.name}(${b.room.location}) 보고 차례입니다.\n대기번호: ${b.ticket}\n${v.grace}분 안에 응답해 주세요.`,
    link: v.link,
    vars: { ...baseVars(b), 유예시간: String(v.grace) },
  }),
  change: (b: MessageBase, v: { reason: string }): Message => ({
    title: `[똑보] ${b.room.name} 대기 변경 안내`,
    body: `${b.name}님, ${v.reason}`,
    vars: { ...baseVars(b), 안내: v.reason },
  }),
};
