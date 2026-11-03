import { Suspense } from "react";
import { MyRequestPage } from "./view";

// 경로 값(useParams)은 요청 시점에만 알 수 있으므로 Suspense 안에서 렌더링한다.
export default function Page() {
  return (
    <Suspense fallback={<p className="p-8 text-center text-slate-400">불러오는 중…</p>}>
      <MyRequestPage />
    </Suspense>
  );
}
