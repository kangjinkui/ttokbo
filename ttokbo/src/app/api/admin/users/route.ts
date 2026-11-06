import { listUsers } from "@/lib/accounts";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, ok } from "@/lib/http";

export async function GET() {
  return handle(async () => {
    await requireUser(["admin"]);
    return ok({ users: await listUsers(await getDb()) });
  });
}
