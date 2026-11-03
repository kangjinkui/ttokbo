"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useLiveQuery } from "@/components/live";
import { CallPanel, FinishedPanel, WaitingPanel, type CallResponse, type RequestDetail } from "@/components/request-view";
import { Button, Card, ErrorText, SyncStatus, TopBar } from "@/components/ui";
import { api } from "@/lib/client/api";

export function MyRequestPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, updatedAt, connected, reload } = useLiveQuery<RequestDetail>(`/api/requests/${id}`);
  const [responded, setResponded] = useState<CallResponse | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(path: string, json: unknown, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    setActionError(null);
    try {
      await api(path, { json });
      await reload();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const s = data?.request.status;
  return (
    <div className="mx-auto min-h-screen max-w-md pb-10">
      <TopBar title="내 대기현황" back="/home" />
      <main className="space-y-4 px-4 pt-4">
        <SyncStatus connected={connected} updatedAt={updatedAt} error={error} />
        {!data && !error && <p className="text-slate-400">불러오는 중…</p>}
        {error && !data && <ErrorText error={error.message} />}

        {data && s === "called" && (
          <CallPanel
            detail={data}
            responded={responded}
            onRespond={async (r) => {
              await api(`/api/requests/${id}/respond`, { json: { response: r } });
              setResponded(r);
              await reload();
            }}
          />
        )}
        {data && s === "waiting" && <WaitingPanel detail={data} />}
        {data && s && !["waiting", "called"].includes(s) && <FinishedPanel detail={data} />}

        {data && s === "waiting" && (
          <Card>
            <div className="flex items-center justify-between">
              <p className="font-semibold">순서 미루기</p>
              <p className="text-sm text-slate-500">남은 횟수 {data.request.defersLeft}/5</p>
            </div>
            <p className="mt-1 text-sm text-slate-500">회의 등으로 늦어지면 뒤 순번에게 양보하세요.</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[1, 2, 3].map((n) => (
                <Button
                  key={n}
                  variant="secondary"
                  disabled={busy || data.request.defersLeft <= 0 || data.position == null || data.position >= data.queueLength}
                  onClick={() => act(`/api/requests/${id}/defer`, { steps: n })}
                >
                  {n}칸 뒤로
                </Button>
              ))}
            </div>
            {data.position != null && data.position >= data.queueLength && data.request.defersLeft > 0 && (
              <p className="mt-2 text-sm text-slate-500">지금 마지막 순서라 더 미룰 수 없습니다.</p>
            )}
            {data.request.defersLeft <= 0 && <p className="mt-2 text-sm text-rose-600">미루기 5회를 모두 썼습니다. 필요하면 취소 후 다시 줄을 서 주세요.</p>}
          </Card>
        )}

        <ErrorText error={actionError} />

        {data && (s === "waiting" || s === "held") && (
          <Button variant="danger" className="w-full" disabled={busy} onClick={() => act(`/api/requests/${id}/cancel`, {}, "보고 신청을 취소할까요?")}>
            신청 취소
          </Button>
        )}

        {data?.request.title && <p className="text-center text-sm text-slate-500">보고 제목: {data.request.title}</p>}
      </main>
    </div>
  );
}
