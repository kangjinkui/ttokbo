import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, intParam, ok } from "@/lib/http";
import { deskView } from "@/lib/queue/service";

export async function GET(_req: Request, ctx: RouteContext<"/api/desk/[roomId]">) {
  return handle(async () => {
    const user = await requireUser(["secretary", "admin"]);
    return ok(await deskView(await getDb(), user, intParam((await ctx.params).roomId, "roomId")));
  });
}
