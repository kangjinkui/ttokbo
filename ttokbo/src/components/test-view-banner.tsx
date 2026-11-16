"use client";

import { useClientValue } from "@/components/ui";

const COOKIE = "tb_test_view";

function readTestView() {
  const raw = document.cookie.split("; ").find((c) => c.startsWith(`${COOKIE}=`));
  return raw ? decodeURIComponent(decodeURIComponent(raw.slice(COOKIE.length + 1))) : "";
}

/** 관리자가 시험 계정으로 전환해 보는 동안 모든 화면 위에 띄운다 */
export function TestViewBanner() {
  const name = useClientValue(readTestView, "");
  if (!name) return null;

  async function back() {
    await fetch("/api/auth/return", { method: "POST" });
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- 세션이 바뀌므로 실시간 연결까지 새로 맺는다
    window.location.assign("/admin");
  }

  return (
    <div role="status" className="flex items-center justify-center gap-3 bg-amber-400 px-4 py-2 text-sm font-semibold text-amber-950">
      <span>시험 계정 「{name}」으로 보는 중</span>
      <button onClick={back} className="rounded-lg bg-amber-950 px-3 py-1 text-white">관리자로 돌아가기</button>
    </div>
  );
}
