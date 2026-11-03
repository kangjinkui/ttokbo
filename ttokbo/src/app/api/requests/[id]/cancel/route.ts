import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, intParam, ok } from "@/lib/http";
import { publish } from "@/lib/realtime/bus";
import { cancelBySelf } from "@/lib/queue/service";

export async function POST(_req: Request, ctx: RouteContext<"/api/requests/[id]/cancel">) {
  return handle(async () => {
    const user = await requireUser();
    const { fx } = await cancelBySelf(await getDb(), user, intParam((await ctx.params).id));
    publish(fx);
    return ok({ ok: true });
  });
}
