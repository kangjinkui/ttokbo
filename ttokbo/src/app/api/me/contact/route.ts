import { cookies } from "next/headers";
import { changePhone } from "@/lib/accounts";
import { PHONE_TICKET_COOKIE, phoneTicketCookieOptions, requireUser, verifiedPhone } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, ok } from "@/lib/http";
import { QueueError } from "@/lib/queue/types";

// 휴대폰 번호는 로그인 아이디이므로 인증번호로 확인한 번호로만 바꾼다 (/api/auth/verify purpose=change).
export async function PUT() {
  return handle(async () => {
    const user = await requireUser(undefined, { allowPending: true });
    const phone = await verifiedPhone();
    if (!phone) throw new QueueError("PHONE_NOT_VERIFIED", "새 번호의 인증번호 확인부터 해 주세요.", 401);
    await changePhone(await getDb(), user.id, phone);
    (await cookies()).set(PHONE_TICKET_COOKIE, "", { ...phoneTicketCookieOptions, maxAge: 0 });
    return ok({ phone });
  });
}
