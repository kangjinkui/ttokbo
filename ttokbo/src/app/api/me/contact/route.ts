import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, ok, readJson } from "@/lib/http";
import { QueueError } from "@/lib/queue/types";

const CONSENT_VERSION = "2026-11-v1";

/** 010-1234-5678 → +821012345678 */
function toE164(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (/^01[016789]\d{7,8}$/.test(digits)) return `+82${digits.slice(1)}`;
  return null;
}

// 휴대폰번호 수집·이용 동의 (PRD §5.4.1). 알림톡·문자 호출에만 사용한다.
export async function PUT(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const { phone, consent } = await readJson<{ phone: string; consent: boolean }>(req);
    if (!consent) throw new QueueError("CONSENT_REQUIRED", "알림 수신을 위해 개인정보 수집·이용에 동의해 주세요.");
    const e164 = toE164(phone ?? "");
    if (!e164) throw new QueueError("INVALID_PHONE", "휴대폰번호 형식이 올바르지 않습니다.");
    const db = await getDb();
    await db.query(
      `INSERT INTO user_contacts (user_id, phone_e164, consent_at, consent_version) VALUES ($1,$2,now(),$3)
       ON CONFLICT (user_id) DO UPDATE SET phone_e164 = EXCLUDED.phone_e164, consent_at = now(), consent_version = EXCLUDED.consent_version`,
      [user.id, e164, CONSENT_VERSION],
    );
    return ok({ phone: e164 });
  });
}

/** 동의 철회: 번호를 지운다. 이후 알림톡은 발송되지 않는다. */
export async function DELETE() {
  return handle(async () => {
    const user = await requireUser();
    const db = await getDb();
    await db.query(`DELETE FROM user_contacts WHERE user_id = $1`, [user.id]);
    return ok({ phone: null });
  });
}
