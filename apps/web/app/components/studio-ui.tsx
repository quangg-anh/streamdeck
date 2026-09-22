"use client";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/* ===== Icons (inline, stroke-based, inherit currentColor) ===== */
const paths: Record<string, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  play: <path d="M6 4l14 8-14 8z" fill="currentColor" stroke="none" />,
  edit: <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17zM14 6l3 3" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  refresh: <path d="M4 12a8 8 0 0 1 14-5m2-3v4h-4M20 12a8 8 0 0 1-14 5m-2 3v-4h4" />,
  copy: <path d="M9 9h10v10H9zM5 15V5h10" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />,
  back: <path d="M15 5l-7 7 7 7" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />,
  clear: <path d="M4 7h16M7 7l1 13h8l1-13M9 7V4h6v3" />,
  check: <path d="M5 13l4 4L19 7" />,
  alert: <path d="M12 9v4m0 4h.01M10.3 4l-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0z" />,
  info: <path d="M12 11v6m0-10h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  user: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20a8 8 0 0 1 16 0" />,
  logout: <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3" />,
  box: <path d="M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8" />,
  layers: <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5" />,
  image: <path d="M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5" />,
  bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  settings: <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a7 7 0 0 0-1.7-1L14.5 2h-5l-.3 2.5a7 7 0 0 0-1.7 1l-2.4-1-2 3.5L3.1 11a7 7 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 1.7 1l.3 2.5h5l.3-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5a7 7 0 0 0 .1-1z" />,
  eye: <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />,
  upload: <path d="M12 16V4m0 0L7 9m5-5l5 5M4 20h16" />,
  sparkles: <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6zM19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" />,
};
export function Icon({ name, style }: { name: keyof typeof paths | string; style?: CSSProperties }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false" style={style}>{paths[name] ?? paths.info}</svg>;
}

/* ===== Vesper brand mark (rotated dual-pill) ===== */
export function Brand({ suffix }: { suffix?: string }) {
  return <a className="brand" href="/" aria-label="StreamFX">
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><g transform="rotate(-30 12 12)"><circle cx="7.3" cy="3.2" r="1.45" /><rect x="5.5" y="4.7" width="3.6" height="14.6" rx="1.8" /><rect x="14.9" y="4.7" width="3.6" height="14.6" rx="1.8" /><circle cx="16.7" cy="20.8" r="1.45" /></g></svg>
    Stream<span>FX</span>
    {suffix && <small>{suffix}</small>}
  </a>;
}

/* ===== Accessible modal dialog ===== */
export function Modal({ title, children, onClose, actions, danger }: { title: string; children?: ReactNode; onClose: () => void; actions?: ReactNode; danger?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow; document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLElement>("input,textarea,select,button")?.focus();
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, [onClose]);
  return <div className="fx-modal" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-label={title} ref={ref}>
      <h3 style={danger ? { color: "#ffb3bd" } : undefined}>{title}</h3>
      {children}
      <div className="modal-actions">{actions}</div>
    </div>
  </div>;
}

/* ===== Confirm dialog driven by a hook (replaces window.confirm) ===== */
export type ConfirmOptions = { title: string; message: ReactNode; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
export function useConfirm() {
  const [requestState, setRequestState] = useState<(ConfirmOptions & { resolve: (value: boolean) => void }) | null>(null);
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>(resolve => setRequestState({ ...options, resolve })), []);
  const settle = (value: boolean) => { requestState?.resolve(value); setRequestState(null); };
  const dialog = requestState ? <Modal title={requestState.title} danger={requestState.danger} onClose={() => settle(false)}
    actions={<><button type="button" className="ghost" onClick={() => settle(false)}>{requestState.cancelLabel ?? "Hủy"}</button><button type="button" className={requestState.danger ? "danger" : ""} onClick={() => settle(true)}>{requestState.confirmLabel ?? "Xác nhận"}</button></>}>
    <div>{requestState.message}</div>
  </Modal> : null;
  return { confirm, dialog };
}

/* ===== Toast notifications (replaces inline status text) ===== */
type Toast = { id: number; kind: "success" | "error" | "info"; text: string };
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts(current => [...current.slice(-2), { id, kind, text }]);
    setTimeout(() => setToasts(current => current.filter(toast => toast.id !== id)), 4200);
  }, []);
  const dismiss = (id: number) => setToasts(current => current.filter(toast => toast.id !== id));
  const host = toasts.length ? <div className="fx-toasts" role="region" aria-live="polite">{toasts.map(toast => <div key={toast.id} className={`fx-toast ${toast.kind}`} onClick={() => dismiss(toast.id)}>
    <Icon name={toast.kind === "success" ? "check" : toast.kind === "error" ? "alert" : "info"} /><span style={{ flex: 1 }}>{toast.text}</span>
  </div>)}</div> : null;
  return { push, host };
}

export async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { method, signal: controller.signal, cache: "no-store", ...(body instanceof FormData ? { body } : body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    const raw = await response.text();
    let value: unknown;
    try { value = raw ? JSON.parse(raw) : undefined; } catch { throw new Error(`Phản hồi không hợp lệ (HTTP ${response.status}). Kiểm tra API.`); }
    if (!response.ok) { const error = value as { error?: string; details?: unknown } | undefined; if (response.status === 404 && url.startsWith("/api/")) throw new Error("API không tồn tại (404). Next đang chạy riêng mà không có máy chủ API — hãy dừng và chạy 'npm run dev' từ thư mục gốc repository."); throw new Error(`HTTP ${response.status}: ${error?.error || response.statusText}${error?.details ? ` — ${JSON.stringify(error.details)}` : ""}`); }
    return value as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("Yêu cầu quá hạn. Tải lại trước khi thử lại để tránh tạo trùng.");
    if (error instanceof TypeError) throw new Error("Không kết nối được API. Kiểm tra máy chủ và mạng; tải lại trước khi gửi lại.");
    throw error;
  } finally { clearTimeout(timer); }
}
export const message = (error: unknown) => error instanceof Error ? error.message : "Đã xảy ra lỗi không xác định.";
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function Check({ name, label, checked }: { name: string; label: string; checked: boolean }) { return <label className="check"><input type="checkbox" name={name} defaultChecked={checked} />{label}</label>; }
export function Empty({ children, icon = "box" }: { children: ReactNode; icon?: string }) { return <div className="empty"><Icon name={icon} /><span>{children}</span></div>; }
export function Notice({ error, status }: { error: string; status: string }) { return <>{error && <div role="alert" className="notice error">{error}</div>}<div role="status" aria-live="polite" className={status ? "notice success" : "sr-only"}>{status}</div></>; }
export const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
export const number = (form: FormData, name: string) => Number(form.get(name));