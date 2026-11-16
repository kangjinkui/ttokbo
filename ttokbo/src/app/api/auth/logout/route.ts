import { cookies } from "next/headers";
import { RETURN_COOKIE, SESSION_COOKIE, TEST_VIEW_COOKIE } from "@/lib/auth";

export async function POST() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(RETURN_COOKIE);
  jar.delete(TEST_VIEW_COOKIE);
  return Response.json({ ok: true });
}
