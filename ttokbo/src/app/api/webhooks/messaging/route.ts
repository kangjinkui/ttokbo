import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";
import { handle, ok, readJson } from "@/lib/http";
import { applyDeliveryReport } from "@/lib/messaging/outbox";
import { solapiState } from "@/lib/messaging/provider";
import { publish } from "@/lib/realtime/bus";
import { QueueError } from "@/lib/queue/types";

/**
 * 솔라피 "메시지 리포트" 웹훅 (본문: 메시지 정보 객체 배열, 200을 돌려줘야 재전송하지 않음).
 * 솔라피 콘솔에 `https://<서버>/api/webhooks/messaging?secret=<MESSAGING_WEBHOOK_SECRET>`로 등록한다.
 * 웹훅을 받을 수 없는 망에서는 워커의 상태 조회(pollDeliveries)가 같은 일을 한다.
 */
interface SolapiReport {
  messageId?: string;
  statusCode?: string;
  reason?: string | null;
}

function authorized(req: Request) {
  const secret = process.env.MESSAGING_WEBHOOK_SECRET;
  const given = req.headers.get("x-ttokbo-secret") ?? new URL(req.url).searchParams.get("secret");
  if (!secret || !given) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  return handle(async () => {
    if (!authorized(req)) throw new QueueError("UNAUTHORIZED", "invalid webhook secret", 401);
    const body = await readJson<SolapiReport | SolapiReport[]>(req);
    const db = await getDb();
    for (const r of Array.isArray(body) ? body : [body]) {
      if (!r.messageId) continue;
      const st = solapiState(r.statusCode, r.reason);
      if (st.status === "pending") continue;
      publish(await applyDeliveryReport(db, {
        providerMessageId: r.messageId,
        status: st.status,
        error: st.status === "failed" ? st.reason : undefined,
      }));
    }
    return ok({});
  });
}
