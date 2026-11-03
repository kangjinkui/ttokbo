import { EventEmitter } from "node:events";
import type { Effects } from "../queue/types";

// 단일 서버 프로세스용 이벤트 버스. 여러 인스턴스로 늘릴 때는
// PostgreSQL LISTEN/NOTIFY 또는 Supabase Realtime으로 바꾼다.
export type BusEvent =
  | { type: "room"; roomId: number }
  | { type: "user"; userId: number }
  | { type: "outbox" };

const g = globalThis as unknown as { __ttokboBus?: EventEmitter };
export const bus = g.__ttokboBus ?? (g.__ttokboBus = new EventEmitter().setMaxListeners(0));

export function publish(fx: Effects) {
  for (const roomId of fx.rooms) bus.emit("event", { type: "room", roomId } satisfies BusEvent);
  for (const userId of fx.users) bus.emit("event", { type: "user", userId } satisfies BusEvent);
  if (fx.outbox) bus.emit("event", { type: "outbox" } satisfies BusEvent);
}
