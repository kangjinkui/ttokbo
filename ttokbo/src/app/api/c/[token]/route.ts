import { getDb } from "@/lib/db";
import { handle, ok, readJson } from "@/lib/http";
import { publish } from "@/lib/realtime/bus";
import { myRequest, resolveCallToken, respondToCall } from "@/lib/queue/service";
import { QueueError, type CallResponse } from "@/lib/queue/types";

// 문자에 들어가는 1회용 링크. 로그인 없이 이번 호출에 대해서만 조회·응답할 수 있다.

async function resolve(token: string) {
  const db = await getDb();
  const t = await resolveCallToken(db, token);
  if (!t) throw new QueueError("INVALID_LINK", "유효하지 않은 링크입니다.", 404);
  return { db, t, actor: { id: t.userId, role: "staff" as const } };
}

export async function GET(_req: Request, ctx: RouteContext<"/api/c/[token]">) {
  return handle(async () => {
    const { db, t, actor } = await resolve((await ctx.params).token);
    // 만료된 링크(전달·재호출·완료·30분 경과)로는 상태 외에 아무것도 보여주지 않는다
    if (!t.valid) return ok({ valid: false, status: t.status });
    const detail = await myRequest(db, actor, t.requestId);
    // 링크로는 제목을 보여주지 않는다 (메시지가 전달·노출될 수 있으므로)
    return ok({ valid: t.valid, ...detail, request: { ...detail.request, title: null } });
  });
}

const RESPONSES: CallResponse[] = ["on_way", "delay_5", "defer", "cancel"];

export async function POST(req: Request, ctx: RouteContext<"/api/c/[token]">) {
  return handle(async () => {
    const { db, t, actor } = await resolve((await ctx.params).token);
    if (!t.valid) throw new QueueError("LINK_EXPIRED", "이미 처리되었거나 만료된 호출입니다. 똑보 앱에서 확인해 주세요.", 410);
    const { response } = await readJson<{ response: CallResponse }>(req);
    if (!RESPONSES.includes(response)) throw new QueueError("BAD_RESPONSE", "응답 값이 올바르지 않습니다.");
    const { fx } = await respondToCall(db, actor, t.requestId, response, "link", t.callNo);
    publish(fx);
    return ok({ ok: true });
  });
}
