"use client";
import type { ReactNode } from "react";
export async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { method, signal: controller.signal, cache: "no-store", ...(body instanceof FormData ? { body } : body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    const raw = await response.text();
    let value: unknown;
    try { value = raw ? JSON.parse(raw) : undefined; } catch { throw new Error(`Phản hồi không hợp lệ (HTTP ${response.status}). Kiểm tra API.`); }
    if (!response.ok) { const error = value as { error?: string; details?: unknown } | undefined; throw new Error(`HTTP ${response.status}: ${error?.error || response.statusText}${error?.details ? ` — ${JSON.stringify(error.details)}` : ""}`); }
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
export function Empty({ children }: { children: ReactNode }) { return <div className="empty">{children}</div>; }
export function Notice({ error, status }: { error: string; status: string }) { return <>{error && <div role="alert" className="notice error">{error}</div>}<div role="status" aria-live="polite" className={status ? "notice success" : "sr-only"}>{status}</div></>; }
export const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
export const number = (form: FormData, name: string) => Number(form.get(name));