"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "success";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-teal-600 text-white hover:bg-teal-700 disabled:bg-teal-300",
  success: "bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300",
  secondary: "bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 disabled:text-slate-400",
  danger: "bg-white text-rose-700 ring-1 ring-rose-300 hover:bg-rose-50 disabled:text-rose-300",
  ghost: "text-slate-600 hover:bg-slate-100 disabled:text-slate-300",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "px-3 py-1.5 text-sm", md: "px-4 py-2.5", lg: "px-5 py-4 text-lg" };
  return (
    <button
      className={`inline-flex items-center justify-center gap-1 rounded-xl font-semibold transition disabled:cursor-not-allowed ${VARIANTS[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
}

export function Card({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 ${className}`} {...props} />;
}

const ROOM_TONE: Record<string, string> = {
  open: "bg-emerald-100 text-emerald-800",
  busy: "bg-sky-100 text-sky-800",
  paused: "bg-amber-100 text-amber-800",
  external: "bg-violet-100 text-violet-800",
  closed: "bg-slate-200 text-slate-700",
};
const ROOM_LABEL: Record<string, string> = {
  open: "접수 가능",
  busy: "보고 중",
  paused: "일시중지",
  external: "외부 일정",
  closed: "마감",
};

/** 색상만으로 구분하지 않도록 항상 글자를 함께 표시한다 */
export function RoomStatusBadge({ status, busy }: { status: string; busy?: boolean }) {
  const key = status === "open" && busy ? "busy" : status;
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${ROOM_TONE[key]}`}>{ROOM_LABEL[key]}</span>;
}

const REQ_TONE: Record<string, string> = {
  waiting: "bg-slate-100 text-slate-700",
  called: "bg-emerald-600 text-white",
  in_progress: "bg-sky-600 text-white",
  done: "bg-slate-200 text-slate-600",
  held: "bg-amber-100 text-amber-800",
  cancelled: "bg-rose-100 text-rose-700",
};
export const REQ_LABEL: Record<string, string> = {
  waiting: "대기",
  called: "호출됨",
  in_progress: "보고 중",
  done: "완료",
  held: "보류",
  cancelled: "취소",
};
export function RequestStatusBadge({ status }: { status: string }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${REQ_TONE[status]}`}>{REQ_LABEL[status]}</span>;
}

/** 마지막 갱신 시각과 연결 상태 (똑닥 리뷰: "대기번호가 안 줄어드는" 불신 해소, PRD §9 신뢰성) */
export function SyncStatus({ connected, updatedAt, error }: { connected: boolean; updatedAt: Date | null; error?: Error | null }) {
  const now = useNow(5000);
  const ago = updatedAt ? Math.max(0, Math.round((now - updatedAt.getTime()) / 1000)) : null;
  const stale = error || !connected;
  return (
    <div
      role="status"
      className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs ${stale ? "bg-amber-50 text-amber-800" : "text-slate-500"}`}
    >
      <span className={`h-2 w-2 rounded-full ${stale ? "bg-amber-500" : "bg-emerald-500"}`} aria-hidden />
      {error ? "서버 연결 끊김 — 다시 연결 중" : connected ? "실시간 연결됨" : "재연결 중 (10초마다 확인)"}
      {ago != null && <span>· {ago < 5 ? "방금" : ago < 60 ? `${ago}초 전` : `${Math.floor(ago / 60)}분 전`} 갱신</span>}
    </div>
  );
}

/** 브라우저에서만 읽을 수 있는 값을 hydration 불일치 없이 읽는다 (서버 렌더 때는 serverValue). */
export function useClientValue<T>(read: () => T, serverValue: T, subscribe: (cb: () => void) => () => void = noopSubscribe) {
  return useSyncExternalStore(subscribe, read, () => serverValue);
}
const noopSubscribe = () => () => {};

// 간격별로 공유하는 시계. 서버 렌더(프리렌더)에서는 0을 돌려 현재 시각을 굳히지 않는다.
interface ClockStore {
  subscribe: (cb: () => void) => () => void;
  getSnapshot: () => number;
}
const clocks = new Map<number, ClockStore>();

function clockStore(intervalMs: number): ClockStore {
  const existing = clocks.get(intervalMs);
  if (existing) return existing;
  let now = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const listeners = new Set<() => void>();
  const store: ClockStore = {
    subscribe(cb) {
      listeners.add(cb);
      if (!timer) {
        now = Date.now();
        timer = setInterval(() => {
          now = Date.now();
          listeners.forEach((l) => l());
        }, intervalMs);
      }
      return () => {
        listeners.delete(cb);
        if (!listeners.size) {
          clearInterval(timer);
          timer = undefined;
        }
      };
    },
    getSnapshot: () => now || (now = Date.now()),
  };
  clocks.set(intervalMs, store);
  return store;
}

const serverNow = () => 0;

export function useNow(intervalMs = 1000) {
  const store = clockStore(intervalMs);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, serverNow);
}

export function etaText(minutes: number | null | undefined) {
  if (minutes == null) return "예상시간 확인 중";
  if (minutes <= 0) return "곧 호출";
  return `약 ${minutes}분`;
}

export function etaClock(minutes: number | null | undefined, now: number) {
  if (minutes == null) return null;
  const d = new Date(now + minutes * 60000);
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function TopBar({ title, back, right }: { title: string; back?: string; right?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur">
      {back && (
        <Link href={back} aria-label="뒤로" className="-ml-2 rounded-lg px-2 py-1 text-xl text-slate-500 hover:bg-slate-100">
          ‹
        </Link>
      )}
      <h1 className="flex-1 text-lg font-bold">{title}</h1>
      {right}
    </header>
  );
}

export function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
      {error}
    </p>
  );
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- 세션이 바뀌므로 실시간 연결까지 새로 맺는다
  window.location.assign("/login");
}
