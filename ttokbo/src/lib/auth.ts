import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getDb } from "./db";
import { QueueError, type Actor, type Role } from "./queue/types";

// 서명 쿠키 세션. 로그인은 휴대폰 문자 인증(phone-auth.ts)으로 하고, 한 번 로그인하면 30일 유지한다.
export const SESSION_COOKIE = "tb_session";
const MAX_AGE = 60 * 60 * 24 * 30;
/** 인증번호 확인을 마친 휴대폰 번호 (가입·번호 변경 단계에서만 쓴다) */
export const PHONE_TICKET_COOKIE = "tb_phone";
const PHONE_TICKET_MAX_AGE = 60 * 15;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  // 기본값은 로컬 개발(next dev)·테스트에서만 허용한다. 시범·운영 서버는 반드시 설정한다.
  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") return "ttokbo-dev-secret";
  throw new Error("SESSION_SECRET is required outside local development");
}

export function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

/** "값.만료시각.서명" 형식을 검증하고 값 부분을 돌려준다 */
function verifySigned(raw: string | undefined): string | null {
  if (!raw) return null;
  const i = raw.lastIndexOf(".");
  if (i < 0) return null;
  const payload = raw.slice(0, i);
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(raw.slice(i + 1));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const j = payload.lastIndexOf(".");
  if (j < 0 || Number(payload.slice(j + 1)) < Date.now() / 1000) return null;
  return payload.slice(0, j);
}

export function encodeSession(userId: number) {
  const payload = `${userId}.${Math.floor(Date.now() / 1000) + MAX_AGE}`;
  return `${payload}.${sign(payload)}`;
}

function decodeSession(raw: string | undefined): number | null {
  const id = verifySigned(raw);
  return id && /^\d+$/.test(id) ? Number(id) : null;
}

export function encodePhoneTicket(phone: string) {
  const payload = `${phone}.${Math.floor(Date.now() / 1000) + PHONE_TICKET_MAX_AGE}`;
  return `${payload}.${sign(payload)}`;
}

/** 인증번호 확인을 마친 번호. 없거나 만료되면 null */
export async function verifiedPhone(): Promise<string | null> {
  const phone = verifySigned((await cookies()).get(PHONE_TICKET_COOKIE)?.value);
  return phone && /^\+\d+$/.test(phone) ? phone : null;
}

export const phoneTicketCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/api/",
  maxAge: PHONE_TICKET_MAX_AGE,
};

export interface SessionUser extends Actor {
  name: string;
  department: string | null;
  hasContact: boolean;
  /** 스스로 가입한 사람은 관리자 승인 전까지 false */
  approved: boolean;
}

export async function currentUser(): Promise<SessionUser | null> {
  const userId = decodeSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId) return null;
  const db = await getDb();
  const { rows } = await db.query<{ id: number; role: Role; name: string; department: string | null; has_contact: boolean; approved: boolean }>(
    `SELECT u.id, u.role, u.name, d.name AS department, (c.user_id IS NOT NULL) AS has_contact, u.approved
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN user_contacts c ON c.user_id = u.id
      WHERE u.id = $1 AND u.active`,
    [userId],
  );
  const u = rows[0];
  return u ? { id: u.id, role: u.role, name: u.name, department: u.department, hasContact: u.has_contact, approved: u.approved } : null;
}

export async function requireUser(roles?: Role[], opts: { allowPending?: boolean } = {}): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new QueueError("UNAUTHORIZED", "로그인이 필요합니다.", 401);
  if (!user.approved && !opts.allowPending) throw new QueueError("PENDING_APPROVAL", "관리자 승인을 기다리고 있습니다.", 403);
  if (roles && !roles.includes(user.role)) throw new QueueError("FORBIDDEN", "권한이 없습니다.", 403);
  return user;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE,
};
