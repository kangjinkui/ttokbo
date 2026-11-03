import { getDb } from "../db";
import { bus, publish, type BusEvent } from "../realtime/bus";
import { closePreviousDays } from "../queue/service";
import { drainOutbox, pollDeliveries } from "./outbox";
import { getProvider } from "./provider";

const g = globalThis as unknown as { __ttokboWorker?: boolean };

/** 문자 발송 워커. 신규 알림이 쌓이면 바로, 아니면 5초마다 재시도분을 확인한다. */
export function startMessagingWorker() {
  if (g.__ttokboWorker) return;
  g.__ttokboWorker = true;

  let running = false;
  let again = false;
  const tick = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        const fx = await drainOutbox(await getDb(), getProvider());
        if (fx.rooms.size || fx.users.size) publish(fx);
      } while (again);
    } catch (err) {
      console.error("[messaging] outbox drain failed", err);
    } finally {
      running = false;
    }
  };

  bus.on("event", (e: BusEvent) => {
    if (e.type === "outbox") void tick();
  });
  setInterval(tick, 5000).unref();

  // 날짜가 바뀌면 지난 날짜의 미처리 신청을 마감한다 (1분마다 확인)
  const rollover = async () => {
    try {
      const fx = await closePreviousDays(await getDb());
      if (fx.rooms.size || fx.users.size || fx.outbox) publish(fx);
    } catch (err) {
      console.error("[queue] day rollover failed", err);
    }
  };
  void rollover();
  setInterval(rollover, 60_000).unref();

  // 접수된 문자의 수신 결과 확인 (15초마다)
  const poll = async () => {
    try {
      const fx = await pollDeliveries(await getDb(), getProvider());
      if (fx.rooms.size || fx.users.size) publish(fx);
    } catch (err) {
      console.error("[messaging] delivery poll failed", err);
    }
  };
  setInterval(poll, 15_000).unref();
}
