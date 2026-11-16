import { createTestAccounts } from "@/lib/accounts";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, ok } from "@/lib/http";

/** 시험 계정(시험직원1·2, 시험비서) 만들기. 이미 있으면 그대로 둔다. */
export async function POST() {
  return handle(async () => {
    await requireUser(["admin"]);
    await createTestAccounts(await getDb());
    return ok({ ok: true });
  });
}
