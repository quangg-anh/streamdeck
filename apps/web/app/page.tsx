"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "@streamfx/types";
import { Empty, Field, message, Notice, request, text } from "./components/studio-ui";
export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const lock = useRef(false);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const value = await request<Project[]>("/api/projects"); if (!Array.isArray(value)) throw new Error("Danh sách dự án không hợp lệ."); setProjects(value); }
    catch (error) { setError(message(error)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <main className="app-shell" lang="vi">
    <nav className="topbar"><a className="brand" href="/">Stream<span>FX</span><small>LOCAL STUDIO</small></a><span className="badge">OBS · Browser Source</span></nav>
    <section className="home-hero"><p className="eyebrow">KHÔNG GIAN SÁNG TẠO CỦA BẠN</p><h1>Mỗi khoảnh khắc.<br /><em>Một hiệu ứng riêng.</em></h1><p>Điều khiển hình ảnh, âm thanh, giọng đọc và tương tác trực tiếp — ngay trên máy của bạn.</p><div className="chips"><span>01 / Tạo dự án</span><span>02 / Thêm hiệu ứng</span><span>03 / Kết nối OBS</span></div></section>
    <Notice error={error} status={status} />
    <div className="home-columns"><section className="panel"><header className="section-head"><div><p className="eyebrow">THƯ VIỆN</p><h2>Dự án của bạn <small>({projects.length})</small></h2></div><button className="ghost" disabled={loading || busy} onClick={() => void load()}>Tải lại</button></header>
      {loading ? <Empty>Đang tải dự án…</Empty> : !projects.length ? <Empty>{error ? "Chưa tải được dữ liệu. Kiểm tra API rồi chọn Tải lại." : "Chưa có dự án. Tạo không gian đầu tiên bên cạnh."}</Empty> : <div className="project-grid">{projects.map(project => <a className="project-card" key={project.id} href={`/project/${encodeURIComponent(project.id)}`}><span className="project-mark">FX</span><h3>{project.name}</h3><p>{project.description || "Chưa có mô tả"}</p><b>Mở studio ↗</b></a>)}</div>}
    </section><section className="panel create-panel"><p className="eyebrow">BẮT ĐẦU MỚI</p><h2>Tạo dự án</h2><form onSubmit={async event => {
      event.preventDefault(); if (lock.current) return; const form = event.currentTarget; const values = new FormData(form); lock.current = true; setBusy(true); setError(""); setStatus("");
      try { await request<Project>("/api/projects", "POST", { name: text(values, "name"), description: text(values, "description") }); form.reset(); setStatus("Đã tạo dự án. Chọn dự án để mở studio."); await load(); }
      catch (error) { setError(message(error)); } finally { lock.current = false; setBusy(false); }
    }}><fieldset disabled={busy}><Field label="Tên dự án"><input name="name" required maxLength={80} placeholder="Buổi live tối nay" /></Field><Field label="Mô tả"><textarea name="description" maxLength={500} rows={3} placeholder="Nội dung, phong cách, ghi chú…" /></Field><button type="submit">{busy ? "Đang tạo…" : "+ Tạo dự án"}</button></fieldset></form><p className="muted">Không tự phát hiệu ứng. Mọi thao tác phát đều do bạn chủ động.</p></section></div>
    <footer>StreamFX / Local creative control</footer>
  </main>;
}
