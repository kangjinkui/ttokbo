import { cookies } from "next/headers";
import { encodeSession, RETURN_COOKIE, returnAdminId, SESSION_COOKIE, sessionCookieOptions, TEST_VIEW_COOKIE } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, ok } from "@/lib/http";
import { QueueError } from "@/lib/queue/types";

/** 시험 계정으로 보던 관리자가 자기 계정으로 돌아간다 */
export async function POST() {
  return handle(async () => {
    const jar = await cookies();
    const adminId = await returnAdminId();
    jar.delete(RETURN_COOKIE);
    jar.delete(TEST_VIEW_COOKIE);
    if (!adminId) throw new QueueError("NO_RETURN", "돌아갈 관리자 정보가 없습니다. 다시 로그인해 주세요.", 401);
    const { rows } = await (await getDb()).query(`SELECT 1 FROM users WHERE id = $1 AND role = 'admin' AND active AND approved`, [adminId]);
    if (!rows[0]) throw new QueueError("NO_RETURN", "관리자 계정을 쓸 수 없습니다. 다시 로그인해 주세요.", 401);
    jar.set(SESSION_COOKIE, encodeSession(adminId), sessionCookieOptions);
    return ok({ ok: true });
  });
}
