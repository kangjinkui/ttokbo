import { requireUser } from "@/lib/auth";
import { fail } from "@/lib/http";
import { bus, type BusEvent } from "@/lib/realtime/bus";

/**
 * 실시간 변경 알림 (SSE). 데이터 자체는 보내지 않고 "무엇이 바뀌었는지"만 알린다.
 * 클라이언트는 받은 뒤 권한이 적용된 API로 다시 조회하므로 개인정보가 스트림으로 새지 않는다.
 */
export async function GET(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    return fail(err);
  }

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };
      const onEvent = (e: BusEvent) => {
        if (e.type === "room") send("room", { roomId: e.roomId });
        else if (e.type === "user" && e.userId === user.id) send("user", {});
      };
      const ping = setInterval(() => send("ping", { t: Date.now() }), 15000);
      bus.on("event", onEvent);
      cleanup = () => {
        clearInterval(ping);
        bus.off("event", onEvent);
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
      send("hello", { t: Date.now() });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
