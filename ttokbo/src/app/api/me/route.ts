import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, ok } from "@/lib/http";

export async function GET() {
  return handle(async () => {
    const user = await requireUser(undefined, { allowPending: true });
    const db = await getDb();
    const { rows: prefs } = await db.query(`SELECT * FROM notification_prefs WHERE user_id = $1`, [user.id]);
    const { rows: contact } = await db.query<{ phone_e164: string }>(`SELECT phone_e164 FROM user_contacts WHERE user_id = $1`, [user.id]);
    return ok({
      user,
      phone: contact[0]?.phone_e164 ?? null,
      prefs: prefs[0] ?? {
        prepare_enabled: true, prepare_by: "count", prepare_value: 3,
        imminent_enabled: true, sms_for_prepare: false, sms_for_imminent: false,
      },
    });
  });
}
