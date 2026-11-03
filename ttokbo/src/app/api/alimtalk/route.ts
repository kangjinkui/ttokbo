import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, ok } from "@/lib/http";
import { renderAlimtalk, TEMPLATES, type Stage } from "@/lib/messaging/templates";

/**
 * 내 알림톡 내역을 실제 발송 형태(강조표기·목록·버튼)로 돌려준다.
 * 대행사 계약 전에는 이 화면이 "카톡에 이렇게 온다"를 확인하는 곳이다.
 * 버튼 링크(1회용 토큰)는 발송 후 DB에서 지우므로 내역에는 버튼 이름만 남는다.
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
        WHERE recipient_id = $1 AND channel = 'kakao' ORDER BY id DESC LIMIT 30`,
      [user.id],
    );
    return ok({
      messages: rows.map((r) => {
        const rendered = renderAlimtalk(r.stage, r.template_vars ?? {}, null);
        return {
          id: r.id,
          stage: r.stage,
          status: r.status,
          error: r.error,
          createdAt: r.created_at.toISOString(),
          ...rendered,
          button: { name: TEMPLATES[r.stage].button.name },
        };
      }),
      templates: Object.entries(TEMPLATES).map(([stage, t]) => ({ stage, ...t })),
    });
  });
}
