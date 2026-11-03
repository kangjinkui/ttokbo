import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, ok } from "@/lib/http";
import { renderSms, type Stage } from "@/lib/messaging/templates";

/**
 * 내 문자 알림 내역을 실제 발송 문구 그대로 돌려준다.
 * 링크(1회용 토큰)는 발송 후 DB에서 지우므로 내역에는 링크 이름만 남는다.
 */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const db = await getDb();
    const { rows } = await db.query<{
      id: number;
      stage: Stage;
      status: string;
      error: string | null;
      template_vars: Record<string, string> | null;
      created_at: Date;
    }>(
      `SELECT id, stage, status, error, template_vars, created_at FROM notifications
        WHERE recipient_id = $1 AND channel = 'sms' ORDER BY id DESC LIMIT 30`,
      [user.id],
    );
    return ok({
      provider: process.env.MESSAGING_PROVIDER ?? "console",
      messages: rows.map((r) => {
        const sms = renderSms(r.stage, r.template_vars ?? {}, "(발송 후 보안상 링크 삭제)");
        return { id: r.id, stage: r.stage, status: r.status, error: r.error, createdAt: r.created_at.toISOString(), ...sms };
      }),
    });
  });
}
