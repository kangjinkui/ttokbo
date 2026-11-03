import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, intParam, ok } from "@/lib/http";
import { boardView } from "@/lib/queue/service";

/** 보고실 앞 현황판: 번호·상태만 반환한다. */
export async function GET(_req: Request, ctx: RouteContext<"/api/board/[roomId]">) {
  return handle(async () => {
    await requireUser(["display", "secretary", "admin"]);
    return ok(await boardView(await getDb(), intParam((await ctx.params).roomId, "roomId")));
  });
}
