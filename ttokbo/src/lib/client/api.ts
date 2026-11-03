"use client";

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    method: init?.method ?? (init?.json !== undefined ? "POST" : "GET"),
    headers: init?.json !== undefined ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !location.pathname.startsWith("/login") && !location.pathname.startsWith("/c/")) {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- 세션 만료: 전체 새로고침으로 로그인 이동
      window.location.assign(`/login?next=${encodeURIComponent(location.pathname)}`);
    }
    throw new ApiError(data?.error?.code ?? "ERROR", data?.error?.message ?? "요청에 실패했습니다.", res.status);
  }
  return data as T;
}

export function newIdempotencyKey() {
  return crypto.randomUUID();
}
