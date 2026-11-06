"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, ErrorText, logout, TopBar } from "@/components/ui";
import { api } from "@/lib/client/api";

interface AdminUser {
  id: number;
  name: string;
  role: string;
  department: string | null;
  phone: string | null;
  active: boolean;
  approved: boolean;
  created_at: string;
  room_ids: number[];
}

interface Room {
  id: number;
  name: string;
}

const ROLES: { value: string; label: string }[] = [
  { value: "staff", label: "직원" },
  { value: "executive", label: "간부" },
  { value: "secretary", label: "비서" },
  { value: "admin", label: "관리자" },
];
const ROLE_LABEL: Record<string, string> = { ...Object.fromEntries(ROLES.map((r) => [r.value, r.label])), display: "현황판" };

const phoneText = (p: string | null) => (p ? p.replace(/^\+82/, "0").replace(/(\d{3})(\d{3,4})(\d{4})/, "$1-$2-$3") : "번호 없음");

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(
    () =>
      Promise.all([api<{ users: AdminUser[] }>("/api/admin/users"), api<{ rooms: Room[] }>("/api/desk/rooms")])
        .then(([u, r]) => {
          setUsers(u.users);
          setRooms(r.rooms);
        })
        .catch((e) => setError((e as Error).message)),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  async function act(userId: number, body: object, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setError(null);
    try {
      await api(`/api/admin/users/${userId}`, { json: body });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const pending = users?.filter((u) => !u.approved) ?? [];
  const members = (users?.filter((u) => u.approved) ?? []).filter(
    (u) => !query || u.name.includes(query) || (u.department ?? "").includes(query),
  );

  return (
    <div className="mx-auto min-h-screen max-w-2xl pb-10">
      <TopBar title="사용자 관리" back="/desk" right={<button onClick={logout} className="text-sm text-slate-500">로그아웃</button>} />
      <main className="space-y-6 px-4 pt-4">
        <ErrorText error={error} />

        <section>
          <h2 className="mb-2 font-bold">가입 승인 대기 {pending.length ? <span className="text-teal-700">{pending.length}명</span> : null}</h2>
          {users && !pending.length && <p className="text-sm text-slate-500">기다리는 사람이 없습니다.</p>}
          <div className="space-y-2">
            {pending.map((u) => (
              <Card key={u.id} className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{u.name} <span className="text-sm font-normal text-slate-500">{u.department}</span></p>
                  <p className="text-sm text-slate-500">{phoneText(u.phone)} · {new Date(u.created_at).toLocaleString("ko-KR")} 신청</p>
                </div>
                <Button variant="danger" size="sm" onClick={() => act(u.id, { action: "reject" }, `${u.name}님의 가입 신청을 거절할까요?`)}>거절</Button>
                <Button size="sm" onClick={() => act(u.id, { action: "approve" })}>승인</Button>
              </Card>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center gap-2">
            <h2 className="flex-1 font-bold">사용자 {members.length}명</h2>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="이름·부서 검색"
              className="w-40 rounded-lg px-3 py-1.5 text-sm ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div className="space-y-2">
            {members.map((u) => <MemberCard key={u.id} user={u} rooms={rooms} onAct={act} />)}
          </div>
        </section>
      </main>
    </div>
  );
}

function MemberCard({ user, rooms, onAct }: { user: AdminUser; rooms: Room[]; onAct: (id: number, body: object, confirmText?: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState(user.role);
  const [roomIds, setRoomIds] = useState<number[]>(user.room_ids);
  const roomNames = rooms.filter((r) => user.room_ids.includes(r.id)).map((r) => r.name).join(", ");

  return (
    <Card className={user.active ? "" : "opacity-60"}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-bold">
            {user.name} <span className="text-sm font-normal text-slate-500">{user.department}</span>
          </p>
          <p className="text-sm text-slate-500">
            {ROLE_LABEL[user.role]}
            {user.role === "secretary" && ` · ${roomNames || "담당 보고실 없음"}`} · {phoneText(user.phone)}
            {!user.active && <b className="text-rose-700"> · 차단됨</b>}
          </p>
        </div>
        {user.role !== "display" && (
          <Button variant="secondary" size="sm" onClick={() => setEditing(!editing)}>{editing ? "닫기" : "역할 변경"}</Button>
        )}
        {user.active ? (
          <Button variant="ghost" size="sm" onClick={() => onAct(user.id, { action: "block" }, `${user.name}님의 사용을 중지할까요?`)}>차단</Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => onAct(user.id, { action: "unblock" })}>차단 해제</Button>
        )}
      </div>
      {editing && (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap gap-2">
            {ROLES.map((r) => (
              <button
                key={r.value}
                onClick={() => setRole(r.value)}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ${role === r.value ? "bg-teal-600 text-white ring-teal-600" : "ring-slate-300"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
          {role === "secretary" && (
            <div>
              <p className="mb-1 text-sm font-semibold text-slate-600">담당 보고실</p>
              <div className="grid grid-cols-2 gap-1">
                {rooms.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={roomIds.includes(r.id)}
                      onChange={(e) => setRoomIds(e.target.checked ? [...roomIds, r.id] : roomIds.filter((id) => id !== r.id))}
                    />
                    {r.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <Button
            size="sm"
            disabled={role === "secretary" && !roomIds.length}
            onClick={() => {
              onAct(user.id, { action: "setRole", role, roomIds });
              setEditing(false);
            }}
          >
            저장
          </Button>
        </div>
      )}
    </Card>
  );
}
