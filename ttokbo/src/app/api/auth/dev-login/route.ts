import { cookies } from "next/headers";
import { encodeSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, ok, readJson } from "@/lib/http";
import { QueueError } from "@/lib/queue/types";

// 개발·시범용 로그인. ALLOW_DEV_LOGIN=false면 막힌다 (실서비스는 SSO 연동으로 교체).
export async function POST(req: Request) {
  return handle(async () => {
    if (process.env.ALLOW_DEV_LOGIN === "false") throw new QueueError("DISABLED", "개발용 로그인이 비활성화되어 있습니다.", 403);
    const { userId } = await readJson<{ userId: number }>(req);
    const db = await getDb();
    const { rows } = await db.query<{ id: number; role: string }>(`SELECT id, role FROM users WHERE id = $1 AND active`, [userId]);
    if (!rows[0]) throw new QueueError("USER_NOT_FOUND", "사용자를 찾을 수 없습니다.", 404);
    (await cookies()).set(SESSION_COOKIE, encodeSession(rows[0].id), sessionCookieOptions);
    return ok({ role: rows[0].role });
  });
}
