import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getDb } from "./db";
import { QueueError, type Actor, type Role } from "./queue/types";

// 개발·시범용 세션. 실제 인증 방식(SSO 등)은 PRD §13에서 결정되면 이 파일만 교체한다.
export const SESSION_COOKIE = "tb_session";
const MAX_AGE = 60 * 60 * 12;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  // 기본값은 로컬 개발(next dev)·테스트에서만 허용한다. 시범·운영 서버는 반드시 설정한다.
  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") return "ttokbo-dev-secret";
  throw new Error("SESSION_SECRET is required outside local development");
}

function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export function encodeSession(userId: number) {
  const payload = `${userId}.${Math.floor(Date.now() / 1000) + MAX_AGE}`;
  return `${payload}.${sign(payload)}`;
}

function decodeSession(raw: string | undefined): number | null {
  if (!raw) return null;
  const [id, exp, sig] = raw.split(".");
  if (!id || !exp || !sig) return null;
  const expected = Buffer.from(sign(`${id}.${exp}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  return Number(id);
}

export interface SessionUser extends Actor {
  name: string;
  department: string | null;
  hasContact: boolean;
}

export async function currentUser(): Promise<SessionUser | null> {
  const userId = decodeSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId) return null;
  const db = await getDb();
  const { rows } = await db.query<{ id: number; role: Role; name: string; department: string | null; has_contact: boolean }>(
    `SELECT u.id, u.role, u.name, d.name AS department, (c.user_id IS NOT NULL) AS has_contact
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN user_contacts c ON c.user_id = u.id
      WHERE u.id = $1 AND u.active`,
    [userId],
  );
  const u = rows[0];
  return u ? { id: u.id, role: u.role, name: u.name, department: u.department, hasContact: u.has_contact } : null;
}

export async function requireUser(roles?: Role[]): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new QueueError("UNAUTHORIZED", "로그인이 필요합니다.", 401);
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
