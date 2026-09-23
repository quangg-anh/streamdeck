"use client";
import { use, useCallback, useEffect, useRef, useState } from "react";
import type { Asset, DeckButton, Effect, Project, Settings } from "@streamfx/types";
import EffectEditor, { assetUrl } from "../../components/effect-editor";
import { Brand, Check, Empty, Field, Icon, message, Modal, Notice, number, request, text, useConfirm, useToasts } from "../../components/studio-ui";

type Data = Project & { overlayToken: string; effects: Effect[]; buttons: DeckButton[]; assets: Asset[]; settings: Settings | null };
type Tab = "deck" | "effects" | "assets" | "settings";
const tabs: [Tab, string, string][] = [["deck", "Bàn điều khiển", "bolt"], ["effects", "Hiệu ứng", "sparkles"], ["assets", "Thư viện", "image"], ["settings", "Cài đặt", "settings"]];
const defaults: Settings = { projectId: "", volume: 1, queueLimit: 20, developerMode: false };

/* Asset preview: real video frame when possible, graceful label fallback. */
function AssetPreview({ mime, url, name }: { mime: string; url: string; name: string }) {
  const [broken, setBroken] = useState(false);
  const isImage = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  return <div className="asset-preview">
    {isImage ? <img src={url} alt={name} loading="lazy" decoding="async" onError={() => setBroken(true)} />
      : isVideo && !broken ? <video src={`${url}#t=0.1`} preload="metadata" muted playsInline tabIndex={-1} onError={() => setBroken(true)} />
      : <span><Icon name={isVideo ? "play" : "bolt"} />{isVideo ? "VIDEO" : "AUDIO"}</span>}
  </div>;
}
export default function Studio({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const base = `/api/projects/${encodeURIComponent(id)}`;
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("deck");
  const [editor, setEditor] = useState<Effect | "new" | null>(null);
  const [buttonEditor, setButtonEditor] = useState<DeckButton | "new" | null>(null);
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [overlayUrl, setOverlayUrl] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteName, setDeleteName] = useState("");
  const [obsOpen, setObsOpen] = useState(false);
  const [clearArmed, setClearArmed] = useState(false);
  const [playing, setPlaying] = useState<{ id: string; until: number } | null>(null);
  const lock = useRef(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const playingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { clearTimeout(clearTimer.current); clearTimeout(playingTimer.current); }, []);
  const { push, host } = useToasts();
  const { confirm, dialog } = useConfirm();
  const load = useCallback(async () => {
    const value = await request<Data>(base);
    if (!value || !Array.isArray(value.effects) || !Array.isArray(value.buttons) || !Array.isArray(value.assets)) throw new Error("Dữ liệu dự án không hợp lệ.");
    setData(value);
  }, [base]);
  useEffect(() => { let active = true; setLoading(true); setData(null); setError(""); request<Data>(base).then(loaded => { if (!loaded || !Array.isArray(loaded.effects) || !Array.isArray(loaded.assets) || !Array.isArray(loaded.buttons)) throw new Error("Dữ liệu dự án không hợp lệ."); if (active) { setData(loaded); setOverlayUrl(`${window.location.origin}/overlay/${encodeURIComponent(id)}?token=${encodeURIComponent(loaded.overlayToken)}`); } }).catch(error => { if (active) { setError(message(error)); if (message(error).startsWith("HTTP 401")) window.location.assign("/login"); } }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [base, id]);
  async function perform(work: () => Promise<unknown>, success: string, refresh = true, done?: () => void) {
    if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try { await work(); if (success) push("success", success); done?.(); if (refresh) { try { await load(); setRevision(value => value + 1); } catch (error) { setError(`Thao tác đã thành công nhưng chưa tải lại được dữ liệu. ${message(error)}`); } } }
    catch (error) { setError(message(error)); push("error", message(error)); } finally { lock.current = false; setBusy(false); }
  }
  function save(kind: string, item: { id: string } | "new", body: unknown, done: () => void) { void perform(() => request(`${base}/${kind}${item === "new" ? "" : `/${encodeURIComponent(item.id)}`}`, item === "new" ? "POST" : "PATCH", body), "Đã lưu thay đổi.", true, done); }
  async function remove(kind: string, item: { id: string }, warning: React.ReactNode, title: string) { if (await confirm({ title, danger: true, confirmLabel: "Xóa", message: warning })) void perform(() => request(`${base}/${kind}/${encodeURIComponent(item.id)}`, "DELETE"), "Đã xóa."); }
  async function switchTab(next: Tab) { if ((editor || buttonEditor) && !await confirm({ title: "Rời khỏi trình sửa", message: "Bỏ các thay đổi chưa lưu trong trình sửa?" })) return; setEditor(null); setButtonEditor(null); setTab(next); }
  async function reload() { if (!await confirm({ title: "Tải lại dữ liệu", message: "Các thay đổi chưa lưu có thể bị mất. Tiếp tục?" })) return; void perform(load, "Đã tải lại.", false, () => { setEditor(null); setButtonEditor(null); setRevision(value => value + 1); }); }
  async function discardAnd(close: () => void) { if (await confirm({ title: "Bỏ thay đổi", message: "Bỏ thay đổi chưa lưu?" })) close(); }
  function clearQueue() { void perform(() => request(`${base}/control`, "POST", { type: "clear" }), "Đã xóa hàng đợi trên overlay.", false); }
  function handleClearTap() {
    if (!clearArmed) { setClearArmed(true); clearTimeout(clearTimer.current); clearTimer.current = setTimeout(() => setClearArmed(false), 3000); return; }
    clearTimeout(clearTimer.current); setClearArmed(false); clearQueue();
  }
  function fireButton(button: DeckButton) {
    const effect = data?.effects.find(item => item.id === button.effectId);
    void perform(() => request(`${base}/buttons/${encodeURIComponent(button.id)}/fire`, "POST"), `Đã gửi nút “${button.label}”.`, false);
    if (!effect) return;
    const total = Math.min(effect.actions.reduce((sum, action) => sum + (action.durationMs ?? 0), 0) || 1500, 30000);
    setPlaying({ id: button.id, until: Date.now() + total });
    clearTimeout(playingTimer.current); playingTimer.current = setTimeout(() => setPlaying(null), total);
  }
  async function stopCurrent() { void perform(() => request(`${base}/control`, "POST", { type: "stop" }), "Đã gửi lệnh dừng hiện tại.", false); }
  async function copyText(value: string, note: string) { try { await navigator.clipboard.writeText(value); push("success", note); } catch { push("error", "Không sao chép được. Hãy chọn và copy thủ công."); } }
  async function rotateToken() {
    if (!await confirm({ title: "Đổi token overlay", message: <>Token mới sẽ vô hiệu hóa URL overlay cũ trong OBS. Bạn cần cập nhật Browser Source với URL mới. Tiếp tục?</>, confirmLabel: "Đổi token" })) return;
    void perform(async () => {
      const result = await request<{ overlayToken: string }>(`${base}/rotate-token`, "POST");
      setOverlayUrl(`${window.location.origin}/overlay/${encodeURIComponent(id)}?token=${encodeURIComponent(result.overlayToken)}`);
      push("success", "Đã đổi token overlay. Cập nhật URL mới trong OBS.");
    }, "", true);
  }
  async function confirmDeleteProject() {
    if (deleteName !== data?.name) { setError("Tên xác nhận không khớp. Chưa xóa dự án."); return; }
    if (!await confirm({ title: "Xóa dự án", danger: true, confirmLabel: "Xóa vĩnh viễn", message: <>Xóa <strong>{data?.name}</strong> cùng toàn bộ hiệu ứng và nút? Không thể hoàn tác.</> })) return;
    setDeleteOpen(false);
    void perform(() => request(base, "DELETE"), "Đã xóa dự án.", false, () => { window.location.assign("/"); });
  }
  const settings = data?.settings ?? defaults;
  const currentButton = buttonEditor && buttonEditor !== "new" ? buttonEditor : undefined;
  const pageCount = Math.max(1, Math.ceil((Math.max(-1, ...(data?.buttons.map(button => button.position) ?? [])) + 1) / 12));
  const currentPage = Math.min(page, pageCount - 1);
  const effectSelect = (effectId?: string) => <Field label="Hiệu ứng"><select required name="effectId" defaultValue={effectId ?? ""}><option value="" disabled>Chọn hiệu ứng</option>{data?.effects.map(effect => <option key={effect.id} value={effect.id}>{effect.name}{effect.enabled ? "" : " (đã tắt)"}</option>)}</select></Field>;
  return <main className="app-shell studio-app" lang="vi"><nav className="topbar"><Brand suffix="STUDIO" /><a className="back-link" href="/"><Icon name="back" />Bảng điều khiển</a></nav>
    {host}
    {dialog}
    {deleteOpen && data && <Modal title="Xóa dự án" danger onClose={() => setDeleteOpen(false)}
      actions={<><button type="button" className="ghost" onClick={() => setDeleteOpen(false)}>Hủy</button><button type="button" className="danger" onClick={() => void confirmDeleteProject()}><Icon name="trash" />Xóa vĩnh viễn</button></>}>
      <p>Xóa dự án cùng hiệu ứng và nút. Không thể hoàn tác. Nhập chính xác tên dự án để xác nhận.</p>
      <Field label={`Nhập “${data.name}”`}><input value={deleteName} onChange={event => setDeleteName(event.target.value)} placeholder={data.name} autoFocus /></Field>
    </Modal>}
    <Notice error={error} status="" />
    {!data ? <section className="panel"><Empty icon={loading ? "refresh" : "alert"}>{loading ? "Đang tải studio…" : "Không mở được dự án. Dự án có thể đã bị xóa hoặc API chưa sẵn sàng."}</Empty><button disabled={busy || loading} onClick={() => void perform(load, "Đã tải dự án.", false)}><Icon name="refresh" />Thử lại</button></section> : <>
      <section className="studio-heading"><div><p className="eyebrow">PHÒNG ĐIỀU KHIỂN / LOCAL OBS</p><h1>{data.name}</h1><p className="muted">{data.description || "Sẵn sàng cho khoảnh khắc tiếp theo."}</p></div><button className="ghost" disabled={busy} onClick={() => void reload()}><Icon name="refresh" />Tải lại dữ liệu</button></section>
      <section className={`obs-strip${obsOpen ? " open" : ""}`}>
        <button type="button" className="obs-toggle" aria-expanded={obsOpen} onClick={() => setObsOpen(value => !value)}>
          <span className="obs-dot" aria-hidden="true" /><strong>Kết nối OBS</strong>
          <span className="obs-summary">1920 × 1080 · Browser Source</span>
          <Icon name="back" style={{ transform: obsOpen ? "rotate(90deg)" : "rotate(-90deg)" }} />
        </button>
        {obsOpen && <div className="obs-body">
          <p>Thêm Browser Source · 1920 × 1080 · dán URL này. Overlay dùng token riêng, không ai truy cập được nếu không có URL đầy đủ.</p>
          <input aria-label="URL overlay cho OBS" readOnly value={overlayUrl} onFocus={event => event.target.select()} />
          <div className="actions">
            <button className="ghost compact" disabled={busy} onClick={() => void copyText(overlayUrl, "Đã sao chép URL overlay.")}><Icon name="copy" />Sao chép URL</button>
            <button className="ghost compact" disabled={busy} onClick={() => void rotateToken()}><Icon name="refresh" />Đổi token</button>
            <a className="button-link ghost compact" href={`/overlay/${encodeURIComponent(id)}?token=${encodeURIComponent(data.overlayToken)}`} target="_blank" rel="noreferrer"><Icon name="external" />Mở overlay</a>
          </div>
        </div>}
      </section>
      <div className="tabbar" role="tablist" aria-label="Khu vực studio">{tabs.map(([value, label, icon]) => <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? "active" : "ghost"} disabled={busy} onClick={() => void switchTab(value)}><Icon name={icon} />{label}</button>)}</div>
      <fieldset className="workspace" disabled={busy} aria-busy={busy}>
      {tab === "effects" && <><header className="section-head"><div><h2>Hiệu ứng</h2><p className="muted">Xây chuỗi hành động. Lưu trước khi phát thử.</p></div><button disabled={editor !== null} onClick={() => setEditor("new")}><Icon name="plus" />Hiệu ứng</button></header>
        {editor && <EffectEditor key={editor === "new" ? "new" : editor.id} effect={editor === "new" ? undefined : editor} assets={data.assets} busy={busy} cancel={() => void discardAnd(() => setEditor(null))} save={body => save("effects", editor, body, () => setEditor(null))} />}
        <div className="resource-list">{data.effects.map(effect => <article className="resource" key={effect.id}><div><span className="badge">{effect.enabled ? "Đang bật" : "Đã tắt"} · {effect.mode}</span><h3>{effect.name}</h3><p>{effect.actions.length} bước · Hồi {effect.cooldownMs} ms</p></div><div className="actions"><button className="compact" disabled={!effect.enabled} onClick={() => void perform(() => request(`${base}/fire/${encodeURIComponent(effect.id)}`, "POST"), "Đã gửi lệnh phát. Xem kết quả trên overlay.", false)}><Icon name="play" />Phát thử</button><button className="ghost compact" disabled={editor !== null} onClick={() => setEditor(effect)}><Icon name="edit" />Sửa</button><button className="danger compact" onClick={() => void remove("effects", effect, <>Xóa hiệu ứng <strong>{effect.name}</strong>? Các nút đang dùng hiệu ứng này sẽ không phát được nữa. Không thể hoàn tác.</>, "Xóa hiệu ứng")}><Icon name="trash" />Xóa</button></div></article>)}</div>{!data.effects.length && <Empty icon="sparkles">Chưa có hiệu ứng. Thêm hiệu ứng đầu tiên, sau đó gắn vào nút.</Empty>}</>}
      {tab === "deck" && <><div className="control-bar">
        <button className="stop-button" onClick={() => void stopCurrent()} disabled={busy}><Icon name="stop" />Dừng hiện tại</button>
        <div className="control-row">
          <button className={clearArmed ? "clear-button armed" : "clear-button"} onClick={handleClearTap} disabled={busy} aria-live="polite">
            <Icon name="clear" />{clearArmed ? "Bấm lần nữa để xóa" : "Xóa hàng đợi"}
          </button>
          <button className="add-button" disabled={!data.effects.length || buttonEditor !== null} onClick={() => setButtonEditor("new")}><Icon name="plus" />Nút</button>
        </div>
      </div>
      <header className="section-head"><div><h2>Bàn điều khiển</h2><p className="muted">Bấm nút để phát trên overlay. Trang {currentPage + 1}/{pageCount}.</p></div></header>
        {!data.effects.length && <Empty icon="sparkles">Cần tạo hiệu ứng trong tab Hiệu ứng trước khi thêm nút.</Empty>}
        {buttonEditor && <form className="panel editor" key={currentButton?.id ?? "new"} onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); save("buttons", buttonEditor, { label: text(form, "label"), icon: text(form, "icon") || null, color: text(form, "color"), effectId: text(form, "effectId"), position: (number(form, "page") - 1) * 12 + number(form, "slot") - 1, cooldownMs: number(form, "cooldownMs"), enabled: form.has("enabled") }, () => setButtonEditor(null)); }}><h3>{currentButton ? "Sửa nút" : "Nút mới"}</h3><div className="form-grid"><Field label="Nhãn"><input name="label" required maxLength={40} defaultValue={currentButton?.label} /></Field><Field label="Biểu tượng / chữ ngắn"><input name="icon" maxLength={20} defaultValue={currentButton?.icon ?? ""} /></Field><Field label="Màu"><input name="color" type="color" defaultValue={currentButton?.color ?? "#7c3aed"} /></Field>{effectSelect(currentButton?.effectId)}<Field label="Trang"><input required type="number" name="page" min={1} max={1000} defaultValue={currentButton ? Math.floor(currentButton.position / 12) + 1 : currentPage + 1} /></Field><Field label="Vị trí trong trang (1–12)" hint="Nút trùng vị trí vẫn hiển thị cùng trang."><input required type="number" name="slot" min={1} max={12} defaultValue={currentButton ? currentButton.position % 12 + 1 : 1} /></Field><Field label="Thời gian hồi nút (ms)"><input required type="number" name="cooldownMs" min={0} max={3600000} defaultValue={currentButton?.cooldownMs ?? 0} /></Field><Check name="enabled" label="Bật nút" checked={currentButton?.enabled ?? true} /></div><div className="actions form-footer"><button><Icon name="check" />Lưu nút</button><button type="button" className="ghost" onClick={() => void discardAnd(() => setButtonEditor(null))}>Hủy</button></div></form>}
        <div className="pagination"><button className="ghost compact" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} aria-label="Trang trước"><Icon name="back" />Trước</button><span className="page-indicator"><input aria-label="Trang bàn điều khiển" type="number" min={1} max={pageCount} value={currentPage + 1} onChange={event => setPage(Math.max(0, Math.min(pageCount - 1, Number(event.target.value) - 1)))} /><span className="page-total">/ {pageCount}</span></span><button className="ghost compact" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)} aria-label="Trang sau">Sau<Icon name="back" style={{ transform: "rotate(180deg)" }} /></button></div>
        <div className="studio-deck">{data.buttons.filter(button => Math.floor(button.position / 12) === currentPage).sort((a, b) => a.position - b.position).map(button => { const effect = data.effects.find(effect => effect.id === button.effectId); const isPlaying = playing?.id === button.id && playing.until > Date.now(); return <article className="deck-tile" key={button.id}><button className={isPlaying ? "fire-button playing" : "fire-button"} style={{ borderColor: button.color, background: `linear-gradient(145deg, ${button.color}55, #161925)` }} disabled={!button.enabled || !effect?.enabled} onClick={() => fireButton(button)}><span>{button.icon || "▶"}</span><strong>{button.label}</strong><small>{isPlaying ? "Đang phát…" : !button.enabled ? "Nút đã tắt" : !effect?.enabled ? "Hiệu ứng không khả dụng" : effect.name}</small></button><div className="tile-meta"><small>#{button.position % 12 + 1} · {button.cooldownMs} ms</small><button className="ghost compact" disabled={buttonEditor !== null} onClick={() => setButtonEditor(button)}><Icon name="edit" />Sửa</button><button className="danger compact" onClick={() => void remove("buttons", button, <>Xóa nút <strong>{button.label}</strong>?</>, "Xóa nút")}><Icon name="trash" />Xóa</button></div></article>; })}</div>{!data.buttons.some(button => Math.floor(button.position / 12) === currentPage) && <Empty icon="bolt">Trang này chưa có nút. Thêm nút và chọn vị trí.</Empty>}</>}
      {tab === "assets" && <><header className="section-head"><div><h2>Thư viện tệp</h2><p className="muted">Tải từng tệp; sau đó chọn trong trình sửa hiệu ứng. Không tự phát media.</p></div></header><form className="panel upload-form" onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const body = new FormData(form); const file = body.get("file"); if (!(file instanceof File) || !file.size) { setError("Chọn tệp không rỗng."); return; } void perform(() => request(`${base}/assets`, "POST", body), "Đã tải tệp lên.", true, () => form.reset()); }}>
  <Field label="Chọn hình ảnh, video hoặc âm thanh"><input name="file" type="file" required accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,audio/mpeg,audio/ogg,audio/wav" /></Field>
  <button><Icon name="upload" />Tải lên</button>
  <p className="upload-hint">PNG, JPEG, GIF, WebP, MP4, WebM, MP3, OGG, WAV. Giới hạn mặc định 10 MB; tùy cấu hình máy chủ.</p>
</form>
<div className="asset-grid">{data.assets.map(asset => { const url = assetUrl(asset); const references = data.effects.filter(effect => effect.actions.some(action => action.url === url)); const isVideo = asset.mime.startsWith("video/"); const isImage = asset.mime.startsWith("image/"); return <article className="panel asset-card" key={asset.id}><div className="asset-preview">{isImage ? <img src={url} alt={asset.name} loading="lazy" decoding="async" /> : isVideo ? <video src={`${url}#t=0.1`} preload="metadata" muted playsInline tabIndex={-1} onError={event => { event.currentTarget.replaceWith(Object.assign(document.createElement("span"), { textContent: "VIDEO" })); }} /> : <span><Icon name="bolt" />AUDIO</span>}</div><h3 title={asset.name}>{asset.name}</h3><p className="muted">{asset.mime} · {(asset.size / 1024 / 1024).toFixed(2)} MB</p><p className="muted">{references.length} hiệu ứng đang dùng</p><div className="actions"><button className="ghost compact" onClick={() => void copyText(url, "Đã sao chép đường dẫn tệp.")}><Icon name="copy" />Chép URL</button><button className="danger compact" onClick={() => void remove("assets", asset, <>Xóa vĩnh viễn tệp <strong>{asset.name}</strong>? {references.length ? `${references.length} hiệu ứng đang tham chiếu tệp này và có thể không phát được.` : "Không thể hoàn tác."}</>, "Xóa tệp")}><Icon name="trash" />Xóa</button></div></article>; })}</div>{!data.assets.length && <Empty icon="image">Thư viện trống. Tải ảnh, video hoặc âm thanh để dùng trong hiệu ứng.</Empty>}</>}
      {tab === "settings" && <div className="settings-columns"><form className="panel" key={`settings-${revision}`} onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void perform(() => request(`${base}/settings`, "PATCH", { volume: number(form, "volume"), queueLimit: number(form, "queueLimit"), developerMode: form.has("developerMode") }), "Đã lưu cài đặt."); }}><h2>Phát media</h2><p className="muted">Thay đổi chỉ gửi khi bấm Lưu cài đặt.</p><div className="form-grid"><Field label="Âm lượng tổng (0–1)"><input name="volume" type="number" min={0} max={1} step={0.05} required defaultValue={settings.volume} /></Field><Field label="Giới hạn hàng đợi"><input name="queueLimit" type="number" min={1} max={200} required defaultValue={settings.queueLimit} /></Field></div><Check name="developerMode" label="Chế độ nhà phát triển" checked={settings.developerMode} /><button className="form-footer"><Icon name="check" />Lưu cài đặt</button></form>
        <div><form className="panel" key={`project-${revision}`} onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void perform(() => request(base, "PATCH", { name: text(form, "name"), description: text(form, "description") }), "Đã cập nhật dự án."); }}><h2>Dự án</h2><Field label="Tên dự án"><input name="name" required maxLength={80} defaultValue={data.name} /></Field><Field label="Mô tả"><textarea name="description" maxLength={500} rows={4} defaultValue={data.description} /></Field><button className="form-footer"><Icon name="check" />Lưu dự án</button></form><section className="panel danger-zone"><h3><Icon name="alert" />Xóa dự án</h3><p>Xóa dự án cùng hiệu ứng và nút. Không thể hoàn tác.</p><button className="danger" onClick={() => { setDeleteName(""); setDeleteOpen(true); }}><Icon name="trash" />Xóa vĩnh viễn</button></section></div></div>}
      </fieldset><footer>Lệnh phát gửi tới overlay · Studio không xác nhận trạng thái kết nối OBS</footer>
    </>}
  </main>;
}
