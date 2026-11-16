import { cookies } from "next/headers";
import { assertTestAccount } from "@/lib/accounts";
import {
  encodeSession, requireUser, RETURN_COOKIE, SESSION_COOKIE, sessionCookieOptions, TEST_VIEW_COOKIE, testViewCookieOptions,
} from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, ok, readJson } from "@/lib/http";

/** 관리자가 시험 계정으로 전환한다. 실제 사용자 계정으로는 전환할 수 없다. */
export async function POST(req: Request) {
  return handle(async () => {
    const admin = await requireUser(["admin"]);
    const { userId } = await readJson<{ userId: number }>(req);
    const db = await getDb();
    const target = await assertTestAccount(db, Number(userId));
    const { rows } = await db.query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [Number(userId)]);
    const jar = await cookies();
    jar.set(RETURN_COOKIE, encodeSession(admin.id), { ...sessionCookieOptions, maxAge: testViewCookieOptions.maxAge });
    jar.set(TEST_VIEW_COOKIE, encodeURIComponent(rows[0].name), testViewCookieOptions);
    jar.set(SESSION_COOKIE, encodeSession(Number(userId)), sessionCookieOptions);
    return ok({ role: target.role });
  });
}
