"use client";
import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "@streamfx/types";
import { AdminPanel, UserDashboard } from "./components/admin-panel";
import { Empty, Notice, request } from "./components/studio-ui";

type Me = SessionUser & { deckLimit: number; planExpiresAt: string | null; projectCount: number; planActive: boolean };

export default function Home() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    request<Me>("/api/auth/me").then(value => { if (active) setMe(value); }).catch(() => { if (active) window.location.assign("/login"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const logout = useCallback(async () => {
    try { await request("/api/auth/logout", "POST"); } catch { /* ignore */ }
    window.location.assign("/login");
  }, []);
  if (loading) return <main className="app-shell" lang="vi"><nav className="topbar"><a className="brand" href="/">Stream<span>FX</span><small>STUDIO</small></a></nav><Empty>Đang tải…</Empty></main>;
  if (!me) return <main className="app-shell" lang="vi"><nav className="topbar"><a className="brand" href="/">Stream<span>FX</span><small>STUDIO</small></a></nav><Notice error={error || "Phiên đăng nhập hết hạn."} status="" /><Empty><a className="button-link" href="/login">Đến trang đăng nhập</a></Empty></main>;
  if (me.role === "ADMIN") return <AdminPanel me={me} onLogout={logout} />;
  return <UserDashboard me={me} onLogout={logout} />;
}
