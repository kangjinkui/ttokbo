import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, intParam, ok, readJson } from "@/lib/http";
import { publish } from "@/lib/realtime/bus";
import { respondToCall } from "@/lib/queue/service";
import { QueueError, type CallResponse } from "@/lib/queue/types";

const RESPONSES: CallResponse[] = ["on_way", "delay_5", "defer", "cancel"];

export async function POST(req: Request, ctx: RouteContext<"/api/requests/[id]/respond">) {
  return handle(async () => {
    const user = await requireUser();
    const { response } = await readJson<{ response: CallResponse }>(req);
    if (!RESPONSES.includes(response)) throw new QueueError("BAD_RESPONSE", "응답 값이 올바르지 않습니다.");
    const { fx } = await respondToCall(await getDb(), user, intParam((await ctx.params).id), response, "app");
    publish(fx);
    return ok({ ok: true });
  });
}
