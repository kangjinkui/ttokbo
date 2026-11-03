"use client";

import { useEffect, useState } from "react";
import { Card, ErrorText } from "@/components/ui";
import { api } from "@/lib/client/api";

interface DevUser {
  id: number;
  name: string;
  role: string;
  department: string | null;
}

const ROLE_LABEL: Record<string, string> = {
  staff: "직원",
  executive: "간부",
  secretary: "비서실",
  admin: "관리자",
  display: "현황판",
};

export default function LoginPage() {
  const [users, setUsers] = useState<DevUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ users: DevUser[] }>("/api/auth/users").then((d) => setUsers(d.users)).catch((e) => setError(e.message));
  }, []);

  async function login(userId: number) {
    try {
      const { role } = await api<{ role: string }>("/api/auth/dev-login", { json: { userId } });
      const raw = new URLSearchParams(location.search).get("next");
      // 같은 사이트 경로만 허용 ("//evil.com", "/\\evil.com" 차단)
      const next = raw && /^\/(?![\/\\])/.test(raw) ? raw : null;
      // 실시간 연결을 새 세션으로 다시 맺도록 전체 새로고침으로 이동한다
      window.location.assign(next && next !== "/" ? next : homeFor(role));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const groups = Object.keys(ROLE_LABEL).map((role) => ({ role, users: users.filter((u) => u.role === role) }));

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-600 text-3xl font-bold text-white">똑</div>
        <h1 className="text-2xl font-bold">똑보</h1>
        <p className="mt-1 text-slate-500">줄 없이, 자리에서 보고 차례를 기다리세요</p>
      </div>
      <Card>
        <p className="mb-1 font-semibold">개발용 로그인</p>
        <p className="mb-4 text-sm text-slate-500">실서비스에서는 구청 인증(SSO)으로 바뀝니다. 사용자를 골라 들어가세요.</p>
        <ErrorText error={error} />
        {groups.map((g) =>
          g.users.length ? (
            <div key={g.role} className="mb-4">
              <p className="mb-2 text-xs font-semibold text-slate-500">{ROLE_LABEL[g.role]}</p>
              <div className="grid grid-cols-2 gap-2">
                {g.users.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => login(u.id)}
                    className="rounded-xl px-3 py-2 text-left ring-1 ring-slate-200 hover:bg-teal-50 hover:ring-teal-300"
                  >
                    <span className="block font-semibold">{u.name}</span>
                    <span className="text-xs text-slate-500">{u.department}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null,
        )}
      </Card>
    </main>
  );
}

function homeFor(role: string) {
  if (role === "secretary" || role === "admin") return "/desk";
  if (role === "display") return "/board/1";
  return "/home";
}
