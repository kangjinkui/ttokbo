"use client";

import { useEffect, useState } from "react";
import { Button, Card, ErrorText, TopBar, useClientValue } from "@/components/ui";
import { api } from "@/lib/client/api";

interface Prefs {
  prepare_enabled: boolean;
  prepare_by: "count" | "minutes";
  prepare_value: number;
  imminent_enabled: boolean;
  kakao_for_prepare: boolean;
  kakao_for_imminent: boolean;
}

export default function SettingsPage() {
  const [phone, setPhone] = useState<string | null>(null);
  const [phoneInput, setPhoneInput] = useState("");
  const [consent, setConsent] = useState(false);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supportedPerm = useClientValue<string>(() => (typeof Notification === "undefined" ? "unsupported" : Notification.permission), "unsupported");
  const [askedPerm, setPerm] = useState<string | null>(null);
  const perm = askedPerm ?? supportedPerm;

  useEffect(() => {
    api<{ phone: string | null; prefs: Prefs }>("/api/me").then((d) => {
      setPhone(d.phone);
      setPrefs(d.prefs);
    });
  }, []);

  async function run(fn: () => Promise<void>, done: string) {
    setError(null);
    setMsg(null);
    try {
      await fn();
      setMsg(done);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const savePhone = () =>
    run(async () => {
      const r = await api<{ phone: string }>("/api/me/contact", { method: "PUT", json: { phone: phoneInput, consent } });
      setPhone(r.phone);
      setPhoneInput("");
    }, "휴대폰번호를 등록했습니다.");

  const removePhone = () => {
    if (!confirm("번호를 삭제하면 카카오톡·문자 호출을 받지 못합니다. 삭제할까요?")) return;
    return run(async () => {
      await api("/api/me/contact", { method: "DELETE" });
      setPhone(null);
    }, "번호를 삭제했습니다.");
  };

  const savePrefs = (next: Prefs) =>
    run(async () => {
      setPrefs(next);
      await api("/api/me/prefs", { method: "PUT", json: next });
    }, "알림 설정을 저장했습니다.");

  const display = phone ? phone.replace(/^\+82/, "0").replace(/(\d{3})(\d{3,4})(\d{4})/, "$1-$2-$3") : null;

  return (
    <div className="mx-auto min-h-screen max-w-md pb-10">
      <TopBar title="알림 설정" back="/home" />
      <main className="space-y-4 px-4 pt-4">
        <Card>
          <h2 className="font-bold">카카오톡·문자 호출</h2>
          <p className="mt-1 text-sm text-slate-500">
            <b>지금 입장</b>과 <b>취소·변경</b> 안내는 카카오 알림톡으로 보내고, 실패하면 문자로 다시 보냅니다. 보고 제목은 메시지에 넣지 않습니다.
          </p>
          {phone ? (
            <div className="mt-3 flex items-center justify-between rounded-xl bg-slate-50 p-3">
              <span className="font-semibold">{display}</span>
              <Button variant="ghost" size="sm" onClick={removePhone}>삭제(동의 철회)</Button>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <input
                inputMode="tel"
                autoComplete="tel"
                placeholder="010-0000-0000"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                aria-label="휴대폰번호"
                className="w-full rounded-xl px-3 py-3 ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-teal-500"
              />
              <label className="flex items-start gap-2 text-sm text-slate-600">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>
                  [필수] 보고 호출 알림 발송을 위해 휴대폰번호를 수집·이용하는 데 동의합니다. 목적: 알림톡·문자 발송 / 보유: 동의 철회 또는 퇴직 시까지.
                </span>
              </label>
              <Button className="w-full" disabled={!phoneInput || !consent} onClick={savePhone}>등록</Button>
            </div>
          )}
        </Card>

        {prefs && (
          <Card className="space-y-4">
            <h2 className="font-bold">단계별 알림</h2>
            <p className="-mt-2 text-sm text-slate-500">순번이 바뀔 때마다 알림을 보내지 않습니다. 아래 단계에서만 알려드려요.</p>

            <Row
              title="준비 알림"
              desc="곧 차례가 다가올 때"
              checked={prefs.prepare_enabled}
              onChange={(v) => savePrefs({ ...prefs, prepare_enabled: v })}
            >
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <select
                  value={prefs.prepare_by}
                  aria-label="준비 알림 기준"
                  onChange={(e) => {
                    const by = e.target.value as Prefs["prepare_by"];
                    void savePrefs({ ...prefs, prepare_by: by, prepare_value: by === "count" ? 3 : 15 });
                  }}
                  className="rounded-lg px-2 py-1.5 ring-1 ring-slate-300"
                >
                  <option value="count">내 앞 건수</option>
                  <option value="minutes">예상 시간</option>
                </select>
                <select
                  value={prefs.prepare_value}
                  aria-label="준비 알림 값"
                  onChange={(e) => savePrefs({ ...prefs, prepare_value: Number(e.target.value) })}
                  className="rounded-lg px-2 py-1.5 ring-1 ring-slate-300"
                >
                  {(prefs.prepare_by === "count" ? [1, 2, 3, 4, 5] : [5, 10, 15, 20, 30]).map((v) => (
                    <option key={v} value={v}>
                      {prefs.prepare_by === "count" ? `${v}건 남았을 때` : `${v}분 전`}
                    </option>
                  ))}
                </select>
                <Check label="카톡으로도" checked={prefs.kakao_for_prepare} onChange={(v) => savePrefs({ ...prefs, kakao_for_prepare: v })} />
              </div>
            </Row>

            <Row title="임박 알림" desc="다음 순서가 되었을 때" checked={prefs.imminent_enabled} onChange={(v) => savePrefs({ ...prefs, imminent_enabled: v })}>
              <div className="mt-2 text-sm">
                <Check label="카톡으로도" checked={prefs.kakao_for_imminent} onChange={(v) => savePrefs({ ...prefs, kakao_for_imminent: v })} />
              </div>
            </Row>

            <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
              <b>지금 입장</b>·<b>변경/취소</b> 알림은 놓치면 안 되므로 끌 수 없습니다 (앱 + 카카오톡/문자).
            </div>
          </Card>
        )}

        <Card>
          <h2 className="font-bold">이 기기 화면 알림</h2>
          <p className="mt-1 text-sm text-slate-500">똑보를 열어 둔 동안 다른 창을 보고 있어도 알림이 뜹니다.</p>
          {perm === "granted" ? (
            <p className="mt-2 text-sm font-semibold text-emerald-700">허용됨</p>
          ) : perm === "unsupported" ? (
            <p className="mt-2 text-sm text-slate-500">이 브라우저는 지원하지 않습니다.</p>
          ) : (
            <Button className="mt-3" variant="secondary" onClick={async () => setPerm(await Notification.requestPermission())}>
              알림 허용
            </Button>
          )}
        </Card>

        <ErrorText error={error} />
        {msg && <p role="status" className="text-center text-sm text-emerald-700">{msg}</p>}
      </main>
    </div>
  );
}

function Row({ title, desc, checked, onChange, children }: { title: string; desc: string; checked: boolean; onChange: (v: boolean) => void; children?: React.ReactNode }) {
  return (
    <div>
      <label className="flex items-center justify-between">
        <span>
          <span className="block font-semibold">{title}</span>
          <span className="text-sm text-slate-500">{desc}</span>
        </span>
        <input type="checkbox" role="switch" className="h-5 w-5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      </label>
      {checked && children}
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-1.5">
      <input type="checkbox" className="h-4 w-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
