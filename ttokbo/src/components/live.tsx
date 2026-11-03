"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";

type Listener = (e: { type: "room"; roomId: number } | { type: "user" }) => void;

interface LiveState {
  connected: boolean;
  subscribe: (fn: Listener) => () => void;
}

const LiveContext = createContext<LiveState>({ connected: false, subscribe: () => () => {} });

interface InappNotification {
  id: number;
  requestId: number | null;
  stage: "prepare" | "imminent" | "call" | "change";
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

/**
 * 앱 전체에 SSE 연결 하나를 둔다. 끊기면 지수 백오프로 재연결하고,
 * 그 사이 화면은 useLiveQuery의 폴링으로 최신 상태를 유지한다.
 */
export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const listeners = useRef(new Set<Listener>());
  const [toasts, setToasts] = useState<InappNotification[]>([]);
  const seen = useRef<Set<number> | null>(null);

  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => void listeners.current.delete(fn);
  }, []);

  const pullNotifications = useCallback(async () => {
    try {
      const { notifications } = await api<{ notifications: InappNotification[] }>("/api/notifications");
      if (seen.current === null) {
        // 첫 조회는 기준선만 잡는다 (예전 알림을 다시 띄우지 않음)
        seen.current = new Set(notifications.map((n) => n.id));
        return;
      }
      const fresh = notifications.filter((n) => !seen.current!.has(n.id) && !n.readAt).reverse();
      fresh.forEach((n) => seen.current!.add(n.id));
      if (!fresh.length) return;
      setToasts((t) => [...t, ...fresh]);
      if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
        for (const n of fresh) new Notification(n.title, { body: n.body, tag: `ttokbo-${n.id}` });
      }
      if (fresh.some((n) => n.stage === "call") && "vibrate" in navigator) navigator.vibrate?.([300, 100, 300]);
    } catch {}
  }, []);

  // SSE가 막힌 망에서도 호출 알림을 놓치지 않도록 알림은 폴링으로도 확인한다 (끊김 10초, 연결 30초)
  useEffect(() => {
    if (location.pathname.startsWith("/login") || location.pathname.startsWith("/c/")) return;
    const first = setTimeout(() => void pullNotifications(), 0);
    const t = setInterval(() => void pullNotifications(), connected ? 30000 : 10000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [connected, pullNotifications]);

  useEffect(() => {
    if (location.pathname.startsWith("/login") || location.pathname.startsWith("/c/")) return;
    let es: EventSource | null = null;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = () => {
      es = new EventSource("/api/stream");
      es.addEventListener("hello", () => {
        retry = 0;
        setConnected(true);
      });
      es.addEventListener("room", (ev) => {
        const { roomId } = JSON.parse((ev as MessageEvent).data);
        listeners.current.forEach((fn) => fn({ type: "room", roomId }));
      });
      es.addEventListener("user", () => {
        listeners.current.forEach((fn) => fn({ type: "user" }));
        void pullNotifications();
      });
      es.onerror = () => {
        setConnected(false);
        es?.close();
        if (stopped) return;
        timer = setTimeout(connect, Math.min(30000, 1000 * 2 ** retry++));
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      es?.close();
    };
  }, [pullNotifications]);

  const dismiss = (id: number) => {
    setToasts((t) => t.filter((n) => n.id !== id));
    void api("/api/notifications", { json: { ids: [id] } }).catch(() => {});
  };

  return (
    <LiveContext.Provider value={{ connected, subscribe }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-2 z-50 mx-auto flex max-w-md flex-col gap-2 px-3">
        {toasts.slice(-3).map((n) => (
          <div
            key={n.id}
            role="alert"
            className={`pointer-events-auto rounded-2xl p-4 shadow-lg ring-1 ${
              n.stage === "call" ? "bg-emerald-600 text-white ring-emerald-700" : "bg-white text-slate-900 ring-slate-200"
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <p className="font-semibold">{n.title}</p>
                <p className={`mt-1 text-sm whitespace-pre-line ${n.stage === "call" ? "text-emerald-50" : "text-slate-600"}`}>{n.body}</p>
                {n.requestId && (
                  <a href={`/r/${n.requestId}`} className="mt-2 inline-block text-sm font-semibold underline" onClick={() => dismiss(n.id)}>
                    내 대기현황 보기
                  </a>
                )}
              </div>
              <button aria-label="알림 닫기" className="text-lg leading-none opacity-70" onClick={() => dismiss(n.id)}>
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </LiveContext.Provider>
  );
}

export function useLive() {
  return useContext(LiveContext);
}

/**
 * 조회 + 실시간 갱신. 관련 이벤트가 오면 다시 읽고, 연결이 끊긴 동안에는 10초마다 폴링한다.
 * roomIds가 없으면 모든 보고실 변경에 반응한다.
 */
export function useLiveQuery<T>(path: string | null, opts: { roomIds?: number[]; onUser?: boolean } = {}) {
  const { connected, subscribe } = useLive();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const roomKey = opts.roomIds?.join(",") ?? "*";
  const onUser = opts.onUser ?? true;

  const reload = useCallback(async () => {
    if (!path) return;
    return api<T>(path).then(
      (d) => {
        setData(d);
        setError(null);
        setUpdatedAt(new Date());
      },
      (e: Error) => setError(e),
    );
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const rooms = roomKey === "*" ? null : new Set(roomKey.split(",").filter(Boolean).map(Number));
    return subscribe((e) => {
      if (e.type === "room" && (!rooms || rooms.has(e.roomId))) void reload();
      if (e.type === "user" && onUser) void reload();
    });
  }, [subscribe, reload, roomKey, onUser]);

  useEffect(() => {
    // 연결이 살아 있어도 예상시각이 흐르므로 30초마다, 끊겼으면 10초마다 다시 읽는다.
    const t = setInterval(() => void reload(), connected ? 30000 : 10000);
    return () => clearInterval(t);
  }, [connected, reload]);

  return { data, error, updatedAt, connected, reload, setData };
}
