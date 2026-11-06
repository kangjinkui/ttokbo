import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
