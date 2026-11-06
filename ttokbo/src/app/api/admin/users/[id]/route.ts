import { adminUpdateUser, type AdminAction } from "@/lib/accounts";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, intParam, ok, readJson } from "@/lib/http";
import { getProvider } from "@/lib/messaging/provider";

/** 가입 승인·거절, 차단, 역할·담당 보고실 지정 */
export async function POST(req: Request, ctx: RouteContext<"/api/admin/users/[id]">) {
  return handle(async () => {
    const admin = await requireUser(["admin"]);
    const userId = intParam((await ctx.params).id);
    await adminUpdateUser(await getDb(), getProvider(), admin.id, userId, await readJson<AdminAction>(req));
    return ok({ ok: true });
  });
}
