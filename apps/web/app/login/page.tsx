"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Field, message, request } from "../components/studio-ui";

export default function Login() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void request("/api/auth/me").then(() => router.replace("/")).catch(() => {}); }, [router]);
  return <main className="app-shell auth-shell" lang="vi">
    <section className="auth-card">
      <a className="brand" href="/">Stream<span>FX</span><small>STUDIO</small></a>
      <p className="eyebrow">ĐĂNG NHẬP</p>
      <h1>Một cổng cho<br /><em>admin & người dùng</em></h1>
      <p className="muted">Tài khoản do admin cấp phát. Không hỗ trợ tự đăng ký.</p>
      <form onSubmit={async event => {
        event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); setBusy(true); setError("");
        try {
          await request("/api/auth/login", "POST", { username: String(values.get("username") ?? "").trim(), password: String(values.get("password") ?? "") });
          router.replace("/"); router.refresh();
        } catch (error) { setError(message(error)); } finally { setBusy(false); }
      }}>
        <Field label="Tên đăng nhập"><input name="username" required minLength={3} maxLength={40} autoComplete="username" autoFocus /></Field>
        <Field label="Mật khẩu"><input name="password" type="password" required minLength={8} autoComplete="current-password" /></Field>
        {error && <div role="alert" className="notice error">{error}</div>}
        <button type="submit" disabled={busy}>{busy ? "Đang đăng nhập…" : "Đăng nhập"}</button>
      </form>
      <p className="muted small">Chưa có tài khoản? Liên hệ admin để được cấp.</p>
    </section>
  </main>;
}
