import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 서버(메모리가 빠듯한 공유 서버)에서 빌드하지 않도록, 실행에 필요한 파일만 모은 완성본을 만든다 (deploy/push.sh)
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  // PGlite는 wasm·데이터 파일을 자체 경로에서 읽으므로 번들하지 않는다.
  serverExternalPackages: ["@electric-sql/pglite"],
  // 휴대폰 시험용 ngrok 터널 주소에서 개발 서버 자원을 허용한다.
  allowedDevOrigins: ["*.ngrok-free.dev", "*.ngrok-free.app"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
