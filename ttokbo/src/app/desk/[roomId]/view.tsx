"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useLiveQuery } from "@/components/live";
import { Button, Card, ErrorText, etaText, RequestStatusBadge, RoomStatusBadge, SyncStatus, useNow } from "@/components/ui";
import { api } from "@/lib/client/api";

interface Delivery {
  stage: string;
  channel: string;
  status: string;
  error: string | null;
}

interface Item {
  id: number;
  ticketNo: number;
  name: string;
  department: string | null;
  title: string | null;
  expectedMinutes: number;
  status: string;
  priority: string;
  urgentReason: string | null;
  deferCount: number;
  callCount: number;
  calledAt: string | null;
  callExpiresAt: string | null;
  noResponse: boolean;
  lastResponse: string | null;
  startedAt: string | null;
  hasPhone: boolean;
  delivery: Delivery[];
  etaMinutes?: number | null;
}

interface DeskData {
  room: { id: number; name: string; location: string; status: string; graceMinutes: number };
  current: Item | null;
  queue: Item[];
  held: Item[];
  finished: Item[];
}

const RESPONSE_LABEL: Record<string, string> = { on_way: "이동 중", delay_5: "5분 뒤 가능", defer: "미루기", cancel: "취소" };
const ROOM_STATUSES = [
  { value: "open", label: "접수 가능" },
  { value: "paused", label: "일시중지" },
  { value: "external", label: "외부 일정" },
  { value: "closed", label: "마감" },
];

export function DeskPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const id = Number(roomId);
  const { data, error, updatedAt, connected, reload } = useLiveQuery<DeskData>(`/api/desk/${roomId}`, { roomIds: [id], onUser: false });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [urgentOpen, setUrgentOpen] = useState(false);
  const now = useNow(1000);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await api(`/api/desk/${roomId}/action`, { json: body });
      await reload();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ask = (text: string) => {
    const v = prompt(text);
    return v == null ? null : v.trim();
  };

  const hasWaiting = data?.queue.some((q) => q.status === "waiting");
  const hasCalled = data?.queue.some((q) => q.status === "called");

  return (
    <div className="min-h-screen pb-10">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <Link href="/desk" className="text-slate-500">‹</Link>
        <h1 className="text-xl font-bold">{data?.room.name ?? "…"} 대기열</h1>
        {data && <RoomStatusBadge status={data.room.status} busy={!!data.current} />}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SyncStatus connected={connected} updatedAt={updatedAt} error={error} />
          <Link href={`/board/${roomId}`} target="_blank" className="rounded-lg px-2 py-1 text-sm text-slate-600 ring-1 ring-slate-300">현황판 열기</Link>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-4 px-4 pt-4 lg:grid-cols-[360px_1fr]">
        <section className="space-y-4">
          {/* 현재 보고 */}
          <Card>
            <p className="text-sm font-semibold text-slate-500">현재 보고</p>
            {data?.current ? (
              <>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-sky-700">{data.current.ticketNo}</span>
                  <span className="text-lg font-semibold">{data.current.name}</span>
                  <span className="text-sm text-slate-500">{data.current.department}</span>
                </div>
                {data.current.title && <p className="mt-1 text-sm text-slate-600">{data.current.title}</p>}
                <p className="mt-2 text-sm text-slate-600">
                  경과 {elapsed(data.current.startedAt, now)} / 예상 {data.current.expectedMinutes}분
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button variant="secondary" disabled={busy} onClick={() => act({ action: "end", requestId: data.current!.id })}>종료</Button>
                  <Button disabled={busy || !hasWaiting || hasCalled} onClick={() => act({ action: "end", requestId: data.current!.id, callNext: true })}>
                    종료 후 다음 호출
                  </Button>
                </div>
              </>
            ) : (
              <p className="mt-2 text-slate-500">진행 중인 보고가 없습니다.</p>
            )}
          </Card>

          <Button size="lg" className="w-full" disabled={busy || !hasWaiting || hasCalled} onClick={() => act({ action: "call" })}>
            다음 순번 호출
          </Button>
          {hasCalled && <p className="-mt-2 text-center text-xs text-slate-500">호출 중인 직원이 있습니다. 재호출·다른 직원 호출은 대기열에서 하세요.</p>}
          <Button variant="secondary" className="w-full !text-rose-700" disabled={busy} onClick={() => setUrgentOpen(true)}>
            ⚡ 긴급보고 삽입
          </Button>

          <Card>
            <p className="mb-2 text-sm font-semibold text-slate-500">보고실 상태</p>
            <div className="grid grid-cols-2 gap-2">
              {ROOM_STATUSES.map((s) => (
                <Button
                  key={s.value}
                  variant={data?.room.status === s.value ? "primary" : "secondary"}
                  size="sm"
                  disabled={busy || data?.room.status === s.value}
                  aria-pressed={data?.room.status === s.value}
                  onClick={() => {
                    const reason = s.value === "open" ? "" : ask(`${s.label} 사유 (대기자에게 안내됩니다)`);
                    if (reason === null) return;
                    void act({ action: "roomStatus", status: s.value, reason });
                  }}
                >
                  {s.label}
                </Button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">중지해도 대기열은 유지되고, 대기자 전원에게 1회 안내됩니다.</p>
          </Card>
          <ErrorText error={actionError} />
        </section>

        <section className="space-y-4">
          <Card className="!p-0">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="font-bold">대기 {data?.queue.length ?? 0}건</h2>
              <span className="text-xs text-slate-500">호출 응답 유예 {data?.room.graceMinutes}분</span>
            </div>
            {data?.queue.length === 0 && <p className="p-6 text-center text-slate-400">대기 중인 직원이 없습니다.</p>}
            <ol>
              {data?.queue.map((it, i) => {
                const overdue = it.status === "called" && !it.lastResponse && !!it.callExpiresAt && new Date(it.callExpiresAt).getTime() < now;
                return (
                  <li key={it.id} className={`border-b border-slate-100 px-4 py-3 last:border-0 ${overdue ? "bg-amber-50" : it.status === "called" ? "bg-emerald-50" : ""}`}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="w-6 text-sm text-slate-400">{i + 1}</span>
                      <span className="text-xl font-bold">{it.ticketNo}</span>
                      <span className="font-semibold">{it.name}</span>
                      <span className="text-sm text-slate-500">{it.department}</span>
                      {it.priority === "urgent" && <span className="rounded bg-rose-100 px-1.5 text-xs font-semibold text-rose-700">긴급</span>}
                      <RequestStatusBadge status={it.status} />
                      <span className="ml-auto text-sm text-slate-500">{it.expectedMinutes}분{it.status === "waiting" ? ` · ${etaText(it.etaMinutes)}` : ""}</span>
                    </div>
                    {(it.title || it.urgentReason) && (
                      <p className="mt-1 pl-9 text-sm text-slate-600">
                        {it.title}
                        {it.urgentReason && <span className="text-rose-600"> (긴급 사유: {it.urgentReason})</span>}
                      </p>
                    )}
                    {it.status === "called" && (
                      <div className="mt-1 flex flex-wrap items-center gap-2 pl-9 text-sm">
                        {it.lastResponse ? (
                          <span className="font-semibold text-emerald-700">응답: {RESPONSE_LABEL[it.lastResponse]}</span>
                        ) : overdue ? (
                          <span className="font-semibold text-amber-700">⚠ 무응답 {it.callCount > 1 ? `(호출 ${it.callCount}회)` : ""} — 재호출하거나 다음 순번을 먼저 부르세요</span>
                        ) : (
                          <span className="text-slate-600">응답 대기 {remain(it.callExpiresAt, now)}</span>
                        )}
                        <DeliveryBadges items={it.delivery} hasPhone={it.hasPhone} />
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5 pl-9">
                      {it.status === "waiting" && <Button size="sm" disabled={busy} onClick={() => act({ action: "call", requestId: it.id })}>호출</Button>}
                      {it.status === "called" && <Button size="sm" variant={overdue ? "primary" : "secondary"} disabled={busy} onClick={() => act({ action: "call", requestId: it.id })}>재호출</Button>}
                      <Button size="sm" variant="success" disabled={busy || !!data?.current} onClick={() => act({ action: "start", requestId: it.id })}>시작</Button>
                      {it.status === "called" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => act({ action: "skip", requestId: it.id })}>다음 순번 먼저</Button>}
                      <Button size="sm" variant="ghost" aria-label="위로" disabled={busy || i === 0} onClick={() => act({ action: "move", requestId: it.id, index: i - 1 })}>▲</Button>
                      <Button size="sm" variant="ghost" aria-label="아래로" disabled={busy || i === data.queue.length - 1} onClick={() => act({ action: "move", requestId: it.id, index: i + 1 })}>▼</Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => { const r = ask("보류 사유"); if (r !== null) void act({ action: "hold", requestId: it.id, reason: r }); }}>보류</Button>
                      <Button size="sm" variant="danger" disabled={busy} onClick={() => { const r = ask("취소 사유 (직원에게 안내됩니다)"); if (r) void act({ action: "cancel", requestId: it.id, reason: r }); }}>취소</Button>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>

          {!!data?.held.length && (
            <Card>
              <h2 className="mb-2 font-bold">보류 {data.held.length}건</h2>
              {data.held.map((it) => (
                <div key={it.id} className="flex items-center gap-3 py-1.5">
                  <span className="font-bold">{it.ticketNo}</span>
                  <span>{it.name}</span>
                  <span className="text-sm text-slate-500">{it.department}</span>
                  <div className="ml-auto flex gap-1.5">
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => act({ action: "resume", requestId: it.id })}>대기열 맨 앞으로 복귀</Button>
                    <Button size="sm" variant="danger" disabled={busy} onClick={() => { const r = ask("취소 사유"); if (r) void act({ action: "cancel", requestId: it.id, reason: r }); }}>취소</Button>
                  </div>
                </div>
              ))}
            </Card>
          )}

          {!!data?.finished.length && (
            <Card>
              <h2 className="mb-2 font-bold text-slate-500">오늘 처리</h2>
              {data.finished.map((it) => (
                <div key={it.id} className="flex items-center gap-3 py-1 text-sm text-slate-600">
                  <span className="font-semibold">{it.ticketNo}</span>
                  <span>{it.name}</span>
                  <RequestStatusBadge status={it.status} />
                </div>
              ))}
            </Card>
          )}
        </section>
      </main>

      {urgentOpen && <UrgentDialog roomId={roomId} onClose={() => setUrgentOpen(false)} onDone={reload} />}
    </div>
  );
}

function DeliveryBadges({ items, hasPhone }: { items: Delivery[]; hasPhone: boolean }) {
  const kakao = items.find((d) => d.channel === "kakao" && d.stage === "call");
  if (!hasPhone) return <span className="rounded bg-slate-100 px-1.5 text-xs text-slate-600">번호 미등록 · 앱 알림만</span>;
  if (!kakao) return null;
  const map: Record<string, [string, string]> = {
    pending: ["알림톡 발송 중", "bg-slate-100 text-slate-600"],
    sent: ["알림톡 접수", "bg-slate-100 text-slate-700"],
    delivered: ["알림톡 도달 ✓", "bg-emerald-100 text-emerald-800"],
    fallback_sms: ["문자 대체발송 ✓", "bg-sky-100 text-sky-800"],
    failed: ["발송 실패 — 전화로 호출하세요", "bg-rose-100 text-rose-700"],
    skipped: ["번호 없음", "bg-slate-100 text-slate-600"],
  };
  const [label, tone] = map[kakao.status] ?? [kakao.status, "bg-slate-100"];
  return <span className={`rounded px-1.5 text-xs font-semibold ${tone}`}>{label}</span>;
}

function UrgentDialog({ roomId, onClose, onDone }: { roomId: string; onClose: () => void; onDone: () => Promise<void> }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: number; name: string; department: string | null; employee_id: string }[]>([]);
  const [picked, setPicked] = useState<{ id: number; name: string } | null>(null);
  const [minutes, setMinutes] = useState(10);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function search(v: string) {
    setQ(v);
    if (!v.trim()) return setResults([]);
    const r = await api<{ users: typeof results }>(`/api/desk/staff?q=${encodeURIComponent(v)}`).catch(() => ({ users: [] }));
    setResults(r.users);
  }

  async function submit() {
    if (!picked) return;
    try {
      await api(`/api/desk/${roomId}/action`, { json: { action: "urgent", userId: picked.id, expectedMinutes: minutes, reason } });
      await onDone();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="urgent-title" className="w-full max-w-md rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h2 id="urgent-title" className="text-lg font-bold">긴급보고 삽입</h2>
        <p className="text-sm text-slate-500">호출 중인 건 바로 뒤에 들어가며, 밀린 대기자에게 1회 안내됩니다.</p>
        {picked ? (
          <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 p-3">
            <b>{picked.name}</b>
            <button className="text-sm text-slate-500" onClick={() => setPicked(null)}>변경</button>
          </div>
        ) : (
          <>
            <input
              autoFocus
              value={q}
              onChange={(e) => search(e.target.value)}
              placeholder="직원 이름 또는 사번"
              aria-label="직원 검색"
              className="mt-4 w-full rounded-xl px-3 py-2.5 ring-1 ring-slate-300"
            />
            <ul className="mt-2 max-h-40 overflow-auto">
              {results.map((u) => (
                <li key={u.id}>
                  <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50" onClick={() => setPicked(u)}>
                    <b>{u.name}</b> <span className="text-sm text-slate-500">{u.department} · {u.employee_id}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="mt-4 grid grid-cols-4 gap-2">
          {[5, 10, 15, 20].map((m) => (
            <button key={m} onClick={() => setMinutes(m)} aria-pressed={minutes === m} className={`rounded-lg py-2 ring-1 ${minutes === m ? "bg-teal-600 text-white ring-teal-600" : "ring-slate-300"}`}>
              {m}분
            </button>
          ))}
        </div>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="긴급 사유 (필수)" aria-label="긴급 사유" className="mt-3 w-full rounded-xl px-3 py-2.5 ring-1 ring-slate-300" />
        <div className="mt-3"><ErrorText error={error} /></div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>닫기</Button>
          <Button disabled={!picked || !reason.trim()} onClick={submit}>삽입</Button>
        </div>
      </div>
    </div>
  );
}

function elapsed(startedAt: string | null, now: number) {
  if (!startedAt) return "-";
  const s = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  return `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, "0")}초`;
}

function remain(expiresAt: string | null, now: number) {
  if (!expiresAt) return "";
  const s = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
