// 휴대폰 문자 인증 로그인·가입·승인. 번호가 곧 로그인 아이디다.
// Next.js 의존 없이 DB와 문자 어댑터만 받아서 테스트할 수 있게 둔다 (쿠키 처리는 라우트에서).
import { randomInt } from "node:crypto";
import type { Db } from "./db/client";
import type { MessagingProvider } from "./messaging/provider";
import type { RenderedSms } from "./messaging/templates";
import { QueueError, type Role } from "./queue/types";

const CODE_TTL_MINUTES = 5;
const RESEND_SECONDS = 30;
const MAX_CODES_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;
export const CONSENT_VERSION = "2026-11-v1";

/** 010-1234-5678 → +821012345678. 휴대폰 번호가 아니면 null */
export function toE164(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (/^01[016789]\d{7,8}$/.test(digits)) return `+82${digits.slice(1)}`;
  return null;
}

export function requirePhone(raw: unknown) {
  const phone = typeof raw === "string" ? toE164(raw) : null;
  if (!phone) throw new QueueError("INVALID_PHONE", "휴대폰 번호를 확인해 주세요. (예: 010-1234-5678)");
  return phone;
}

/** 대기열 문구 틀을 쓰지 않는 짧은 안내 문자 */
function plainSms(subject: string, text: string): RenderedSms {
  return { subject, text, parts: { headline: subject, emphasis: "", body: text, link: null, footer: "" } };
}

/** 인증번호를 만들어 문자로 보낸다. hash는 서버 비밀값으로 서명하는 함수(auth.sign). */
export async function sendLoginCode(db: Db, provider: MessagingProvider, phone: string, hash: (s: string) => string) {
  const { rows } = await db.query<{ recent: number; last_hour: number }>(
    `SELECT count(*) FILTER (WHERE created_at > now() - make_interval(secs => $2))::int AS recent,
            count(*)::int AS last_hour
       FROM login_codes WHERE phone_e164 = $1 AND created_at > now() - interval '1 hour'`,
    [phone, RESEND_SECONDS],
  );
  if (rows[0].recent > 0) throw new QueueError("TOO_SOON", `인증번호를 방금 보냈어요. ${RESEND_SECONDS}초 뒤에 다시 받아 주세요.`, 429);
  if (rows[0].last_hour >= MAX_CODES_PER_HOUR) throw new QueueError("TOO_MANY_CODES", "인증번호를 너무 많이 요청했어요. 1시간 뒤에 다시 시도해 주세요.", 429);

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const { rows: inserted } = await db.query<{ id: number }>(
    `INSERT INTO login_codes (phone_e164, code_hash, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3)) RETURNING id`,
    [phone, hash(`${phone}:${code}`), CODE_TTL_MINUTES],
  );
  try {
    await provider.send({
      idempotencyKey: `login-code-${inserted[0].id}`,
      to: phone,
      stage: "account",
      sms: plainSms("[똑보] 인증번호", `[똑보] 인증번호 ${code}\n${CODE_TTL_MINUTES}분 안에 입력해 주세요.`),
    });
  } catch (err) {
    // 보내지 못한 번호는 재요청 제한에 걸리지 않게 지운다
    await db.query(`DELETE FROM login_codes WHERE id = $1`, [inserted[0].id]);
    console.error("[accounts] 인증번호 발송 실패", err);
    throw new QueueError("SMS_FAILED", "인증번호 문자를 보내지 못했어요. 잠시 뒤 다시 시도해 주세요.", 502);
  }
}

/** 인증번호를 확인한다. 맞으면 그 번호를 쓰는 사용자(없으면 null)를 돌려준다. */
export async function verifyLoginCode(db: Db, phone: string, code: string, hash: (s: string) => string) {
  const { rows } = await db.query<{ id: number; code_hash: string; attempts: number }>(
    `SELECT id, code_hash, attempts FROM login_codes
      WHERE phone_e164 = $1 AND used_at IS NULL AND expires_at > now() ORDER BY id DESC LIMIT 1`,
    [phone],
  );
  const row = rows[0];
  if (!row) throw new QueueError("CODE_EXPIRED", "인증번호가 만료되었어요. 다시 받아 주세요.");
  if (row.attempts >= MAX_ATTEMPTS) throw new QueueError("TOO_MANY_ATTEMPTS", "인증번호를 여러 번 틀렸어요. 새 인증번호를 받아 주세요.");
  if (hash(`${phone}:${String(code).trim()}`) !== row.code_hash) {
    await db.query(`UPDATE login_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
    const left = MAX_ATTEMPTS - row.attempts - 1;
    throw new QueueError("WRONG_CODE", left > 0 ? `인증번호가 맞지 않아요. (${left}번 더 시도할 수 있어요)` : "인증번호를 여러 번 틀렸어요. 새 인증번호를 받아 주세요.");
  }
  // 동시에 두 번 확인해도 한 번만 통과한다
  const { rows: used } = await db.query(`UPDATE login_codes SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id`, [row.id]);
  if (!used[0]) throw new QueueError("CODE_EXPIRED", "인증번호가 만료되었어요. 다시 받아 주세요.");

  const { rows: users } = await db.query<{ id: number; role: Role; active: boolean; approved: boolean }>(
    `SELECT u.id, u.role, u.active, u.approved FROM user_contacts c JOIN users u ON u.id = c.user_id WHERE c.phone_e164 = $1`,
    [phone],
  );
  return users[0] ?? null;
}

/** ADMIN_PHONES(쉼표 구분)에 있는 번호는 가입하면 바로 관리자가 된다. 첫 관리자를 만드는 용도. */
export function isAdminPhone(phone: string, env: Record<string, string | undefined> = process.env) {
  return (env.ADMIN_PHONES ?? "").split(",").map((p) => toE164(p.trim())).includes(phone);
}

export async function signUp(
  db: Db,
  input: { phone: string; name: unknown; departmentId: unknown; consent: unknown },
  env: Record<string, string | undefined> = process.env,
) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 2 || name.length > 20) throw new QueueError("INVALID_NAME", "이름을 2~20자로 입력해 주세요.");
  if (input.consent !== true) throw new QueueError("CONSENT_REQUIRED", "휴대폰 번호 수집·이용에 동의해 주세요.");
  const deptId = Number(input.departmentId);
  const { rows: dept } = await db.query(`SELECT 1 FROM departments WHERE id = $1`, [Number.isInteger(deptId) ? deptId : 0]);
  if (!dept[0]) throw new QueueError("INVALID_DEPARTMENT", "소속을 선택해 주세요.");

  const admin = isAdminPhone(input.phone, env);
  return db.transaction(async (tx) => {
    const { rows: taken } = await tx.query(`SELECT 1 FROM user_contacts WHERE phone_e164 = $1`, [input.phone]);
    if (taken[0]) throw new QueueError("PHONE_TAKEN", "이미 가입된 번호예요. 처음 화면에서 다시 로그인해 주세요.", 409);
    const { rows } = await tx.query<{ id: number; role: Role; approved: boolean }>(
      `INSERT INTO users (name, department_id, role, approved) VALUES ($1, $2, $3, $4) RETURNING id, role, approved`,
      [name, deptId, admin ? "admin" : "staff", admin],
    );
    await tx.query(`INSERT INTO user_contacts (user_id, phone_e164, consent_at, consent_version) VALUES ($1, $2, now(), $3)`,
      [rows[0].id, input.phone, CONSENT_VERSION]);
    return rows[0];
  });
}

/** 로그인한 사람의 번호를 인증된 새 번호로 바꾼다 */
export async function changePhone(db: Db, userId: number, phone: string) {
  const { rows } = await db.query(`SELECT user_id FROM user_contacts WHERE phone_e164 = $1 AND user_id <> $2`, [phone, userId]);
  if (rows[0]) throw new QueueError("PHONE_TAKEN", "다른 계정이 쓰고 있는 번호예요.", 409);
  await db.query(
    `INSERT INTO user_contacts (user_id, phone_e164, consent_at, consent_version) VALUES ($1, $2, now(), $3)
     ON CONFLICT (user_id) DO UPDATE SET phone_e164 = EXCLUDED.phone_e164, consent_at = now(), consent_version = EXCLUDED.consent_version`,
    [userId, phone, CONSENT_VERSION],
  );
}

// ── 관리자 ──────────────────────────────────────────────

export interface AdminUserRow {
  id: number;
  name: string;
  role: Role;
  department: string | null;
  department_id: number | null;
  phone: string | null;
  active: boolean;
  approved: boolean;
  created_at: Date;
  room_ids: number[];
}

export async function listUsers(db: Db) {
  const { rows } = await db.query<AdminUserRow>(
    `SELECT u.id, u.name, u.role, d.name AS department, u.department_id, c.phone_e164 AS phone, u.active, u.approved, u.created_at,
            COALESCE(array_agg(m.room_id ORDER BY m.room_id) FILTER (WHERE m.room_id IS NOT NULL), '{}') AS room_ids
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN user_contacts c ON c.user_id = u.id
       LEFT JOIN room_managers m ON m.user_id = u.id
      GROUP BY u.id, d.name, c.phone_e164
      ORDER BY u.approved, u.created_at DESC, u.id`,
  );
  return rows;
}

const ROLES: Role[] = ["staff", "executive", "secretary", "admin"];

export type AdminAction =
  | { action: "approve" }
  | { action: "reject" }
  | { action: "block" }
  | { action: "unblock" }
  | { action: "setRole"; role: Role; roomIds?: number[] };

export async function adminUpdateUser(db: Db, provider: MessagingProvider, adminId: number, userId: number, body: AdminAction, appUrl = process.env.APP_BASE_URL) {
  const { rows } = await db.query<{ id: number; approved: boolean; phone: string | null }>(
    `SELECT u.id, u.approved, c.phone_e164 AS phone FROM users u LEFT JOIN user_contacts c ON c.user_id = u.id WHERE u.id = $1`,
    [userId],
  );
  const user = rows[0];
  if (!user) throw new QueueError("USER_NOT_FOUND", "사용자를 찾을 수 없습니다.", 404);
  if (userId === adminId && body.action !== "approve") throw new QueueError("SELF_CHANGE", "자기 계정은 바꿀 수 없습니다. 다른 관리자에게 요청하세요.");

  switch (body.action) {
    case "approve": {
      if (user.approved) return;
      await db.query(`UPDATE users SET approved = true WHERE id = $1`, [userId]);
      if (user.phone) {
        // 승인 안내 문자는 실패해도 승인 자체는 유지한다
        await provider
          .send({
            idempotencyKey: `approved-${userId}`,
            to: user.phone,
            stage: "account",
            sms: plainSms("[똑보] 가입 승인", `[똑보] 가입이 승인되었어요. 이제 보고 줄서기를 할 수 있어요.${appUrl ? `\n${appUrl}` : ""}`),
          })
          .catch((err) => console.error("[accounts] 승인 안내 문자 실패", err));
      }
      return;
    }
    case "reject": {
      if (user.approved) throw new QueueError("ALREADY_APPROVED", "이미 승인된 사용자는 거절할 수 없습니다. 차단을 사용하세요.");
      // 승인 전 사용자는 줄을 선 적이 없으므로 지운다 (번호를 잘못 넣었으면 다시 가입할 수 있게)
      await db.transaction(async (tx) => {
        await tx.query(`DELETE FROM notification_prefs WHERE user_id = $1`, [userId]);
        await tx.query(`DELETE FROM user_contacts WHERE user_id = $1`, [userId]);
        await tx.query(`DELETE FROM users WHERE id = $1 AND NOT approved`, [userId]);
      });
      return;
    }
    case "block":
    case "unblock":
      await db.query(`UPDATE users SET active = $2 WHERE id = $1`, [userId, body.action === "unblock"]);
      return;
    case "setRole": {
      if (!ROLES.includes(body.role)) throw new QueueError("BAD_ROLE", "역할 값이 올바르지 않습니다.");
      const roomIds = body.role === "secretary" ? [...new Set((body.roomIds ?? []).map(Number))] : [];
      await db.transaction(async (tx) => {
        if (roomIds.length) {
          const { rows: found } = await tx.query(`SELECT id FROM rooms WHERE id = ANY($1::int[])`, [roomIds]);
          if (found.length !== roomIds.length) throw new QueueError("ROOM_NOT_FOUND", "보고실을 찾을 수 없습니다.", 404);
        }
        await tx.query(`UPDATE users SET role = $2 WHERE id = $1`, [userId, body.role]);
        await tx.query(`DELETE FROM room_managers WHERE user_id = $1`, [userId]);
        for (const roomId of roomIds) await tx.query(`INSERT INTO room_managers (room_id, user_id) VALUES ($1, $2)`, [roomId, userId]);
      });
      return;
    }
    default:
      throw new QueueError("BAD_ACTION", "알 수 없는 동작입니다.");
  }
}
