import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { handle, ok } from "@/lib/http";
import { QueueError } from "@/lib/queue/types";

// 개발용 로그인 화면의 사용자 목록
export async function GET() {
  return handle(async () => {
    await connection();
    if (process.env.ALLOW_DEV_LOGIN === "false") throw new QueueError("DISABLED", "개발용 로그인이 비활성화되어 있습니다.", 403);
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.role, d.name AS department FROM users u
         LEFT JOIN departments d ON d.id = u.department_id WHERE u.active ORDER BY u.role, u.id`);
    return ok({ users: rows });
  });
}
