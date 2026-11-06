import { getDb } from "@/lib/db";
import { handle, ok } from "@/lib/http";

/** 가입 화면의 소속 선택용 조직도 (국 → 과) */
export async function GET() {
  return handle(async () => {
    const db = await getDb();
    const { rows } = await db.query<{ id: number; name: string; parent_id: number | null }>(
      `SELECT id, name, parent_id FROM departments ORDER BY id`);
    const bureaus = rows.filter((d) => d.parent_id == null).map((b) => ({
      id: b.id,
      name: b.name,
      teams: rows.filter((t) => t.parent_id === b.id).map((t) => ({ id: t.id, name: t.name })),
    }));
    return ok({ bureaus });
  });
}
