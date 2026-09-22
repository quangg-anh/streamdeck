"use client";
import { useEffect, useState } from "react";
import type { AdminUser, SessionUser } from "@streamfx/types";
import { Empty, Field, message, Notice, request, text } from "../components/studio-ui";

type Me = SessionUser & { deckLimit: number; planExpiresAt: string | null; projectCount: number; planActive: boolean };
type ProjectsResponse = { projects: { id: string; name: string; description: string }[]; deckLimit: number; planExpiresAt: string | null; planActive: boolean };
type AdminProject = { id: string; name: string; description: string; createdAt: string; _count: { buttons: number; effects: number } };
type UserProjects = { user: { id: string; username: string }; projects: AdminProject[] };

const fmtDate = (value: string | null) => value ? new Date(value).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
const daysLeft = (value: string | null) => value ? Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 86400000)) : null;

export function AdminPanel({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [quickCreating, setQuickCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [viewing, setViewing] = useState<UserProjects | null>(null);
  const load = async () => { try { setUsers(await request<AdminUser[]>("/api/admin/users")); } catch (error) { setError(message(error)); } };
  useEffect(() => { void load(); }, []);
  async function perform(work: () => Promise<unknown>, success: string) {
    setBusy(true); setError(""); setStatus("");
    try { await work(); setStatus(success); await load(); } catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  const viewDecks = async (user: AdminUser) => {
    setError(""); try { setViewing(await request<UserProjects>(`/api/admin/users/${encodeURIComponent(user.id)}/projects`)); } catch (error) { setError(message(error)); }
  };
  return <main className="app-shell" lang="vi">
    <nav className="topbar"><a className="brand" href="/">Stream<span>FX</span><small>ADMIN</small></a><div className="actions"><span className="badge">{me.username}</span><button className="ghost" onClick={onLogout}>Đăng xuất</button></div></nav>
    <Notice error={error} status={busy ? "Đang xử lý…" : status} />
    <section className="home-hero"><p className="eyebrow">QUẢN TRỊ</p><h1>Quản lý người dùng<br /><em>và gói stream deck</em></h1><p>Tạo tài khoản, cấp số lượng deck và thời hạn gói. Người dùng không thể tự đăng ký.</p></section>
    <div className="home-columns">
      <section className="panel">
        <header className="section-head"><div><p className="eyebrow">NGƯỜI DÙNG</p><h2>Danh sách <small>({users.length})</small></h2></div><div className="actions"><button disabled={busy} onClick={() => { setCreating(false); setQuickCreating(true); }}>+ Tạo tài khoản</button><button className="ghost" disabled={busy} onClick={() => { setQuickCreating(false); setCreating(true); }}>Tạo kèm gói</button><button className="ghost" disabled={busy} onClick={() => void load()}>Tải lại</button></div></header>
        {quickCreating && <form className="panel editor" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void perform(async () => { await request("/api/admin/users", "POST", { username: text(form, "username"), password: text(form, "password") }); setQuickCreating(false); }, "Đã tạo tài khoản (chưa có gói). Cấp gói trong Sửa khi cần."); }}><h3>Tài khoản mới — chưa có gói</h3><p className="muted">Chỉ cần tên đăng nhập và mật khẩu. Tài khoản tạo ra chưa có deck nào và chưa có thời hạn; cấp gói sau bằng nút Sửa.</p><div className="form-grid">
          <Field label="Tên đăng nhập"><input name="username" required minLength={3} maxLength={40} pattern="[a-zA-Z0-9_.\-]+" /></Field>
          <Field label="Mật khẩu" hint="Tối thiểu 8 ký tự"><input name="password" type="password" required minLength={8} /></Field>
        </div><div className="actions form-footer"><button disabled={busy}>Tạo</button><button type="button" className="ghost" onClick={() => setQuickCreating(false)}>Hủy</button></div></form>}
        {creating && <form className="panel editor" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void perform(async () => { await request("/api/admin/users", "POST", { username: text(form, "username"), password: text(form, "password"), role: text(form, "role"), deckLimit: Number(form.get("deckLimit")), planDays: Number(form.get("planDays")) }); setCreating(false); }, "Đã tạo người dùng."); }}><h3>Người dùng mới</h3><div className="form-grid">
          <Field label="Tên đăng nhập"><input name="username" required minLength={3} maxLength={40} pattern="[a-zA-Z0-9_.\-]+" /></Field>
          <Field label="Mật khẩu" hint="Tối thiểu 8 ký tự"><input name="password" type="password" required minLength={8} /></Field>
          <Field label="Vai trò"><select name="role" defaultValue="USER"><option value="USER">Người dùng</option><option value="ADMIN">Admin</option></select></Field>
          <Field label="Số stream deck" hint="0 = chưa có gói"><input name="deckLimit" type="number" min={0} max={1000} defaultValue={0} required /></Field>
          <Field label="Thời hạn gói (ngày)" hint="0 = chưa có gói"><input name="planDays" type="number" min={0} max={3650} defaultValue={0} required /></Field>
        </div><div className="actions form-footer"><button disabled={busy}>Tạo</button><button type="button" className="ghost" onClick={() => setCreating(false)}>Hủy</button></div></form>}
        {editing && <form className="panel editor" key={editing.id} onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); const body: Record<string, unknown> = {}; const password = text(form, "password"); if (password) body.password = password; body.deckLimit = Number(form.get("deckLimit")); body.planDays = Number(form.get("planDays")); body.blocked = form.has("blocked"); void perform(async () => { await request(`/api/admin/users/${encodeURIComponent(editing.id)}`, "PATCH", body); setEditing(null); }, "Đã cập nhật."); }}><h3>Sửa: {editing.username}</h3><div className="form-grid">
          <Field label="Mật khẩu mới" hint="Để trống giữ nguyên"><input name="password" type="password" minLength={8} /></Field>
          <Field label="Số stream deck" hint="0 = chưa có gói"><input name="deckLimit" type="number" min={0} max={1000} defaultValue={editing.deckLimit} required /></Field>
          <Field label="Gia hạn thêm (ngày)" hint={`HSD hiện tại: ${fmtDate(editing.planExpiresAt)}. 0 = giữ nguyên`}><input name="planDays" type="number" min={0} max={3650} defaultValue={0} required /></Field>
          <label className="check"><input type="checkbox" name="blocked" defaultChecked={editing.blocked} />Khóa tài khoản</label>
        </div><div className="actions form-footer"><button disabled={busy}>Lưu</button><button type="button" className="ghost" onClick={() => setEditing(null)}>Hủy</button></div></form>}
        {viewing && <div className="panel editor"><header className="section-head"><div><h3>Stream deck của {viewing.user.username} <small>({viewing.projects.length})</small></h3></div><button type="button" className="ghost" onClick={() => setViewing(null)}>Đóng</button></header>
          {!viewing.projects.length ? <Empty>Người dùng này chưa có stream deck nào.</Empty> : <div className="resource-list">{viewing.projects.map(project => <article className="resource" key={project.id}><div><span className="badge">Tạo {fmtDate(project.createdAt)}</span><h3>{project.name}</h3><p>{project.description || "Chưa có mô tả"} · {project._count.effects} hiệu ứng · {project._count.buttons} nút</p></div><div className="actions"><a className="button-link ghost compact" href={`/project/${encodeURIComponent(project.id)}`}>Mở studio ↗</a></div></article>)}</div>}
        </div>}
        {!users.length ? <Empty>Chưa có người dùng nào.</Empty> : <div className="resource-list">{users.map(user => <article className="resource" key={user.id}>
          <div><span className="badge">{user.role === "ADMIN" ? "Admin" : user.blocked ? "Đã khóa" : user.deckLimit === 0 ? "Chưa có gói" : "Đang hoạt động"}</span><h3>{user.username}</h3><p>{user.projectCount}/{user.deckLimit} deck · HSD: {fmtDate(user.planExpiresAt)}{daysLeft(user.planExpiresAt) !== null ? ` (còn ${daysLeft(user.planExpiresAt)} ngày)` : ""}</p></div>
          <div className="actions"><button className="ghost" disabled={busy} onClick={() => { setEditing(null); void viewDecks(user); }}>Xem deck</button><button className="ghost" disabled={busy} onClick={() => { setViewing(null); setEditing(user); }}>Sửa</button><button className="danger" disabled={busy || user.id === me.id} onClick={() => { if (window.confirm(`Xóa người dùng “${user.username}” cùng toàn bộ dự án?`)) void perform(() => request(`/api/admin/users/${encodeURIComponent(user.id)}`, "DELETE"), "Đã xóa."); }}>Xóa</button></div>
        </article>)}</div>}
      </section>
      <section className="panel create-panel"><p className="eyebrow">GÓI DỊCH VỤ</p><h2>Cách cấp gói</h2><p className="muted">Dùng <strong>+ Tạo tài khoản</strong> để tạo nhanh tài khoản chưa có gói (0 deck, không thời hạn) — cấp gói sau bằng nút Sửa khi khách mua. Hoặc dùng form đầy đủ để đặt ngay số deck và số ngày.</p><p className="muted">Khi gia hạn, số ngày được cộng vào HSD hiện tại. Người dùng chưa có gói hoặc hết hạn sẽ không tạo thêm deck nhưng vẫn xem được dự án hiện có.</p></section>
    </div>
    <footer>StreamFX / Admin console</footer>
  </main>;
}

export function UserDashboard({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [data, setData] = useState<ProjectsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const load = async () => { setLoading(true); try { setData(await request<ProjectsResponse>("/api/projects")); setError(""); } catch (error) { setError(message(error)); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const remaining = data ? Math.max(0, data.deckLimit - data.projects.length) : 0;
  const expired = data && !data.planActive;
  return <main className="app-shell" lang="vi">
    <nav className="topbar"><a className="brand" href="/">Stream<span>FX</span><small>STUDIO</small></a><div className="actions"><span className="badge">{me.username}{me.role === "ADMIN" ? " · Admin" : ""}</span><button className="ghost" onClick={onLogout}>Đăng xuất</button></div></nav>
    <Notice error={error} status={busy ? "Đang xử lý…" : status} />
    <section className="home-hero"><p className="eyebrow">KHÔNG GIAN SÁNG TẠO CỦA BẠN</p><h1>Mỗi khoảnh khắc.<br /><em>Một hiệu ứng riêng.</em></h1><div className="chips"><span>Gói: {data?.deckLimit ?? "…"} deck</span><span>HSD: {fmtDate(data?.planExpiresAt ?? null)}{daysLeft(data?.planExpiresAt ?? null) !== null ? ` (còn ${daysLeft(data?.planExpiresAt ?? null)} ngày)` : ""}</span><span>Còn lại: {remaining} deck</span></div></section>
    {expired && <div className="notice error">Gói stream deck đã hết hạn. Bạn vẫn xem được dự án hiện có; liên hệ admin để gia hạn trước khi tạo mới hoặc phát hiệu ứng.</div>}
    <div className="home-columns">
      <section className="panel">
        <header className="section-head"><div><p className="eyebrow">THƯ VIỆN</p><h2>Stream deck của bạn <small>({data?.projects.length ?? 0})</small></h2></div><button className="ghost" disabled={loading || busy} onClick={() => void load()}>Tải lại</button></header>
        {loading ? <Empty>Đang tải…</Empty> : !data?.projects.length ? <Empty>Chưa có stream deck nào. Tạo deck đầu tiên bên cạnh.</Empty> : <div className="project-grid">{data.projects.map(project => <a className="project-card" key={project.id} href={`/project/${encodeURIComponent(project.id)}`}><span className="project-mark">FX</span><h3>{project.name}</h3><p>{project.description || "Chưa có mô tả"}</p><b>Mở studio ↗</b></a>)}</div>}
      </section>
      <section className="panel create-panel">
        <p className="eyebrow">BẮT ĐẦU MỚI</p><h2>Tạo stream deck</h2>
        {expired ? <p className="muted">Gói đã hết hạn — không thể tạo deck mới. Liên hệ admin để gia hạn.</p> : remaining <= 0 ? <p className="muted">Đã dùng hết {data?.deckLimit} deck của gói. Liên hệ admin để nâng cấp số lượng.</p> : <form onSubmit={async event => {
          event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); setBusy(true); setError(""); setStatus("");
          try { await request("/api/projects", "POST", { name: text(values, "name"), description: text(values, "description") }); form.reset(); setStatus("Đã tạo stream deck."); await load(); } catch (error) { setError(message(error)); } finally { setBusy(false); }
        }}><fieldset disabled={busy}><Field label="Tên deck"><input name="name" required maxLength={80} placeholder="Buổi live tối nay" /></Field><Field label="Mô tả"><textarea name="description" maxLength={500} rows={3} /></Field><button type="submit">{busy ? "Đang tạo…" : "+ Tạo deck"}</button></fieldset></form>}
        <p className="muted">Còn {remaining}/{data?.deckLimit ?? 0} deck khả dụng.</p>
      </section>
    </div>
    <footer>StreamFX / Local creative control</footer>
  </main>;
}
