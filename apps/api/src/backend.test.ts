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
  project: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), delete: vi.fn() },
  effect: { findFirst: vi.fn(), findMany: vi.fn() },
  deckButton: { findFirst: vi.fn() },
  asset: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), delete: vi.fn() },
  settings: { upsert: vi.fn() },
  user: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
  session: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
  cooldown: { findFirst: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(), $disconnect: vi.fn()
}));
vi.mock("./db.js", () => ({ prisma: db }));
import { buildApp } from "./index.js";

// Default session: a logged-in USER owning project "p". Tests override per case.
const sessionUser = { id: "u1", username: "tester", role: "USER" as const };
const account = { blocked: false, deckLimit: 3, planExpiresAt: null, _count: { projects: 1 } };
beforeEach(() => {
  db.session.findUnique.mockImplementation(async (args: { where: { id: string } }) => args.where.id === "sess-1" ? { id: "sess-1", expiresAt: new Date(Date.now() + 60_000), user: { id: sessionUser.id, username: sessionUser.username, role: sessionUser.role, blocked: false } } : null);
  db.user.findUnique.mockResolvedValue(account);
});

describe("cooldowns", () => {
  it("zero duration never claims and failed groups consume nothing", async () => {
    vi.stubEnv("COOLDOWN_STORE", "memory");
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
    vi.stubEnv("COOLDOWN_STORE", "memory"); vi.useFakeTimers();
    const store = createCooldowns();
    try {
      const claim = () => store.claim([{ key: "a", durationMs: 10 }, { key: "b", durationMs: 20 }]);
      expect(await Promise.all([claim(), claim()])).toEqual([true, false]);
      vi.advanceTimersByTime(30_000);
      expect(await claim()).toBe(true);
    } finally { store.close(); vi.useRealTimers(); vi.unstubAllEnvs(); }
  });
  it("stores claims in PostgreSQL atomically and reports race losers", async () => {
    vi.stubEnv("COOLDOWN_STORE", "");
    const store = createCooldowns();
    const tx = { cooldown: { findFirst: db.cooldown.findFirst, deleteMany: db.cooldown.deleteMany, createMany: db.cooldown.createMany } };
    try {
      // Active row blocks the whole group and consumes nothing.
      db.cooldown.findFirst.mockResolvedValueOnce({ key: "effect:e" });
      db.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<boolean>) => fn(tx));
      expect(await store.claim([{ key: "effect:e", durationMs: 1000 }, { key: "button:b", durationMs: 500 }])).toBe(false);
      expect(db.cooldown.deleteMany).toHaveBeenCalledWith({ where: { key: { in: ["button:b", "effect:e"] }, expiresAt: { lte: expect.any(Date) } } });
      expect(db.cooldown.createMany).not.toHaveBeenCalled();
      // Free path inserts every key with a future expiry.
      db.cooldown.findFirst.mockResolvedValueOnce(null);
      db.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<boolean>) => fn(tx));
      expect(await store.claim([{ key: "effect:e", durationMs: 1000 }, { key: "button:b", durationMs: 500 }])).toBe(true);
      expect(db.cooldown.createMany).toHaveBeenCalledWith({ data: [{ key: "button:b", expiresAt: expect.any(Date) }, { key: "effect:e", expiresAt: expect.any(Date) }] });
      // Unique violation from a concurrent winner is a clean loss, not an error.
      const { Prisma } = await import("@prisma/client");
      db.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" }));
      expect(await store.claim([{ key: "effect:e", durationMs: 1000 }])).toBe(false);
    } finally { store.close(); vi.unstubAllEnvs(); }
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
  const auth = { cookie: `sfx_session=sess-1` };
  beforeEach(async () => {
    vi.resetAllMocks();
    root = await mkdtemp(path.join(tmpdir(), "streamfx-api-"));
    vi.stubEnv("UPLOAD_DIR", root); vi.stubEnv("COOLDOWN_STORE", "memory"); vi.stubEnv("CORS_ORIGIN", "http://localhost:3000");
    db.session.findUnique.mockImplementation(async (args: { where: { id: string } }) => args.where.id === "sess-1" ? { id: "sess-1", expiresAt: new Date(Date.now() + 60_000), user: { id: "u1", username: "tester", role: "USER", blocked: false } } : null);
    db.user.findUnique.mockResolvedValue({ blocked: false, deckLimit: 3, planExpiresAt: null, _count: { projects: 1 } });
    db.project.findFirst.mockResolvedValue({ id: "p", settings: null, assets: [] });
    db.deckButton.findFirst.mockResolvedValue({ id: "b", enabled: true, effectId: "e", cooldownMs: 1000 });
    db.effect.findFirst.mockResolvedValue({ id: "e", enabled: true, cooldownMs: 0, mode: "QUEUE", actions: [{ type: "confetti", durationMs: 100 }] });
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); await rm(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
  it("rejects unauthenticated API access and exposes DB readiness", async () => {
    expect((await app.inject("/api/projects")).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/projects", payload: { name: "x" } })).statusCode).toBe(401);
    expect(db.project.findFirst).not.toHaveBeenCalled();
    expect((await app.inject("/ready")).statusCode).toBe(200);
    db.$queryRaw.mockRejectedValueOnce(new Error("offline"));
    expect((await app.inject("/ready")).statusCode).toBe(503);
  });
  it("guards origins before mutations", async () => {
    expect((await app.inject({ method: "POST", url: "/api/projects/p/buttons/b/fire", headers: { origin: "https://evil.test", cookie: auth.cookie } })).statusCode).toBe(403);
    expect(db.deckButton.findFirst).not.toHaveBeenCalled();
  });
  it("checks button enabled, groups cooldown and does not consume failed source", async () => {
    const fire = () => app.inject({ method: "POST", url: "/api/projects/p/buttons/b/fire", cookies: { sfx_session: "sess-1" } });
    db.deckButton.findFirst.mockResolvedValueOnce({ id: "b", enabled: false });
    expect((await fire()).statusCode).toBe(409);
    db.effect.findFirst.mockResolvedValueOnce(null);
    expect((await fire()).statusCode).toBe(409);
    expect((await fire()).statusCode).toBe(200);
    expect((await fire()).statusCode).toBe(409);
  });
  it("enforces deck quota and plan expiry on project creation", async () => {
    const create = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/projects", cookies: { sfx_session: "sess-1" }, payload });
    // No-plan account (deckLimit 0) cannot create decks either.
    db.user.findUnique.mockResolvedValueOnce({ blocked: false, deckLimit: 0, planExpiresAt: null, _count: { projects: 0 } });
    expect((await create({ name: "x" })).statusCode).toBe(402);
    // Quota reached: 3 projects already exist.
    db.user.findUnique.mockResolvedValueOnce({ blocked: false, deckLimit: 3, planExpiresAt: null, _count: { projects: 3 } });
    expect((await create({ name: "x" })).statusCode).toBe(402);
    // Plan expired.
    db.user.findUnique.mockResolvedValueOnce({ blocked: false, deckLimit: 3, planExpiresAt: new Date(Date.now() - 1000), _count: { projects: 0 } });
    expect((await create({ name: "x" })).statusCode).toBe(402);
    // Blocked account.
    db.user.findUnique.mockResolvedValueOnce({ blocked: true, deckLimit: 3, planExpiresAt: null, _count: { projects: 0 } });
    expect((await create({ name: "x" })).statusCode).toBe(403);
    // Within quota and active plan: creates with settings.
    db.user.findUnique.mockResolvedValueOnce({ blocked: false, deckLimit: 3, planExpiresAt: null, _count: { projects: 1 } });
    db.project.create.mockResolvedValueOnce({ id: "p2", name: "x", description: "" });
    expect((await create({ name: "x" })).statusCode).toBe(200);
    expect(db.project.create).toHaveBeenCalledWith({ data: { name: "x", description: "", userId: "u1", overlayToken: expect.any(String), settings: { create: {} } } });
  });
  it("admin lists and views user decks, and creates no-plan accounts", async () => {
    // Admin session alongside the default user session.
    db.session.findUnique.mockImplementation(async (args: { where: { id: string } }) => {
      if (args.where.id === "sess-admin") return { id: "sess-admin", expiresAt: new Date(Date.now() + 60_000), user: { id: "admin1", username: "root", role: "ADMIN", blocked: false } };
      if (args.where.id === "sess-1") return { id: "sess-1", expiresAt: new Date(Date.now() + 60_000), user: { id: "u1", username: "tester", role: "USER", blocked: false } };
      return null;
    });
    const adminCookie = { sfx_session: "sess-admin" };
    // Create without plan fields: defaults to deckLimit 0 and no expiry.
    db.user.findUnique.mockResolvedValueOnce(null);
    db.user.create.mockResolvedValueOnce({ id: "u9", username: "noplan", role: "USER", blocked: false, deckLimit: 0, planExpiresAt: null, createdAt: new Date(), _count: { projects: 0 } });
    const created = await app.inject({ method: "POST", url: "/api/admin/users", cookies: adminCookie, payload: { username: "noplan", password: "password1" } });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toEqual(expect.objectContaining({ username: "noplan", deckLimit: 0, planExpiresAt: null }));
    expect(db.user.create).toHaveBeenCalledWith({ data: expect.objectContaining({ username: "noplan", deckLimit: 0, planExpiresAt: null }) });
    // View a user's decks.
    db.user.findUnique.mockResolvedValueOnce({ id: "u9", username: "noplan" });
    db.project.findMany.mockResolvedValueOnce([{ id: "p1", name: "Deck A", description: "", createdAt: new Date(0), _count: { buttons: 2, effects: 3 } }]);
    const decks = await app.inject({ url: "/api/admin/users/u9/projects", cookies: adminCookie });
    expect(decks.statusCode).toBe(200);
    expect(decks.json()).toEqual({ user: { id: "u9", username: "noplan" }, projects: [expect.objectContaining({ id: "p1", name: "Deck A" })] });
    // Non-admin cannot view decks.
    expect((await app.inject({ url: "/api/admin/users/u9/projects", cookies: { sfx_session: "sess-1" } })).statusCode).toBe(403);
  });
  it("hides stored paths and prevents referenced deletion", async () => {
    const asset = { id: "a", path: path.join(root, "a.png") };
    db.project.findFirst.mockResolvedValueOnce({ id: "p", assets: [asset] });
    const result = (await app.inject({ url: "/api/projects/p", cookies: { sfx_session: "sess-1" } })).json();
    expect(result.assets).toEqual([{ id: "a", url: "/assets/a.png" }]);
    db.asset.findFirst.mockResolvedValue(asset);
    db.effect.findMany.mockResolvedValue([{ actions: [{ url: "/assets/a.png" }] }]);
    expect((await app.inject({ method: "DELETE", url: "/api/projects/p/assets/a", cookies: { sfx_session: "sess-1" } })).statusCode).toBe(409);
    expect(db.asset.delete).not.toHaveBeenCalled();
  });
  it("removes upload after DB failure", async () => {
    db.asset.create.mockRejectedValueOnce(new Error("DB failed"));
    const body = Buffer.concat([Buffer.from('--test\r\nContent-Disposition: form-data; name="file"; filename="evil.html"\r\nContent-Type: image/png\r\n\r\n'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('\r\n--test--\r\n')]);
    expect((await app.inject({ method: "POST", url: "/api/projects/p/assets", cookies: { sfx_session: "sess-1" }, headers: { "content-type": "multipart/form-data; boundary=test" }, payload: body })).statusCode).toBe(500);
    expect(await readdir(root)).toEqual([]);
  });
  it("deletes project files after DB deletion", async () => {
    const storedPath = path.join(root, "test.png");
    await writeFile(storedPath, "test");
    db.asset.findMany.mockResolvedValue([{ path: storedPath }]);
    expect((await app.inject({ method: "DELETE", url: "/api/projects/p", cookies: { sfx_session: "sess-1" } })).statusCode).toBe(204);
    expect(db.project.delete).toHaveBeenCalledWith({ where: { id: "p" } });
    expect(await readdir(root)).toEqual([]);
  });
  it("sends settings snapshot and broadcasts settings updates", async () => {
    await app.ready();
    db.project.findFirst.mockImplementation(async (args: { where: { id?: string; overlayToken?: string } }) => args.where.overlayToken === "tok-1" || args.where.id === "p" ? { id: "p", settings: null } : null);
    const socket = await app.injectWS("/ws");
    const messages: unknown[] = [];
    const snapshot = new Promise<void>(resolve => socket.on("message", raw => {
      const message = JSON.parse(raw.toString()); messages.push(message);
      if (message.kind === "settings") resolve();
    }));
    socket.send(JSON.stringify({ kind: "subscribe", projectId: "p", client: "overlay", token: "tok-1" }));
    await snapshot;
    expect(messages).toContainEqual(expect.objectContaining({ kind: "settings", settings: expect.objectContaining({ volume: 0.8 }) }));
    db.settings.upsert.mockResolvedValue({ volume: 0, ttsEnabled: true, ttsVoice: null, ttsRate: 1, ttsMaxLength: 280, queueLimit: 50 });
    const update = new Promise<unknown>(resolve => socket.once("message", raw => resolve(JSON.parse(raw.toString()))));
    expect((await app.inject({ method: "PATCH", url: "/api/projects/p/settings", cookies: { sfx_session: "sess-1" }, payload: { volume: 0 } })).statusCode).toBe(200);
    expect(await update).toEqual(expect.objectContaining({ kind: "settings", settings: expect.objectContaining({ volume: 0 }) }));
    socket.terminate();
  });
});