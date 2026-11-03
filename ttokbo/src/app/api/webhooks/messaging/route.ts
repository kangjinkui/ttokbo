import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";
import { handle, ok, readJson } from "@/lib/http";
import { applyDeliveryReport } from "@/lib/messaging/outbox";
import { publish } from "@/lib/realtime/bus";
import { QueueError } from "@/lib/queue/types";

// 발송 대행사 결과 웹훅. 대행사별 페이로드는 어댑터 확정 시 여기서 공통 형식으로 변환한다.
interface Report {
  providerMessageId: string;
  status: "delivered" | "fallback_sms" | "failed";
  error?: string;
}

function authorized(req: Request) {
  const secret = process.env.MESSAGING_WEBHOOK_SECRET;
  const given = req.headers.get("x-ttokbo-secret");
  if (!secret || !given) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  return handle(async () => {
    if (!authorized(req)) throw new QueueError("UNAUTHORIZED", "invalid webhook secret", 401);
    const body = await readJson<Report | Report[]>(req);
    const db = await getDb();
    for (const r of Array.isArray(body) ? body : [body]) {
      if (!r.providerMessageId || !["delivered", "fallback_sms", "failed"].includes(r.status)) continue;
      publish(await applyDeliveryReport(db, r));
    }
    return ok({ ok: true });
  });
}
