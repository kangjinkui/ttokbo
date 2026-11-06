"use client";

import { useEffect, useState } from "react";
import { Button, Card, logout } from "@/components/ui";
import { api } from "@/lib/client/api";

/** 가입 신청 후 관리자 승인을 기다리는 화면. 승인되면 문자로도 알려준다. */
export default function PendingPage() {
  const [user, setUser] = useState<{ name: string; department: string | null } | null>(null);
  const [checking, setChecking] = useState(false);

  const fetchMe = () =>
    api<{ user: { name: string; department: string | null; approved: boolean } }>("/api/me").then(({ user }) => {
      if (user.approved) location.replace("/");
      else setUser(user);
    });

  async function check() {
    setChecking(true);
    await fetchMe().finally(() => setChecking(false));
  }

  useEffect(() => {
    fetchMe().catch(() => {});
  }, []);

  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-3xl" aria-hidden>⏳</div>
      <h1 className="text-2xl font-bold">가입 승인을 기다리고 있어요</h1>
      <Card className="mt-6 text-left">
        {user && (
          <p className="mb-2 font-semibold">
            {user.name}님{user.department ? ` · ${user.department}` : ""}
          </p>
        )}
        <p className="text-slate-600">관리자가 확인하면 문자로 알려드려요. 승인 후에는 이 화면을 새로고침하거나 문자의 링크를 누르면 바로 시작할 수 있어요.</p>
      </Card>
      <div className="mt-6 space-y-2">
        <Button size="lg" className="w-full" disabled={checking} onClick={check}>
          {checking ? "확인 중…" : "승인됐는지 확인"}
        </Button>
        <Button variant="ghost" className="w-full" onClick={logout}>로그아웃</Button>
      </div>
    </main>
  );
}
