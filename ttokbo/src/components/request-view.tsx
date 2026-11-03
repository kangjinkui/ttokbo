"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Card, ErrorText, etaClock, etaText, REQ_LABEL, RequestStatusBadge, useNow } from "@/components/ui";

export interface RequestDetail {
  room: { id: number; name: string; location: string; status: string; graceMinutes: number };
  request: {
    id: number;
    ticketNo: number;
    title: string | null;
    expectedMinutes: number;
    status: string;
    priority: string;
    defersLeft: number;
    callExpiresAt: string | null;
    lastEvent: { status: string; reason: string | null; at: string } | null;
  };
  ahead: number | null;
  /** 대기열 안에서 내 위치 (1부터) */
  position: number | null;
  etaMinutes: number | null;
  queueLength: number;
}

export type CallResponse = "on_way" | "delay_5" | "defer" | "cancel";

/** 호출 화면: 전체화면 강조 + 응답 버튼 (PRD §5.5). 앱과 알림톡 링크에서 함께 쓴다. */
export function CallPanel({
  detail,
  onRespond,
  responded,
}: {
  detail: RequestDetail;
  onRespond: (r: CallResponse) => Promise<void>;
  responded?: CallResponse | null;
}) {
  const now = useNow(1000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const left = detail.request.callExpiresAt ? Math.max(0, new Date(detail.request.callExpiresAt).getTime() - now) : null;

  async function respond(r: CallResponse) {
    if (r === "cancel" && !confirm("보고 신청을 취소할까요?")) return;
    setBusy(true);
    setError(null);
    try {
      await onRespond(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-3xl bg-emerald-600 p-6 text-white shadow-lg">
      <p className="text-sm font-semibold opacity-90">지금 입장해 주세요</p>
      <p className="mt-2 text-5xl font-extrabold">{detail.request.ticketNo}번</p>
      <p className="mt-3 text-lg font-semibold">{detail.room.name}</p>
      <p className="text-emerald-50">{detail.room.location}</p>
      {left != null && (
        <p className="mt-3 text-sm text-emerald-50" aria-live="polite">
          {left > 0 ? `응답 대기 ${Math.floor(left / 60000)}분 ${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}초 남음` : "응답 시간이 지났습니다. 바로 응답해 주세요."}
        </p>
      )}
      {responded === "on_way" ? (
        <p className="mt-5 rounded-xl bg-white/15 p-3 font-semibold">✓ 이동 중으로 알렸습니다. 비서실에서 기다리고 있어요.</p>
      ) : (
        <>
          <Button variant="secondary" size="lg" className="mt-5 w-full !text-emerald-700" disabled={busy} onClick={() => respond("on_way")}>
            이동 중
          </Button>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Button variant="ghost" className="!px-2 text-sm !text-white ring-1 ring-white/50 hover:!bg-white/10" disabled={busy} onClick={() => respond("delay_5")}>
              5분 뒤 가능
            </Button>
            <Button
              variant="ghost"
              className="!px-2 text-sm !text-white ring-1 ring-white/50 hover:!bg-white/10"
              disabled={busy || detail.request.defersLeft <= 0}
              onClick={() => respond("defer")}
            >
              순서 미루기
            </Button>
            <Button variant="ghost" className="!px-2 text-sm !text-white ring-1 ring-white/50 hover:!bg-white/10" disabled={busy} onClick={() => respond("cancel")}>
              취소
            </Button>
          </div>
        </>
      )}
      {responded === "delay_5" && <p className="mt-3 text-sm">5분 뒤 도착으로 알렸습니다.</p>}
      <div className="mt-3">
        <ErrorText error={error} />
      </div>
    </div>
  );
}

/** 대기 중 화면: 큰 번호, 앞 N건, 진행 바, 예상 호출 시각 */
export function WaitingPanel({ detail }: { detail: RequestDetail }) {
  const now = useNow(15000);
  // 진행 바 기준: 이 신청에서 본 가장 큰 "내 앞 건수" (새로고침해도 유지)
  const key = `ttokbo:startAhead:${detail.request.id}`;
  const [startAhead, setStartAhead] = useState(() => Math.max(Number(sessionStorage.getItem(key)) || 0, detail.ahead ?? 0, 1));
  if (detail.ahead != null && detail.ahead > startAhead) setStartAhead(detail.ahead);

  useEffect(() => {
    sessionStorage.setItem(key, String(startAhead));
  }, [key, startAhead]);

  const progress = startAhead && detail.ahead != null ? Math.min(100, Math.round(((startAhead - detail.ahead) / startAhead) * 100)) : 0;
  const clock = etaClock(detail.etaMinutes, now);
  const paused = detail.room.status !== "open";

  return (
    <Card className="text-center">
      <p className="text-sm text-slate-500">{detail.room.name} · 내 대기번호</p>
      <p className="mt-1 text-6xl font-extrabold tracking-tight text-teal-700">{detail.request.ticketNo}</p>
      {detail.request.priority === "urgent" && <p className="mt-1 text-sm font-semibold text-rose-600">긴급보고</p>}
      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-xs text-slate-500">내 앞</p>
          <p className="text-2xl font-bold">{detail.ahead ?? "-"}건</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-xs text-slate-500">예상 호출</p>
          <p className="text-2xl font-bold">{clock ?? "확인 중"}</p>
          <p className="text-xs text-slate-500">{etaText(detail.etaMinutes)}</p>
        </div>
      </div>
      <div className="mt-5" aria-label={`진행률 ${progress}%`} role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-3 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-teal-500 transition-all duration-700" style={{ width: `${Math.max(progress, 4)}%` }} />
        </div>
      </div>
      {paused && (
        <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          보고실이 {detail.room.status === "external" ? "외부 일정" : detail.room.status === "closed" ? "마감" : "일시중지"} 상태입니다. 순서는 그대로 유지되며, 재개되면 알려드립니다.
        </p>
      )}
      {detail.ahead === 0 && !paused && <p className="mt-4 font-semibold text-emerald-700">다음 순서입니다. 출발할 준비를 해 주세요.</p>}
    </Card>
  );
}

export function FinishedPanel({ detail }: { detail: RequestDetail }) {
  const s = detail.request.status;
  const reason = detail.request.lastEvent?.reason;
  return (
    <Card className="text-center">
      <p className="text-sm text-slate-500">{detail.room.name} · {detail.request.ticketNo}번</p>
      <div className="my-3">
        <RequestStatusBadge status={s} />
      </div>
      <p className="text-lg font-semibold">
        {s === "in_progress" ? "보고 중입니다" : s === "done" ? "보고가 끝났습니다" : s === "held" ? "비서실에서 보류했습니다" : `신청이 ${REQ_LABEL[s]}되었습니다`}
      </p>
      {reason && s !== "done" && s !== "in_progress" && <p className="mt-2 text-sm text-slate-600">사유: {reason}</p>}
      {(s === "done" || s === "cancelled") && (
        <Link href="/home" className="mt-4 inline-block">
          <Button variant="secondary">{s === "cancelled" ? "다시 줄서기" : "홈으로"}</Button>
        </Link>
      )}
    </Card>
  );
}
