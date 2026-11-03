import type { Metadata, Viewport } from "next";
import { LiveProvider } from "@/components/live";
import "./globals.css";

export const metadata: Metadata = {
  title: "똑보 — 줄 없이 보고하기",
  description: "자리에서 대면보고 줄을 서고, 차례가 오면 알림을 받는 강남구청 보고대기 서비스",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "똑보", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#0d9488",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full bg-slate-50 text-slate-900">
        <LiveProvider>{children}</LiveProvider>
      </body>
    </html>
  );
}
