import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, intParam, ok, readJson } from "@/lib/http";
import { publish } from "@/lib/realtime/bus";
import { deferBySelf } from "@/lib/queue/service";

export async function POST(req: Request, ctx: RouteContext<"/api/requests/[id]/defer">) {
  return handle(async () => {
    const user = await requireUser();
    const { steps } = await readJson<{ steps: number }>(req);
    const { fx, ...result } = await deferBySelf(await getDb(), user, intParam((await ctx.params).id), steps);
    publish(fx);
    return ok(result);
  });
}
