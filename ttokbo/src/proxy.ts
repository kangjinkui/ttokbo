import { NextResponse, type NextRequest } from "next/server";

// 세션 쿠키가 없으면 로그인으로 보낸다. 세션 검증과 권한 확인은 API에서 다시 한다.
export function proxy(request: NextRequest) {
  if (!request.cookies.has("tb_session")) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // 로그인, 1회용 호출 링크(/c/…), API, 정적 파일은 제외
  matcher: ["/((?!login|c/|api/|_next/|favicon.ico|manifest.webmanifest|icon|sw.js).*)"],
};
