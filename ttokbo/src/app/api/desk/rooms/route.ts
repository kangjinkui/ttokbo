import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, ok } from "@/lib/http";
import { deskRooms } from "@/lib/queue/service";

export async function GET() {
  return handle(async () => {
    const user = await requireUser(["secretary", "admin"]);
    return ok({ user, rooms: await deskRooms(await getDb(), user) });
  });
}
