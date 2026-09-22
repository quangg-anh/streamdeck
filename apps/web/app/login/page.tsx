"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Brand, Field, Icon, message, request } from "../components/studio-ui";

export default function Login() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [show, setShow] = useState(false);
  useEffect(() => { void request("/api/auth/me").then(() => router.replace("/")).catch(() => {}); }, [router]);
  return <main className="app-shell auth-shell" lang="vi">
    <section className="auth-card">
      <Brand suffix="STUDIO" />
      <p className="eyebrow">ĐĂNG NHẬP</p>
      <h1>Một cổng cho<br /><em>admin &amp; người dùng</em></h1>
      <p className="muted">Tài khoản do admin cấp phát. Không hỗ trợ tự đăng ký.</p>
      <form onSubmit={async event => {
        event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); setBusy(true); setError("");
        try {
          await request("/api/auth/login", "POST", { username: String(values.get("username") ?? "").trim(), password: String(values.get("password") ?? "") });
          router.replace("/"); router.refresh();
        } catch (error) { setError(message(error)); } finally { setBusy(false); }
      }}>
        <Field label="Tên đăng nhập"><input name="username" required minLength={3} maxLength={40} autoComplete="username" autoFocus placeholder="nhap-ten-cua-ban" /></Field>
        <Field label="Mật khẩu">
          <div style={{ position: "relative" }}>
            <input name="password" type={show ? "text" : "password"} required minLength={8} autoComplete="current-password" placeholder="••••••••" style={{ paddingRight: 46 }} />
            <button type="button" className="ghost compact" aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"} aria-pressed={show} onClick={() => setShow(value => !value)}
              style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", minWidth: 34, padding: 5, background: "transparent", border: "none", boxShadow: "none" }}>
              <Icon name={show ? "close" : "eye"} />
            </button>
          </div>
        </Field>
        {error && <div role="alert" className="notice error" style={{ margin: 0 }}><Icon name="alert" />{error}</div>}
        <button type="submit" disabled={busy}>{busy ? "Đang đăng nhập…" : <><Icon name="logout" />Đăng nhập</>}</button>
      </form>
      <p className="muted small" style={{ marginTop: 18, textAlign: "center" }}>Chưa có tài khoản? Liên hệ admin để được cấp.</p>
    </section>
  </main>;
}
