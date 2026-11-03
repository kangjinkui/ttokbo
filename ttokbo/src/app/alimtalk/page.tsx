"use client";

import { useState } from "react";
import { useLiveQuery } from "@/components/live";
import { TopBar } from "@/components/ui";

interface Bubble {
  id: number;
  stage: string;
  status: string;
  error: string | null;
  createdAt: string;
  templateCode: string;
  emphasisSubtitle: string;
  emphasisTitle: string;
  text: string;
  extra: string;
  button: { name: string };
}

interface Template {
  stage: string;
  code: string;
  name: string;
  emphasisSubtitle: string;
  emphasisTitle: string;
  body: string;
  extra: string;
  button: { name: string; type: string };
}

const STATUS: Record<string, [string, string]> = {
  pending: ["발송 대기", "text-slate-300"],
  sent: ["대행사 접수", "text-slate-300"],
  delivered: ["알림톡 도달", "text-emerald-300"],
  fallback_sms: ["문자로 대체 발송", "text-sky-300"],
  failed: ["발송 실패", "text-rose-300"],
  skipped: ["미발송", "text-amber-300"],
};

const SKIP_REASON: Record<string, string> = {
  NO_CONTACT: "휴대폰번호 미등록",
  STALE: "발송 전에 상황이 바뀌어 보내지 않음",
};

export default function AlimtalkPage() {
  const { data } = useLiveQuery<{ messages: Bubble[]; templates: Template[] }>("/api/alimtalk");
  const [tab, setTab] = useState<"inbox" | "templates">("inbox");

  return (
    <div className="mx-auto min-h-screen max-w-md">
      <TopBar title="알림톡" back="/home" />
      <div className="flex border-b border-slate-200 bg-white text-sm font-semibold" role="tablist">
        {[
          ["inbox", "카톡 미리보기"],
          ["templates", "템플릿 원문(검수용)"],
        ].map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k as typeof tab)}
            className={`flex-1 px-3 py-3 ${tab === k ? "border-b-2 border-teal-600 text-teal-700" : "text-slate-500"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "inbox" ? (
        <main className="min-h-[80vh] bg-[#1e1e1e] px-3 pb-10 pt-4 text-white">
          <div className="mb-4 flex items-center gap-2 px-1">
            <ChannelAvatar />
            <div>
              <p className="font-bold">똑보 강남구청</p>
              <p className="text-xs text-slate-400">대행사 계약 전: 실제 발송 대신 이 화면에서 확인합니다</p>
            </div>
          </div>
          {!data && <p className="text-center text-slate-400">불러오는 중…</p>}
          {data?.messages.length === 0 && (
            <p className="rounded-xl bg-white/5 p-4 text-center text-sm text-slate-300">
              아직 받은 알림톡이 없습니다. 휴대폰번호를 등록하고 줄을 서면, 호출·변경 안내가 여기에 표시됩니다.
            </p>
          )}
          <div className="space-y-6">
            {[...(data?.messages ?? [])].reverse().map((m) => (
              <KakaoBubble key={m.id} m={m} />
            ))}
          </div>
        </main>
      ) : (
        <main className="space-y-4 px-4 py-4">
          <p className="text-sm text-slate-600">
            카카오 비즈니스 채널에 아래 원문 그대로 검수를 신청합니다. 유형: <b>강조표기형</b>, 버튼: <b>웹링크(WL)</b>.
            <code className="mx-1">#{"{변수}"}</code>는 발송 때 채워집니다. 검수 후 문구를 바꾸면 새로 검수받아야 합니다.
          </p>
          {data?.templates.map((t) => (
            <section key={t.stage} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <div className="flex items-center justify-between">
                <h2 className="font-bold">{t.name}</h2>
                <code className="rounded bg-slate-100 px-2 py-0.5 text-xs">{t.code}</code>
              </div>
              <dl className="mt-3 space-y-2 text-sm">
                <Field label="강조표기 보조문구" value={t.emphasisSubtitle} />
                <Field label="강조표기 제목" value={t.emphasisTitle} />
                <Field label="본문" value={t.body} />
                <Field label="부가정보" value={t.extra} />
                <Field label="버튼 (WL)" value={t.button.name} />
              </dl>
            </section>
          ))}
        </main>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-slate-500">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap rounded-lg bg-slate-50 p-2 font-mono text-[13px]">{value}</dd>
    </div>
  );
}

function ChannelAvatar() {
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-teal-500 text-lg font-bold text-white">똑</div>
  );
}

/** 카카오 알림톡 말풍선 모양 (노란 헤더 + 강조표기 + 목록 + 버튼) */
function KakaoBubble({ m }: { m: Bubble }) {
  const [label, tone] = STATUS[m.status] ?? [m.status, "text-slate-300"];
  const time = new Date(m.createdAt).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
  return (
    <div className="flex gap-2">
      <ChannelAvatar />
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-sm text-slate-300">똑보</p>
        <div className="flex items-end gap-1.5">
          <div className={`w-full max-w-[300px] overflow-hidden rounded-2xl bg-white text-slate-900 ${m.status === "skipped" ? "opacity-60" : ""}`}>
            <div className="bg-[#FEE500] px-4 py-3 text-[15px] font-bold">알림톡 도착</div>
            <div className="px-4 pb-4 pt-4">
              <p className="text-sm text-slate-500">{m.emphasisSubtitle}</p>
              <p className="mt-0.5 text-2xl font-extrabold">{m.emphasisTitle}</p>
              <hr className="my-3 border-slate-200" />
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{m.text}</p>
              <p className="mt-3 whitespace-pre-wrap text-[13px] leading-snug text-slate-400">{m.extra}</p>
              <div className="mt-3 rounded-lg bg-slate-100 py-3 text-center text-[15px]">{m.button.name}</div>
            </div>
          </div>
          <span className="shrink-0 text-[11px] text-slate-400">{time}</span>
        </div>
        <p className={`mt-1 text-xs ${tone}`}>
          {label}
          {m.status === "skipped" && m.error ? ` · ${SKIP_REASON[m.error] ?? m.error}` : ""}
          {m.status === "failed" && m.error ? ` · ${m.error}` : ""}
        </p>
      </div>
    </div>
  );
}
