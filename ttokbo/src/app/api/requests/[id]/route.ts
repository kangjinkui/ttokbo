import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, intParam, ok } from "@/lib/http";
import { myRequest } from "@/lib/queue/service";

export async function GET(_req: Request, ctx: RouteContext<"/api/requests/[id]">) {
  return handle(async () => {
    const user = await requireUser();
    const id = intParam((await ctx.params).id);
    return ok(await myRequest(await getDb(), user, id));
  });
}
