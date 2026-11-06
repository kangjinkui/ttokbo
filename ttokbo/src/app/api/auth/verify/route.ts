import { cookies } from "next/headers";
import { requirePhone, verifyLoginCode } from "@/lib/accounts";
import {
  encodePhoneTicket, encodeSession, PHONE_TICKET_COOKIE, phoneTicketCookieOptions,
  requireUser, SESSION_COOKIE, sessionCookieOptions, sign,
} from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, ok, readJson } from "@/lib/http";
import { QueueError } from "@/lib/queue/types";

/**
 * 인증번호 확인.
 * - login: 가입된 번호면 바로 로그인, 처음 보는 번호면 가입 단계로 (인증된 번호를 15분짜리 쿠키에 담는다)
 * - change: 로그인한 사람의 번호 변경용. 다른 계정으로 로그인시키지 않는다.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson<{ phone: string; code: string; purpose?: "login" | "change" }>(req);
    const phone = requirePhone(body.phone);
    if (body.purpose === "change") await requireUser(undefined, { allowPending: true });

    const db = await getDb();
    const user = await verifyLoginCode(db, phone, body.code ?? "", sign);
    const jar = await cookies();

    if (body.purpose === "change") {
      jar.set(PHONE_TICKET_COOKIE, encodePhoneTicket(phone), phoneTicketCookieOptions);
      return ok({ status: "verified" });
    }
    if (!user) {
      jar.set(PHONE_TICKET_COOKIE, encodePhoneTicket(phone), phoneTicketCookieOptions);
      return ok({ status: "signup" });
    }
    if (!user.active) throw new QueueError("ACCOUNT_DISABLED", "사용이 중지된 계정입니다. 관리자에게 문의해 주세요.", 403);
    jar.set(SESSION_COOKIE, encodeSession(user.id), sessionCookieOptions);
    return ok({ status: "login", role: user.role, approved: user.approved });
  });
}
