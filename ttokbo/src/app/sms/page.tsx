"use client";

import { useLiveQuery } from "@/components/live";
import { TopBar } from "@/components/ui";

interface Sms {
  id: number;
  stage: string;
  status: string;
  error: string | null;
  createdAt: string;
  subject: string;
  parts: { headline: string; emphasis: string; body: string; link: { label: string; url: string } | null; footer: string };
}

const STATUS: Record<string, [string, string]> = {
  pending: ["발송 대기", "text-slate-500"],
  sent: ["통신사 전송 중", "text-slate-500"],
  delivered: ["수신 완료", "text-emerald-600"],
  failed: ["발송 실패", "text-rose-600"],
  skipped: ["미발송", "text-amber-600"],
};

const SKIP_REASON: Record<string, string> = {
  NO_CONTACT: "휴대폰번호 미등록",
  STALE: "발송 전에 상황이 바뀌어 보내지 않음",
};

/** 휴대폰 문자 앱처럼 보여주는 내 문자 알림 내역 */
export default function SmsPage() {
  const { data } = useLiveQuery<{ provider: string; messages: Sms[] }>("/api/sms");

  return (
    <div className="mx-auto min-h-screen max-w-md bg-white">
      <TopBar title="문자 알림" back="/home" />
      <div className="border-b border-slate-100 px-4 py-3 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-teal-600 text-xl font-bold text-white">똑</div>
        <p className="mt-1 font-semibold">똑보 (강남구청)</p>
        <p className="text-xs text-slate-500">
          {data?.provider === "solapi" ? "솔라피로 실제 발송된 문자입니다" : "개발 모드: 실제 발송 대신 이 화면에서 확인합니다"}
        </p>
      </div>
      <main className="space-y-5 px-3 pb-10 pt-4">
        {!data && <p className="text-center text-slate-400">불러오는 중…</p>}
        {data?.messages.length === 0 && (
          <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500">
            아직 받은 문자가 없습니다. 알림 설정에서 휴대폰번호를 등록하고 줄을 서면 호출·변경 안내가 문자로 옵니다.
          </p>
        )}
        {[...(data?.messages ?? [])].reverse().map((m) => (
          <SmsBubble key={m.id} m={m} />
        ))}
      </main>
    </div>
  );
}

function SmsBubble({ m }: { m: Sms }) {
  const [label, tone] = STATUS[m.status] ?? [m.status, "text-slate-500"];
  const d = new Date(m.createdAt);
  const time = d.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <div className={m.status === "skipped" ? "opacity-60" : ""}>
      <p className="mb-1 text-center text-[11px] text-slate-400">{time}</p>
      <div className="max-w-[88%] rounded-3xl rounded-tl-md bg-slate-100 px-4 py-3 text-[15px] leading-relaxed text-slate-900">
        <p className="text-xs font-semibold text-slate-500">LMS · {m.subject}</p>
        <p className="mt-2">[똑보] {m.parts.headline}</p>
        <p className="text-xl font-extrabold">■ {m.parts.emphasis}</p>
        <p className="mt-2 whitespace-pre-wrap">{m.parts.body}</p>
        {m.parts.link && (
          <p className="mt-2">
            ▶ {m.parts.link.label}
            <br />
            <span className="text-sky-700 underline">{m.parts.link.url}</span>
          </p>
        )}
        <p className="mt-2 text-[13px] text-slate-500">{m.parts.footer}</p>
      </div>
      <p className={`mt-1 pl-2 text-xs ${tone}`}>
        {label}
        {m.status === "skipped" && m.error ? ` · ${SKIP_REASON[m.error] ?? m.error}` : ""}
        {m.status === "failed" && m.error ? ` · ${m.error}` : ""}
      </p>
    </div>
  );
}
