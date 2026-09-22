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
});
describe("asset URL compatibility", () => {
  it("keeps public URL and supports legacy Windows paths", () => {
    expect(assetUrl({ url: "/assets/demo.png" } as Asset)).toBe("/assets/demo.png");
    expect(assetUrl({ path: "C:\\uploads\\demo image.png" } as Asset & { path: string })).toBe("/assets/demo%20image.png");
  });
});