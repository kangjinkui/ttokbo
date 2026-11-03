import "server-only";
import { unstable_rethrow } from "next/navigation";
import { QueueError } from "./queue/types";

export function ok(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

export function fail(err: unknown) {
  // 프리렌더 중단 등 Next.js 내부 신호는 삼키지 않는다
  unstable_rethrow(err);
  if (err instanceof QueueError) {
    return Response.json({ error: { code: err.code, message: err.message } }, { status: err.status });
  }
  // 고유 제약 위반(동시 신청 등)은 사용자에게 이해 가능한 메시지로 바꾼다.
  if (typeof err === "object" && err && "code" in err && (err as { code: string }).code === "23505") {
    return Response.json({ error: { code: "CONFLICT", message: "이미 처리된 요청입니다. 화면을 새로고침해 주세요." } }, { status: 409 });
  }
  console.error(err);
  return Response.json({ error: { code: "INTERNAL", message: "일시적인 오류가 발생했습니다." } }, { status: 500 });
}

export async function handle(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (err) {
    return fail(err);
  }
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new QueueError("BAD_JSON", "요청 형식이 올바르지 않습니다.");
  }
}

export function intParam(value: string, name = "id") {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new QueueError("BAD_PARAM", `${name} 값이 올바르지 않습니다.`);
  return n;
}
