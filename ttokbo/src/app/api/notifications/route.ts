import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, ok, readJson } from "@/lib/http";

/** 앱 내 알림 (최근 20건) */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT id, request_id AS "requestId", stage, title, body, link, created_at AS "createdAt", read_at AS "readAt"
         FROM notifications WHERE recipient_id = $1 AND channel = 'inapp'
        ORDER BY id DESC LIMIT 20`,
      [user.id],
    );
    return ok({ notifications: rows });
  });
}

/** 읽음 처리 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const { ids } = await readJson<{ ids: number[] }>(req);
    const db = await getDb();
    await db.query(
      `UPDATE notifications SET read_at = now() WHERE recipient_id = $1 AND id = ANY($2::int[]) AND read_at IS NULL`,
      [user.id, (ids ?? []).filter(Number.isInteger)],
    );
    return ok({ ok: true });
  });
}
