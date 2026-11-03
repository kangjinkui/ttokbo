import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, ok, readJson } from "@/lib/http";
import { publish } from "@/lib/realtime/bus";
import { joinQueue } from "@/lib/queue/service";

/** 줄서기 (원탭 신청) */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await readJson<{ roomId: number; expectedMinutes: number; title?: string; idempotencyKey?: string }>(req);
    const { request, duplicate, fx } = await joinQueue(await getDb(), user, body);
    publish(fx);
    return ok({ id: request.id, ticketNo: request.ticket_no, duplicate }, { status: duplicate ? 200 : 201 });
  });
}
