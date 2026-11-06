"use client";

import { useEffect, useState } from "react";
import { PhoneVerify } from "@/components/phone-verify";
import { Button, Card, ErrorText } from "@/components/ui";
import { api } from "@/lib/client/api";

interface DevUser {
  id: number;
  name: string;
  role: string;
  department: string | null;
}

interface Bureau {
  id: number;
  name: string;
  teams: { id: number; name: string }[];
}

type VerifyResult = { status: "login"; role: string; approved: boolean } | { status: "signup" };

const ROLE_LABEL: Record<string, string> = {
  staff: "직원",
  executive: "간부",
  secretary: "비서실",
  admin: "관리자",
  display: "현황판",
};

export default function LoginPage() {
  const [step, setStep] = useState<"verify" | "signup">("verify");

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-600 text-3xl font-bold text-white">똑</div>
        <h1 className="text-2xl font-bold">똑보</h1>
        <p className="mt-1 text-slate-500">줄 없이, 자리에서 보고 차례를 기다리세요</p>
      </div>
      <Card className="p-5">
        {step === "verify" ? (
          <>
            <p className="mb-1 text-lg font-bold">휴대폰 번호로 시작하기</p>
            <p className="mb-4 text-sm text-slate-500">처음이면 가입, 이미 가입했으면 바로 로그인돼요. 한 번 로그인하면 30일 동안 유지됩니다.</p>
            <PhoneVerify<VerifyResult>
              onVerified={(r) => (r.status === "signup" ? setStep("signup") : goHome(r.role, r.approved))}
            />
          </>
        ) : (
          <SignupForm />
        )}
      </Card>
      <DevLogin />
    </main>
  );
}

function SignupForm() {
  const [bureaus, setBureaus] = useState<Bureau[]>([]);
  const [name, setName] = useState("");
  const [bureauId, setBureauId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ bureaus: Bureau[] }>("/api/auth/departments").then((d) => setBureaus(d.bureaus)).catch((e) => setError(e.message));
  }, []);

  const bureau = bureaus.find((b) => String(b.id) === bureauId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ role: string; approved: boolean }>("/api/auth/signup", {
        json: { name, departmentId: Number(teamId), consent },
      });
      goHome(r.role, r.approved);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const select = "w-full rounded-xl bg-white px-4 py-3.5 text-lg ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-teal-500";
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <p className="text-lg font-bold">처음 오셨네요</p>
        <p className="text-sm text-slate-500">이름과 소속만 알려주세요. 관리자가 확인하면 바로 쓸 수 있어요.</p>
      </div>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-slate-600">이름</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="홍길동" className={select} autoFocus />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-slate-600">국</span>
        <select value={bureauId} onChange={(e) => { setBureauId(e.target.value); setTeamId(""); }} className={select}>
          <option value="">국을 고르세요</option>
          {bureaus.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </label>
      {bureau && (
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-slate-600">과</span>
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className={select}>
            <option value="">과를 고르세요</option>
            {bureau.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            <option value={bureau.id}>{bureau.name} 직속 (국장·비서 등)</option>
          </select>
        </label>
      )}
      <label className="flex items-start gap-2 text-sm text-slate-600">
        <input type="checkbox" className="mt-1 h-5 w-5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>[필수] 로그인과 보고 호출 문자 발송을 위해 휴대폰 번호를 수집·이용하는 데 동의합니다. 보유: 탈퇴 또는 퇴직 시까지.</span>
      </label>
      <ErrorText error={error} />
      <Button type="submit" size="lg" className="w-full" disabled={busy || name.trim().length < 2 || !teamId || !consent}>
        {busy ? "신청 중…" : "가입 신청"}
      </Button>
    </form>
  );
}

/** 개발·시범용: 시험 계정을 골라 들어간다. ALLOW_DEV_LOGIN=false면 목록이 오지 않아 숨겨진다. */
function DevLogin() {
  const [users, setUsers] = useState<DevUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ users: DevUser[] }>("/api/auth/users").then((d) => setUsers(d.users)).catch(() => {});
  }, []);

  async function login(userId: number) {
    try {
      const { role } = await api<{ role: string }>("/api/auth/dev-login", { json: { userId } });
      goHome(role, true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!users.length) return null;
  const groups = Object.keys(ROLE_LABEL).map((role) => ({ role, users: users.filter((u) => u.role === role) }));
  return (
    <details className="mt-6 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
      <summary className="cursor-pointer text-sm font-semibold text-slate-500">개발용 로그인 (시험 계정)</summary>
      <div className="mt-3">
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
      </div>
    </details>
  );
}

function goHome(role: string, approved: boolean) {
  const raw = new URLSearchParams(location.search).get("next");
  // 같은 사이트 경로만 허용 ("//evil.com", "/\\evil.com" 차단)
  const next = raw && /^\/(?![\/\\])/.test(raw) ? raw : null;
  // 실시간 연결을 새 세션으로 다시 맺도록 전체 새로고침으로 이동한다
  window.location.assign(!approved ? "/pending" : next && next !== "/" ? next : homeFor(role));
}

function homeFor(role: string) {
  if (role === "secretary" || role === "admin") return "/desk";
  if (role === "display") return "/board/1";
  return "/home";
}
