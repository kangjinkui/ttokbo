"use client";

import { useEffect, useState } from "react";
import { PhoneVerify } from "@/components/phone-verify";
import { Button, Card, ErrorText, TopBar, useClientValue } from "@/components/ui";
import { api } from "@/lib/client/api";

interface Prefs {
  prepare_enabled: boolean;
  prepare_by: "count" | "minutes";
  prepare_value: number;
  imminent_enabled: boolean;
  sms_for_prepare: boolean;
  sms_for_imminent: boolean;
}

export default function SettingsPage() {
  const [phone, setPhone] = useState<string | null>(null);
  const [changingPhone, setChangingPhone] = useState(false);
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

  // 새 번호의 인증번호 확인이 끝나면 저장한다 (번호가 로그인 아이디라 인증 없이 바꿀 수 없다)
  const savePhone = () =>
    run(async () => {
      const r = await api<{ phone: string }>("/api/me/contact", { method: "PUT" });
      setPhone(r.phone);
      setChangingPhone(false);
    }, "휴대폰 번호를 바꿨습니다. 다음 로그인부터 새 번호를 쓰세요.");

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
          <h2 className="font-bold">문자 호출</h2>
          <p className="mt-1 text-sm text-slate-500">
            <b>지금 입장</b>과 <b>취소·변경</b> 안내는 문자로 보냅니다. 문자의 링크로 로그인 없이 바로 응답할 수 있고, 보고 제목은 문자에 넣지 않습니다.
          </p>
          {changingPhone ? (
            <div className="mt-3 space-y-2">
              <PhoneVerify purpose="change" submitLabel="새 번호로 인증번호 받기" onVerified={savePhone} />
              <Button variant="ghost" size="sm" onClick={() => setChangingPhone(false)}>취소</Button>
            </div>
          ) : (
            <div className="mt-3 flex items-center justify-between rounded-xl bg-slate-50 p-3">
              <span className="font-semibold">{display ?? "등록된 번호 없음"}</span>
              <Button variant="ghost" size="sm" onClick={() => setChangingPhone(true)}>번호 변경</Button>
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500">이 번호로 로그인하고 호출 문자를 받습니다. 탈퇴(동의 철회)는 관리자에게 요청해 주세요.</p>
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
                <Check label="문자로도" checked={prefs.sms_for_prepare} onChange={(v) => savePrefs({ ...prefs, sms_for_prepare: v })} />
              </div>
            </Row>

            <Row title="임박 알림" desc="다음 순서가 되었을 때" checked={prefs.imminent_enabled} onChange={(v) => savePrefs({ ...prefs, imminent_enabled: v })}>
              <div className="mt-2 text-sm">
                <Check label="문자로도" checked={prefs.sms_for_imminent} onChange={(v) => savePrefs({ ...prefs, sms_for_imminent: v })} />
              </div>
            </Row>

            <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
              <b>지금 입장</b>·<b>변경/취소</b> 알림은 놓치면 안 되므로 끌 수 없습니다 (앱 + 문자).
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
