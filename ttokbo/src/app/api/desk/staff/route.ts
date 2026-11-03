import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, ok } from "@/lib/http";
import { findStaff } from "@/lib/queue/service";

/** 긴급보고 삽입 시 직원 검색 */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser(["secretary", "admin"]);
    const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
    return ok({ users: q ? await findStaff(await getDb(), user, q) : [] });
  });
}
