import { cookies } from "next/headers";
import { signUp } from "@/lib/accounts";
import { encodeSession, PHONE_TICKET_COOKIE, phoneTicketCookieOptions, SESSION_COOKIE, sessionCookieOptions, verifiedPhone } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, ok, readJson } from "@/lib/http";
import { QueueError } from "@/lib/queue/types";

/** 인증을 마친 번호로 가입한다. 관리자 승인 전까지는 줄서기를 할 수 없다. */
export async function POST(req: Request) {
  return handle(async () => {
    const phone = await verifiedPhone();
    if (!phone) throw new QueueError("PHONE_NOT_VERIFIED", "인증 시간이 지났어요. 휴대폰 번호 인증부터 다시 해 주세요.", 401);
    const body = await readJson<{ name: string; departmentId: number; consent: boolean }>(req);
    const user = await signUp(await getDb(), { phone, ...body });
    const jar = await cookies();
    jar.set(PHONE_TICKET_COOKIE, "", { ...phoneTicketCookieOptions, maxAge: 0 });
    jar.set(SESSION_COOKIE, encodeSession(user.id), sessionCookieOptions);
    return ok({ role: user.role, approved: user.approved }, { status: 201 });
  });
}
