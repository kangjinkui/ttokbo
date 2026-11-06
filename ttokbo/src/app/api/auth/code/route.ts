import { requirePhone, sendLoginCode } from "@/lib/accounts";
import { sign } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, ok, readJson } from "@/lib/http";
import { getProvider } from "@/lib/messaging/provider";

/** 로그인·가입·번호 변경 공통: 인증번호 문자 발송 */
export async function POST(req: Request) {
  return handle(async () => {
    const { phone } = await readJson<{ phone: string }>(req);
    await sendLoginCode(await getDb(), getProvider(), requirePhone(phone), sign);
    return ok({ sent: true });
  });
}
