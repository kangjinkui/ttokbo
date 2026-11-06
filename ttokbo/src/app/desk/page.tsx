"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, ErrorText, logout, RoomStatusBadge, TopBar } from "@/components/ui";
import { api } from "@/lib/client/api";

interface Room {
  id: number;
  name: string;
  location: string;
  status: string;
}

export default function DeskRoomsPage() {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    api<{ user: { role: string } }>("/api/me").then(({ user }) => setIsAdmin(user.role === "admin")).catch(() => {});
    api<{ rooms: Room[] }>("/api/desk/rooms")
      .then(({ rooms }) => {
        // 담당 보고실이 하나면 바로 대시보드로
        if (rooms.length === 1) location.replace(`/desk/${rooms[0].id}`);
        else setRooms(rooms);
      })
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="mx-auto min-h-screen max-w-2xl pb-10">
      <TopBar
        title="비서실 · 담당 보고실"
        right={
          <div className="flex items-center gap-3">
            {isAdmin && <Link href="/admin" className="text-sm font-semibold text-teal-700">사용자 관리</Link>}
            <button onClick={logout} className="text-sm text-slate-500">로그아웃</button>
          </div>
        }
      />
      <main className="grid gap-3 px-4 pt-4 sm:grid-cols-2">
        <ErrorText error={error} />
        {rooms?.length === 0 && <p className="text-slate-500">담당 보고실이 없습니다. 관리자에게 문의하세요.</p>}
        {rooms?.map((r) => (
          <Link key={r.id} href={`/desk/${r.id}`}>
            <Card className="hover:ring-teal-400">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">{r.name}</h2>
                <RoomStatusBadge status={r.status} />
              </div>
              <p className="text-sm text-slate-500">{r.location}</p>
            </Card>
          </Link>
        ))}
      </main>
    </div>
  );
}
