import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, ok } from "@/lib/http";
import { staffHome } from "@/lib/queue/service";

export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    return ok({ user, ...(await staffHome(await getDb(), user)) });
  });
}
