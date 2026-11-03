import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, ok, readJson } from "@/lib/http";
import { QueueError } from "@/lib/queue/types";

interface Prefs {
  prepare_enabled: boolean;
  prepare_by: "count" | "minutes";
  prepare_value: number;
  imminent_enabled: boolean;
  kakao_for_prepare: boolean;
  kakao_for_imminent: boolean;
}

export async function PUT(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const p = await readJson<Prefs>(req);
    const valid =
      (p.prepare_by === "count" && Number.isInteger(p.prepare_value) && p.prepare_value >= 1 && p.prepare_value <= 5) ||
      (p.prepare_by === "minutes" && Number.isInteger(p.prepare_value) && p.prepare_value >= 5 && p.prepare_value <= 30);
    if (!valid) throw new QueueError("INVALID_PREFS", "준비 알림 기준은 앞 1~5건 또는 5~30분이어야 합니다.");
    const db = await getDb();
    await db.query(
      `INSERT INTO notification_prefs (user_id, prepare_enabled, prepare_by, prepare_value, imminent_enabled, kakao_for_prepare, kakao_for_imminent)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id) DO UPDATE SET prepare_enabled = $2, prepare_by = $3, prepare_value = $4,
         imminent_enabled = $5, kakao_for_prepare = $6, kakao_for_imminent = $7`,
      [user.id, !!p.prepare_enabled, p.prepare_by, p.prepare_value, !!p.imminent_enabled, !!p.kakao_for_prepare, !!p.kakao_for_imminent],
    );
    return ok({ ok: true });
  });
}
