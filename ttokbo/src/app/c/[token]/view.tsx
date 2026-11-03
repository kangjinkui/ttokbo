"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CallPanel, FinishedPanel, WaitingPanel, type CallResponse, type RequestDetail } from "@/components/request-view";
import { ErrorText } from "@/components/ui";
import { api } from "@/lib/client/api";

/** 알림톡·문자 버튼으로 여는 1회용 호출 화면. 로그인 없이 이번 호출에만 응답할 수 있다. */
export function CallLinkPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<(RequestDetail & { valid: true }) | { valid: false; status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [responded, setResponded] = useState<CallResponse | null>(null);

  const load = useCallback(
    () =>
      api<(RequestDetail & { valid: true }) | { valid: false; status: string }>(`/api/c/${token}`).then(setData, (e: Error) => setError(e.message)),
    [token],
  );

  useEffect(() => {
    void load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <main className="mx-auto min-h-screen max-w-md space-y-4 px-4 py-6">
      <p className="text-center font-bold text-teal-700">똑보</p>
      <ErrorText error={error} />
      {data && !data.valid && (
        <p className="rounded-xl bg-amber-50 p-4 text-amber-900">
          {data.status === "called"
            ? "새 호출이 있어 이 링크는 만료되었습니다. 가장 최근 알림의 링크를 눌러 주세요."
            : "이미 처리되었거나 만료된 호출입니다. 똑보 앱에서 내 대기현황을 확인해 주세요."}
        </p>
      )}
      {data && data.valid && data.request.status === "called" && (
        <CallPanel
          detail={data}
          responded={responded}
          onRespond={async (r) => {
            await api(`/api/c/${token}`, { json: { response: r } });
            setResponded(r);
            await load();
          }}
        />
      )}
      {data && data.valid && data.request.status === "waiting" && <WaitingPanel detail={data} />}
      {data && data.valid && !["called", "waiting"].includes(data.request.status) && <FinishedPanel detail={data} />}
      <a href="/login" className="block text-center text-sm text-slate-500 underline">똑보 앱에서 보기</a>
    </main>
  );
}
