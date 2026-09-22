import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import type { MultipartFile } from "@fastify/multipart";
import { createCooldowns } from "./cooldown.js";
import { LocalStorageProvider, validMagic } from "./storage.js";
import { allowedOrigin, referencesAsset } from "./local-security.js";
import { effectInput, settingsPatch } from "./schemas.js";

const db = vi.hoisted(() => ({
  project: { findFirst: vi.fn(), delete: vi.fn() },
  effect: { findFirst: vi.fn(), findMany: vi.fn() },
  deckButton: { findFirst: vi.fn() },
  asset: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), delete: vi.fn() },
  settings: { upsert: vi.fn() },
  $queryRaw: vi.fn(), $disconnect: vi.fn()
}));
vi.mock("./db.js", () => ({ prisma: db }));
import { buildApp } from "./index.js";

describe("cooldowns", () => {
  it("zero duration never claims and failed groups consume nothing", async () => {
    vi.stubEnv("REDIS_URL", "");
    const store = createCooldowns();
    try {
      expect(await store.claim([{ key: "zero", durationMs: 0 }])).toBe(true);
      expect(await store.claim([{ key: "zero", durationMs: 0 }])).toBe(true);
      expect(await store.claim([{ key: "effect", durationMs: 1000 }])).toBe(true);
      expect(await store.claim([{ key: "source", durationMs: 1000 }, { key: "effect", durationMs: 1000 }])).toBe(false);
      expect(await store.claim([{ key: "source", durationMs: 1000 }])).toBe(true);
    } finally { store.close(); vi.unstubAllEnvs(); }
  });
  it("expiry permits reuse and concurrent groups have one winner", async () => {
    vi.stubEnv("REDIS_URL", ""); vi.useFakeTimers();
    const store = createCooldowns();
    try {
      const claim = () => store.claim([{ key: "a", durationMs: 10 }, { key: "b", durationMs: 20 }]);
      expect(await Promise.all([claim(), claim()])).toEqual([true, false]);
      vi.advanceTimersByTime(30_000);
      expect(await claim()).toBe(true);
    } finally { store.close(); vi.useRealTimers(); vi.unstubAllEnvs(); }
  });
});

describe("validation", () => {
  it("allows CLI, same origin and explicit allowlist only", () => {
    expect(allowedOrigin(undefined, "http", "localhost:3001", [])).toBe(true);
    expect(allowedOrigin("http://localhost:3001", "http", "localhost:3001", [])).toBe(true);
    expect(allowedOrigin("http://localhost:3000", "http", "localhost:3001", ["http://localhost:3000"])).toBe(true);
    for (const origin of ["null", "https://evil.test", "http://localhost:3001/", "file://"]) expect(allowedOrigin(origin, "http", "localhost:3001", [])).toBe(false);
  });
  it("rejects unsafe URL schemes and out-of-range settings", () => {
    expect(effectInput.safeParse({ name: "x", actions: [{ type: "image", url: "javascript:alert(1)", durationMs: 100 }] }).success).toBe(false);
    expect(settingsPatch.safeParse({ queueLimit: 201 }).success).toBe(false);
    expect(settingsPatch.safeParse({ volume: 0 }).success).toBe(true);
    expect(referencesAsset([{ url: "http://localhost:3001/assets/test.png?x=1" }], "/assets/test.png")).toBe(true);
  });
});

describe("storage", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "streamfx-test-")); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  const file = (data: Buffer, mimetype = "image/png", truncated = false) => ({ filename: "../../evil.html", mimetype, file: Object.assign(Readable.from([data]), { truncated }) }) as unknown as MultipartFile;
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  it("uses MIME extension, hashes contents and keeps public URL path-free", async () => {
    const storage = new LocalStorageProvider(root);
    const saved = await storage.save(file(png));
    expect(saved.path.endsWith(".png")).toBe(true);
    expect(saved.size).toBe(8);
    expect(saved.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(storage.publicUrl(saved.path)).toMatch(/^\/assets\/[^/]+\.png$/);
    await expect(storage.remove(path.join(root, "..", "outside"))).rejects.toThrow("Invalid stored path");
  });
  it("cleans mismatched, truncated and interrupted uploads", async () => {
    const storage = new LocalStorageProvider(root);
    await expect(storage.save(file(Buffer.from("<html>")))).rejects.toThrow("File content");
    await expect(storage.save(file(png, "image/png", true))).rejects.toThrow("File too large");
    const broken = file(png);
    broken.file = Readable.from((async function* () { yield png; throw new Error("interrupted"); })()) as MultipartFile["file"];
    await expect(storage.save(broken)).rejects.toThrow("interrupted");
    expect(await readdir(root)).toEqual([]);
    expect(validMagic("image/webp", Buffer.from("RIFF1234WEBP"))).toBe(true);
    expect(validMagic("video/webm", Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))).toBe(false);
  });
});

describe("API with mocked DB", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let root: string;
  beforeEach(async () => {
    vi.resetAllMocks();
    root = await mkdtemp(path.join(tmpdir(), "streamfx-api-"));
    vi.stubEnv("UPLOAD_DIR", root); vi.stubEnv("REDIS_URL", ""); vi.stubEnv("CORS_ORIGIN", "http://localhost:3000");
    db.project.findFirst.mockResolvedValue({ id: "p", settings: null, assets: [] });
    db.deckButton.findFirst.mockResolvedValue({ id: "b", enabled: true, effectId: "e", cooldownMs: 1000 });
    db.effect.findFirst.mockResolvedValue({ id: "e", enabled: true, cooldownMs: 0, mode: "QUEUE", actions: [{ type: "confetti", durationMs: 100 }] });
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); await rm(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
  it("guards origins before mutations and exposes DB readiness", async () => {
    expect((await app.inject({ method: "POST", url: "/api/projects/p/buttons/b/fire", headers: { origin: "https://evil.test" } })).statusCode).toBe(403);
    expect(db.deckButton.findFirst).not.toHaveBeenCalled();
    expect((await app.inject("/ready")).statusCode).toBe(200);
    db.$queryRaw.mockRejectedValueOnce(new Error("offline"));
    expect((await app.inject("/ready")).statusCode).toBe(503);
  });
  it("checks button enabled, groups cooldown and does not consume failed source", async () => {
    const fire = () => app.inject({ method: "POST", url: "/api/projects/p/buttons/b/fire" });
    db.deckButton.findFirst.mockResolvedValueOnce({ id: "b", enabled: false });
    expect((await fire()).statusCode).toBe(409);
    db.effect.findFirst.mockResolvedValueOnce(null);
    expect((await fire()).statusCode).toBe(409);
    expect((await fire()).statusCode).toBe(200);
    expect((await fire()).statusCode).toBe(409);
  });
  it("hides stored paths and prevents referenced deletion", async () => {
    const asset = { id: "a", path: path.join(root, "a.png") };
    db.project.findFirst.mockResolvedValueOnce({ id: "p", assets: [asset] });
    const result = (await app.inject("/api/projects/p")).json();
    expect(result.assets).toEqual([{ id: "a", url: "/assets/a.png" }]);
    db.asset.findFirst.mockResolvedValue(asset);
    db.effect.findMany.mockResolvedValue([{ actions: [{ url: "/assets/a.png" }] }]);
    expect((await app.inject({ method: "DELETE", url: "/api/projects/p/assets/a" })).statusCode).toBe(409);
    expect(db.asset.delete).not.toHaveBeenCalled();
  });
  it("removes upload after DB failure", async () => {
    db.asset.create.mockRejectedValueOnce(new Error("DB failed"));
    const body = Buffer.concat([Buffer.from('--test\r\nContent-Disposition: form-data; name="file"; filename="evil.html"\r\nContent-Type: image/png\r\n\r\n'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('\r\n--test--\r\n')]);
    expect((await app.inject({ method: "POST", url: "/api/projects/p/assets", headers: { "content-type": "multipart/form-data; boundary=test" }, payload: body })).statusCode).toBe(500);
    expect(await readdir(root)).toEqual([]);
  });
  it("deletes project files after DB deletion", async () => {
    const storedPath = path.join(root, "test.png");
    await writeFile(storedPath, "test");
    db.asset.findMany.mockResolvedValue([{ path: storedPath }]);
    expect((await app.inject({ method: "DELETE", url: "/api/projects/p" })).statusCode).toBe(204);
    expect(db.project.delete).toHaveBeenCalledWith({ where: { id: "p" } });
    expect(await readdir(root)).toEqual([]);
  });
  it("sends settings snapshot and broadcasts settings updates", async () => {
    await app.ready();
    const socket = await app.injectWS("/ws");
    const messages: unknown[] = [];
    const snapshot = new Promise<void>(resolve => socket.on("message", raw => {
      const message = JSON.parse(raw.toString()); messages.push(message);
      if (message.kind === "settings") resolve();
    }));
    socket.send(JSON.stringify({ kind: "subscribe", projectId: "p", client: "overlay" }));
    await snapshot;
    expect(messages).toContainEqual(expect.objectContaining({ kind: "settings", settings: expect.objectContaining({ volume: 0.8 }) }));
    db.settings.upsert.mockResolvedValue({ volume: 0, ttsEnabled: true, ttsVoice: null, ttsRate: 1, ttsMaxLength: 280, queueLimit: 50 });
    const update = new Promise<unknown>(resolve => socket.once("message", raw => resolve(JSON.parse(raw.toString()))));
    expect((await app.inject({ method: "PATCH", url: "/api/projects/p/settings", payload: { volume: 0 } })).statusCode).toBe(200);
    expect(await update).toEqual(expect.objectContaining({ kind: "settings", settings: expect.objectContaining({ volume: 0 }) }));
    socket.terminate();
  });
});