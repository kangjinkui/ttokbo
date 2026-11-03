"use client";

import { useParams } from "next/navigation";
import { useLiveQuery } from "@/components/live";
import { useNow } from "@/components/ui";

interface Board {
  room: { name: string; location: string; status: string };
  currentTicket: number | null;
  calledTickets: number[];
  nextTickets: number[];
  waitingCount: number;
}

const STATUS: Record<string, [string, string]> = {
  open: ["접수 중", "bg-emerald-500"],
  paused: ["일시중지", "bg-amber-500"],
  external: ["외부 일정", "bg-violet-500"],
  closed: ["오늘 접수 마감", "bg-slate-500"],
};

/** 보고실 앞 현황판: 번호와 상태만 크게 표시 (이름·제목 없음) */
export function BoardPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const { data, connected } = useLiveQuery<Board>(`/api/board/${roomId}`, { roomIds: [Number(roomId)], onUser: false });
  const now = useNow(10000);
  const [label, tone] = STATUS[data?.room.status ?? "open"];

  return (
    <main className="flex min-h-screen flex-col bg-slate-900 p-8 text-white">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold">{data?.room.name}</h1>
          <p className="text-xl text-slate-400">{data?.room.location}</p>
        </div>
        <div className="text-right">
          <span className={`rounded-full px-5 py-2 text-2xl font-bold ${tone}`}>{label}</span>
          <p className="mt-3 text-xl text-slate-400">
            {new Date(now).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
            {!connected && " · 재연결 중"}
          </p>
        </div>
      </header>

      <div className="mt-10 grid flex-1 grid-cols-2 gap-8">
        <section className="flex flex-col items-center justify-center rounded-3xl bg-sky-700/40 p-8">
          <p className="text-3xl text-sky-200">보고 중</p>
          <p className="mt-4 text-[10rem] leading-none font-extrabold">{data?.currentTicket ?? "—"}</p>
        </section>
        <section className="flex flex-col gap-6">
          <div className="flex flex-1 flex-col items-center justify-center rounded-3xl bg-emerald-600/50 p-6">
            <p className="text-3xl text-emerald-100">입장해 주세요</p>
            <p className="mt-3 text-8xl font-extrabold">{data?.calledTickets.length ? data.calledTickets.join(", ") : "—"}</p>
          </div>
          <div className="rounded-3xl bg-white/10 p-6 text-center">
            <p className="text-2xl text-slate-300">다음 순서</p>
            <p className="mt-2 text-6xl font-bold">{data?.nextTickets.length ? data.nextTickets.join("  ") : "—"}</p>
          </div>
        </section>
      </div>
      <footer className="mt-8 text-center text-2xl text-slate-400">
        대기 {data?.waitingCount ?? 0}건 · 똑보 앱에서 자리에서 줄을 서세요
      </footer>
    </main>
  );
}
