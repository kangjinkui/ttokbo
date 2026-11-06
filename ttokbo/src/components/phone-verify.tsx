"use client";

import { useEffect, useRef, useState } from "react";
import { Button, ErrorText } from "@/components/ui";
import { api } from "@/lib/client/api";

const INPUT = "w-full rounded-xl px-4 py-3.5 text-lg ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-teal-500";

/** 010-1234-5678 형태로 보이게 한다 (입력값 자체는 숫자만 보낸다) */
function formatPhone(digits: string) {
  if (digits.length < 4) return digits;
  if (digits.length < 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

/**
 * 휴대폰 번호 → 문자 인증번호 2단계. 인증번호 6자리를 다 넣으면 바로 확인한다.
 * onVerified에는 /api/auth/verify 응답이 그대로 넘어간다.
 */
export function PhoneVerify<T>({ purpose = "login", submitLabel = "인증번호 받기", onVerified }: {
  purpose?: "login" | "change";
  submitLabel?: string;
  onVerified: (result: T) => void;
}) {
  const [digits, setDigits] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/code", { json: { phone: digits } });
      setStep("code");
      setCode("");
      setNotice(`${formatPhone(digits)}(으)로 인증번호를 보냈어요.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(value: string) {
    setBusy(true);
    setError(null);
    try {
      onVerified(await api<T>("/api/auth/verify", { json: { phone: digits, code: value, purpose } }));
    } catch (e) {
      setError((e as Error).message);
      setCode("");
      setBusy(false);
    }
  }

  if (step === "phone") {
    return (
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void sendCode();
        }}
      >
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-slate-600">휴대폰 번호</span>
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            placeholder="010-0000-0000"
            value={formatPhone(digits)}
            onChange={(e) => setDigits(e.target.value.replace(/\D/g, "").slice(0, 11))}
            className={INPUT}
            autoFocus
          />
        </label>
        <ErrorText error={error} />
        <Button type="submit" size="lg" className="w-full" disabled={busy || digits.length < 10}>
          {busy ? "보내는 중…" : submitLabel}
        </Button>
      </form>
    );
  }

  return (
    <div className="space-y-3">
      {notice && <p className="text-sm text-slate-600">{notice}</p>}
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-slate-600">인증번호 6자리</span>
        <input
          ref={codeRef}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          value={code}
          disabled={busy}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 6);
            setCode(v);
            if (v.length === 6) void verify(v);
          }}
          className={`${INPUT} text-center tracking-[0.5em]`}
        />
      </label>
      <ErrorText error={error} />
      <div className="flex justify-between text-sm">
        <button type="button" className="text-slate-500 underline" onClick={() => { setStep("phone"); setError(null); }}>
          번호 다시 입력
        </button>
        <button type="button" className="text-teal-700 underline" disabled={busy} onClick={sendCode}>
          인증번호 다시 받기
        </button>
      </div>
    </div>
  );
}
