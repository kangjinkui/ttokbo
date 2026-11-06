"use client";

import { useEffect } from "react";
import { api } from "@/lib/client/api";

export default function Root() {
  useEffect(() => {
    api<{ user: { role: string; approved: boolean } }>("/api/me")
      .then(({ user }) => {
        if (!user.approved) return location.replace("/pending");
        location.replace(user.role === "secretary" || user.role === "admin" ? "/desk" : user.role === "display" ? "/board/1" : "/home");
      })
      .catch(() => {});
  }, []);
  return <main className="p-8 text-center text-slate-500">불러오는 중…</main>;
}
