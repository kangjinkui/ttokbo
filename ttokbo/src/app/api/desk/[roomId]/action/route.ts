import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, intParam, ok, readJson } from "@/lib/http";
import { publish } from "@/lib/realtime/bus";
import * as q from "@/lib/queue/service";
import { QueueError, type RoomStatus } from "@/lib/queue/types";

type Action =
  | { action: "call"; requestId?: number }
  | { action: "start"; requestId: number }
  | { action: "end"; requestId: number; callNext?: boolean }
  | { action: "hold"; requestId: number; reason: string }
  | { action: "resume"; requestId: number }
  | { action: "cancel"; requestId: number; reason: string }
  | { action: "skip"; requestId: number }
  | { action: "move"; requestId: number; index: number }
  | { action: "urgent"; userId: number; expectedMinutes: number; reason: string; title?: string }
  | { action: "roomStatus"; status: RoomStatus; reason?: string };

const ROOM_STATUSES: RoomStatus[] = ["open", "paused", "external", "closed"];

/**
 * 비서실 조작은 모두 이 엔드포인트 하나로 받는다.
 * 권한은 서비스 계층에서 "신청이 실제로 속한 보고실" 기준으로 확인하므로 경로의 roomId를 바꿔도 우회되지 않는다.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/desk/[roomId]/action">) {
  return handle(async () => {
    const user = await requireUser(["secretary", "admin"]);
    const roomId = intParam((await ctx.params).roomId, "roomId");
    const body = await readJson<Action>(req);
    const db = await getDb();

    const result = await (async () => {
      switch (body.action) {
        case "call": return q.call(db, user, roomId, body.requestId);
        case "start": return q.start(db, user, body.requestId);
        case "end": return q.end(db, user, body.requestId, !!body.callNext);
        case "hold": return q.hold(db, user, body.requestId, body.reason ?? "");
        case "resume": return q.resume(db, user, body.requestId);
        case "cancel": return q.cancelByDesk(db, user, body.requestId, body.reason);
        case "skip": return q.skipNoResponse(db, user, body.requestId);
        case "move": return q.moveTo(db, user, body.requestId, body.index);
        case "urgent": return q.insertUrgent(db, user, { roomId, ...body });
        case "roomStatus":
          if (!ROOM_STATUSES.includes(body.status)) throw new QueueError("BAD_STATUS", "보고실 상태 값이 올바르지 않습니다.");
          return q.setRoomStatus(db, user, roomId, body.status, body.reason);
        default:
          throw new QueueError("BAD_ACTION", "알 수 없는 동작입니다.");
      }
    })();

    const { fx, ...rest } = result;
    publish(fx);
    // 1회용 호출 링크는 직원 본인에게만 간다. 비서실 응답에서는 뺀다.
    return ok(JSON.parse(JSON.stringify(rest, (k, v) => (k === "link" ? undefined : v))));
  });
}
