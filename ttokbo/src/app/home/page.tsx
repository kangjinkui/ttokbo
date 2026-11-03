"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "@/components/live";
import { Button, Card, ErrorText, etaText, logout, RequestStatusBadge, RoomStatusBadge, SyncStatus, TopBar, useClientValue } from "@/components/ui";
import { api, newIdempotencyKey } from "@/lib/client/api";

interface RoomCard {
  id: number;
  name: string;
  location: string;
  status: string;
  isOpenHours: boolean;
  acceptsNew: boolean;
  busy: boolean;
  waitingCount: number;
  newJoinerEta: number | null;
  myRequest: { id: number; ticketNo: number; status: string; ahead: number; etaMinutes: number | null } | null;
}

interface HomeData {
  user: { name: string; department: string | null; hasContact: boolean };
  rooms: RoomCard[];
}

const MINUTES = [5, 10, 15, 20];
const FAVORITES_KEY = "ttokbo:favorites";
const LAST_MINUTES_KEY = "ttokbo:lastMinutes";

function subscribeFavorites(cb: () => void) {
  window.addEventListener(FAVORITES_KEY, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(FAVORITES_KEY, cb);
    window.removeEventListener("storage", cb);
  };
}

export default function HomePage() {
  const { data, error, updatedAt, connected } = useLiveQuery<HomeData>("/api/home");
  const [joinRoom, setJoinRoom] = useState<RoomCard | null>(null);
  const favoritesRaw = useClientValue(() => localStorage.getItem(FAVORITES_KEY) ?? "[]", "[]", subscribeFavorites);
  const favorites = useMemo<number[]>(() => JSON.parse(favoritesRaw), [favoritesRaw]);

  const toggleFavorite = (id: number) => {
    const next = favorites.includes(id) ? favorites.filter((f) => f !== id) : [...favorites, id];
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(FAVORITES_KEY));
  };

  const rooms = [...(data?.rooms ?? [])].sort(
    (a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)) || a.id - b.id,
  );
  const mine = rooms.filter((r) => r.myRequest);

  return (
    <div className="mx-auto min-h-screen max-w-md pb-10">
      <TopBar
        title="똑보"
        right={
          <div className="flex items-center gap-1">
            <Link href="/sms" className="rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-slate-100">문자함</Link>
            <Link href="/settings" className="rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-slate-100">알림 설정</Link>
            <button onClick={logout} className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100">로그아웃</button>
          </div>
        }
      />
      <main className="space-y-4 px-4 pt-4">
        {data && (
          <p className="text-slate-600">
            <b className="text-slate-900">{data.user.name}</b>님{data.user.department ? ` · ${data.user.department}` : ""}
          </p>
        )}
        <SyncStatus connected={connected} updatedAt={updatedAt} error={error} />

        {data && !data.user.hasContact && (
          <Link href="/settings" className="block rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
            <p className="font-semibold text-amber-900">📱 문자로 호출받으려면 휴대폰번호를 등록하세요</p>
            <p className="mt-1 text-sm text-amber-800">등록하지 않으면 앱 화면 알림만 받습니다.</p>
          </Link>
        )}

        {mine.map((r) => (
          <Link
            key={r.id}
            href={`/r/${r.myRequest!.id}`}
            className={`block rounded-2xl p-4 text-white shadow ${r.myRequest!.status === "called" ? "animate-pulse bg-emerald-600" : "bg-teal-700"}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm opacity-90">{r.name} · 내 대기</span>
              <RequestStatusBadge status={r.myRequest!.status} />
            </div>
            <div className="mt-2 flex items-end justify-between">
              <span className="text-3xl font-bold">{r.myRequest!.ticketNo}번</span>
              <span className="text-right text-sm">
                {r.myRequest!.status === "called"
                  ? "지금 입장해 주세요 →"
                  : r.myRequest!.status === "waiting"
                    ? `앞 ${r.myRequest!.ahead}건 · ${etaText(r.myRequest!.etaMinutes)}`
                    : "자세히 보기 →"}
              </span>
            </div>
          </Link>
        ))}

        <h2 className="pt-2 text-sm font-semibold text-slate-500">보고실</h2>
        {!data && !error && <p className="text-slate-400">불러오는 중…</p>}
        {rooms.map((room) => (
          <Card key={room.id}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleFavorite(room.id)}
                    aria-label={favorites.includes(room.id) ? "즐겨찾기 해제" : "즐겨찾기"}
                    aria-pressed={favorites.includes(room.id)}
                    className={favorites.includes(room.id) ? "text-amber-500" : "text-slate-300"}
                  >
                    ★
                  </button>
                  <h3 className="text-lg font-bold">{room.name}</h3>
                </div>
                <p className="text-sm text-slate-500">{room.location}</p>
              </div>
              <RoomStatusBadge status={room.status} busy={room.busy} />
            </div>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <p className="text-sm text-slate-500">대기</p>
                <p className="text-2xl font-bold">
                  {room.waitingCount}
                  <span className="text-base font-medium text-slate-500">건</span>
                  <span className="ml-2 text-base font-medium text-slate-600">· {etaText(room.newJoinerEta)}</span>
                </p>
              </div>
              {room.myRequest ? (
                <Link href={`/r/${room.myRequest.id}`}>
                  <Button variant="secondary">내 대기 보기</Button>
                </Link>
              ) : (
                <Button onClick={() => setJoinRoom(room)} disabled={!room.acceptsNew || !room.isOpenHours} size="lg" className="min-w-28">
                  줄서기
                </Button>
              )}
            </div>
            {!room.myRequest && (!room.acceptsNew || !room.isOpenHours) && (
              <p className="mt-2 text-sm text-slate-500">
                {!room.isOpenHours ? "접수 가능 시간이 아닙니다." : room.status === "closed" ? "오늘 접수가 마감되었습니다." : "일시중지 중이라 신규 접수를 받지 않습니다."}
              </p>
            )}
          </Card>
        ))}
      </main>
      {joinRoom && <JoinSheet room={joinRoom} onClose={() => setJoinRoom(null)} />}
    </div>
  );
}

/** 원탭 줄서기 바텀시트: 필수는 보고실뿐, 소요시간은 최근 선택값이 기본 (PRD §5.1) */
function JoinSheet({ room, onClose }: { room: RoomCard; onClose: () => void }) {
  const router = useRouter();
  const [minutes, setMinutes] = useState(() => {
    const last = Number(localStorage.getItem(LAST_MINUTES_KEY));
    return MINUTES.includes(last) ? last : 10;
  });
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newIdempotencyKey()); // 연타해도 한 건만 접수

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem(LAST_MINUTES_KEY, String(minutes));
      const r = await api<{ id: number }>("/api/requests", {
        json: { roomId: room.id, expectedMinutes: minutes, title, idempotencyKey: key.current },
      });
      if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
      router.push(`/r/${r.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="join-title"
        className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-200" />
        <h2 id="join-title" className="text-xl font-bold">{room.name} 줄서기</h2>
        <p className="mt-1 text-sm text-slate-500">
          현재 대기 {room.waitingCount}건 · {etaText(room.newJoinerEta)}
        </p>

        <p className="mt-5 mb-2 text-sm font-semibold">예상 소요시간</p>
        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="예상 소요시간">
          {MINUTES.map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={minutes === m}
              onClick={() => setMinutes(m)}
              className={`rounded-xl py-3 font-semibold ring-1 ${minutes === m ? "bg-teal-600 text-white ring-teal-600" : "ring-slate-300"}`}
            >
              {m}분
            </button>
          ))}
        </div>

        <label className="mt-5 block text-sm font-semibold" htmlFor="title">
          보고 제목 <span className="font-normal text-slate-400">(선택 · 비서실만 볼 수 있음)</span>
        </label>
        <input
          id="title"
          value={title}
          maxLength={100}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="예: 하반기 예산 조정안"
          className="mt-2 w-full rounded-xl px-3 py-3 ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-teal-500"
        />

        <div className="mt-4">
          <ErrorText error={error} />
        </div>
        <Button onClick={submit} disabled={busy} size="lg" className="mt-4 w-full">
          {busy ? "접수 중…" : "접수"}
        </Button>
      </div>
    </div>
  );
}
