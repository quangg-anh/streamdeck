import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "./studio-ui";
import { assetUrl } from "./effect-editor";
import type { Asset } from "@streamfx/types";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("studio REST", () => {
  it("uses same-origin JSON requests", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetch);
    await expect(request("/api/projects/demo/buttons/button/fire", "POST", { value: "Rose" })).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith("/api/projects/demo/buttons/button/fire", expect.objectContaining({ method: "POST", body: '{"value":"Rose"}', headers: { "content-type": "application/json" } }));
  });
  it("handles empty DELETE responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(request("/api/projects/demo", "DELETE")).resolves.toBeUndefined();
  });
  it("reports backend validation details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Validation failed", details: { name: ["Required"] } }), { status: 400 })));
    await expect(request("/api/projects")).rejects.toThrow("HTTP 400: Validation failed");
  });
  it("reports unavailable API and invalid HTML responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(request("/api/projects")).rejects.toThrow("Không kết nối được API");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>error</html>", { status: 502 })));
    await expect(request("/api/projects")).rejects.toThrow("HTTP 502");
  });
  it("lets browser set multipart boundary", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", fetch);
    const body = new FormData(); body.append("file", new Blob(["sample"]), "sample.txt");
    await request("/api/projects/demo/assets", "POST", body);
    expect(fetch.mock.calls[0][1].headers).toBeUndefined();
    expect(fetch.mock.calls[0][1].body).toBe(body);
  });
  it("does not abort video uploads after the normal REST timeout", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    let complete!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn((_url, options) => {
      signal = options.signal;
      return new Promise<Response>(resolve => { complete = resolve; });
    }));
    const body = new FormData();
    body.append("file", new Blob(["video"], { type: "video/mp4" }), "clip.mp4");
    const upload = request("/api/projects/demo/assets", "POST", body);
    await vi.advanceTimersByTimeAsync(20_001);
    const aborted = signal?.aborted;
    complete(new Response("{}"));
    await upload;
    expect(aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("shows the server explanation for an upload size limit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Payload Too Large", message: "Tệp vượt giới hạn 200 MiB." }), { status: 413 })));
    await expect(request("/api/projects/demo/assets", "POST", new FormData())).rejects.toThrow("Tệp vượt giới hạn 200 MiB.");
  });
  it("reports a reverse proxy upload limit even for an HTML response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>Request Entity Too Large</html>", { status: 413 })));
    await expect(request("/api/projects/demo/assets", "POST", new FormData())).rejects.toThrow("giới hạn của máy chủ hoặc reverse proxy");
  });
  it("retains a 20 second timeout for ordinary API requests", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));
    const failure = request("/api/projects").catch(error => error);
    await vi.advanceTimersByTimeAsync(20_001);
    expect(await failure).toEqual(expect.objectContaining({ message: expect.stringContaining("Yêu cầu quá hạn") }));
    expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds upload requests to 5 minutes and reports an upload-specific timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));
    const failure = request("/api/projects/demo/assets", "POST", new FormData()).catch(error => error);
    await vi.advanceTimersByTimeAsync(300_001);
    expect(await failure).toEqual(expect.objectContaining({ message: expect.stringContaining("Tải tệp quá hạn sau 5 phút") }));
    expect(vi.getTimerCount()).toBe(0);
  });
});
describe("asset URL compatibility", () => {
  it("keeps public URL and supports legacy Windows paths", () => {
    expect(assetUrl({ url: "/assets/demo.png" } as Asset)).toBe("/assets/demo.png");
    expect(assetUrl({ path: "C:\\uploads\\demo image.png" } as Asset & { path: string })).toBe("/assets/demo%20image.png");
  });
});