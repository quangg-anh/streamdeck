import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import staticFiles from "@fastify/static";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import type { RawData } from "ws";
import { Prisma } from "@prisma/client";
import { clientMessageSchema, effectActionSchema, overlaySettingsSchema, type EffectAction, type QueueMode } from "@streamfx/protocol";
import { prisma } from "./db.js";
import { createRealtime } from "./realtime.js";
import { createCooldowns, type Cooldown } from "./cooldown.js";
import { allowedOrigin, referencesAsset } from "./local-security.js";
import { LocalStorageProvider } from "./storage.js";
import { clearLoginFailures, createSession, destroySession, hashPassword, loginRateLimited, recordLoginFailure, requestKey, requireAdmin, requireUser, resolveSession, sessionCookie, setSessionCookie, clearSessionCookie, startAuthMaintenance, verifyPassword, type SessionUser } from "./auth.js";
import { buttonInput, buttonPatch, childParams, controlInput, effectInput, effectPatch, eventInput, fireParams, idParams, loginInput, passwordInput, projectGrantInput, projectInput, projectPatch, settingsPatch, triggerInput, triggerPatch, userCreateInput, userPatchInput } from "./schemas.js";

export async function buildApp() {
const app = Fastify({ logger: true, trustProxy: process.env.STREAMFX_TRUST_PROXY === "1" });
await app.register(cookie);
// Resolve the session cookie into request.user for every request.
app.addHook("preHandler", async request => { request.user = (await resolveSession(request.cookies[sessionCookie])) ?? undefined; });
const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? "data/uploads");
const storage = new LocalStorageProvider(uploadDir);
const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 10485760);
const allowedMime = new Set((process.env.ALLOWED_UPLOAD_TYPES ?? "image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,audio/mpeg,audio/ogg,audio/wav").split(","));
await storage.init();
const allowlist = (process.env.CORS_ORIGIN ?? "").split(",").map(value => value.trim()).filter(Boolean);
app.addHook("onRequest", async (req, reply) => {
  if (!allowedOrigin(req.headers.origin, req.protocol, req.headers.host, allowlist)) return reply.code(403).send({ error: "Origin not allowed" });
});
app.addHook("onSend", async (_req, reply) => { reply.header("X-Content-Type-Options", "nosniff"); });
await app.register(cors, { origin: allowlist });
await app.register(websocket, { options: { maxPayload: 16_384 } });
await app.register(multipart, { limits: { files: 1, fileSize: maxUploadBytes } });
await app.register(staticFiles, { root: uploadDir, prefix: "/assets/" });
const realtime = createRealtime();
const { broadcast, join, send } = realtime;
const cooldowns = createCooldowns();
const stopAuthMaintenance = startAuthMaintenance();
app.addHook("preClose", async () => { realtime.close(); });
app.addHook("onClose", async () => { stopAuthMaintenance(); cooldowns.close(); await prisma.$disconnect(); });
const assetDto = <T extends { path: string }>(asset: T) => { const { path: storedPath, ...dto } = asset; return { ...dto, url: storage.publicUrl(storedPath) }; };
const settingsDto = (settings: unknown) => overlaySettingsSchema.parse(settings ?? { volume: 0.8, ttsEnabled: true, ttsVoice: null, ttsRate: 1, ttsMaxLength: 280, queueLimit: 50 });

// Plan helpers: a user's deck quota and plan expiry gate project creation and firing.
const planActive = (user: { role: string; blocked: boolean; planExpiresAt: Date | null }) => user.role === "ADMIN" || (!user.blocked && (!user.planExpiresAt || user.planExpiresAt.getTime() > Date.now()));
const planExpiry = (planDays: number, from?: Date | null) => {
  if (!planDays) return null;
  const base = from && from.getTime() > Date.now() ? from : new Date();
  return new Date(base.getTime() + planDays * 24 * 60 * 60 * 1000);
};

const ownedProject = (id: string, user: SessionUser) => prisma.project.findFirst({ where: { id, ...(user.role === "ADMIN" ? {} : { userId: user.id }) } });
const notFound = (reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => reply.code(404).send({ error: "Not found" });
const parse = <T>(schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: { flatten: () => unknown } } }, value: unknown, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
  const result = schema.safeParse(value);
  if (!result.success) { reply.code(400).send({ error: "Validation failed", details: result.error.flatten() }); return null; }
  return result.data;
};
const ownedEffect = (projectId: string, id: string) => prisma.effect.findFirst({ where: { id, projectId } });
const ensureEffect = async (projectId: string, effectId: string) => Boolean(await ownedEffect(projectId, effectId));
const resolveActions = (actions: unknown): EffectAction[] => {
  const result = effectActionSchema.array().safeParse(actions);
  return result.success ? result.data : [];
};
// Overlay tokens are bearer credentials: use 192-bit random tokens instead of cuids.
const newOverlayToken = () => randomBytes(24).toString("base64url");
const fireEffect = async (projectId: string, effectId: string, source?: Cooldown) => {
  const effect = await ownedEffect(projectId, effectId);
  if (!effect || !effect.enabled) return false;
  const actions = resolveActions(effect.actions);
  if (!actions.length) return false;
  if (!(await cooldowns.claim([{ key: `effect:${effect.id}`, durationMs: effect.cooldownMs }, ...(source ? [source] : [])]))) return false;
  broadcast(projectId, { kind: "effect", projectId, effectId, runId: randomUUID(), mode: effect.mode as QueueMode, actions });
  return true;
};

// ---------- Auth: single login gate for admin and users ----------

app.post("/api/auth/login", async (request, reply) => {
  const body = parse(loginInput, request.body, reply); if (!body) return;
  const key = `${requestKey(request)}:${body.username}`;
  if (loginRateLimited(key)) return reply.code(429).send({ error: "Thử lại sau" });
  const user = await prisma.user.findUnique({ where: { username: body.username } });
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    recordLoginFailure(key);
    return reply.code(401).send({ error: "Sai tên đăng nhập hoặc mật khẩu" });
  }
  if (user.blocked) return reply.code(403).send({ error: "Tài khoản đã bị khóa" });
  clearLoginFailures(key);
  const session = await createSession(user.id);
  setSessionCookie(reply, session.cookieValue, session.expiresAt);
  return { id: user.id, username: user.username, role: user.role };
});

app.post("/api/auth/logout", async (request, reply) => {
  await destroySession(request.cookies[sessionCookie]);
  clearSessionCookie(reply);
  return { ok: true };
});

app.get("/api/auth/me", async (request, reply) => {
  const user = await requireUser(request, reply); if (!user) return;
  const fresh = await prisma.user.findUnique({ where: { id: user.id }, select: { blocked: true, deckLimit: true, planExpiresAt: true, _count: { select: { projects: true } } } });
  if (!fresh || fresh.blocked) { await destroySession(request.cookies[sessionCookie]); clearSessionCookie(reply); return reply.code(401).send({ error: "Phiên không hợp lệ" }); }
  return { ...user, deckLimit: fresh.deckLimit, planExpiresAt: fresh.planExpiresAt, projectCount: fresh._count.projects, planActive: planActive({ role: user.role, blocked: fresh.blocked, planExpiresAt: fresh.planExpiresAt }) };
});

app.patch("/api/auth/password", async (request, reply) => {
  const user = await requireUser(request, reply); if (!user) return;
  const body = parse(passwordInput, request.body, reply); if (!body) return;
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.password) } });
  return { ok: true };
});

// ---------- Admin: user management (users cannot self-register) ----------

const userDto = (user: { id: string; username: string; role: string; blocked: boolean; deckLimit: number; planExpiresAt: Date | null; createdAt: Date; _count?: { projects: number } }) => ({
  id: user.id, username: user.username, role: user.role, blocked: user.blocked, deckLimit: user.deckLimit,
  planExpiresAt: user.planExpiresAt?.toISOString() ?? null, createdAt: user.createdAt.toISOString(),
  projectCount: user._count?.projects ?? 0
});

app.get("/api/admin/users", async (request, reply) => {
  if (!(await requireAdmin(request, reply))) return;
  const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { projects: true } } } });
  return users.map(userDto);
});

app.post("/api/admin/users", async (request, reply) => {
  if (!(await requireAdmin(request, reply))) return;
  const body = parse(userCreateInput, request.body, reply); if (!body) return;
  const exists = await prisma.user.findUnique({ where: { username: body.username } });
  if (exists) return reply.code(409).send({ error: "Tên đăng nhập đã tồn tại" });
  // No-plan accounts: deckLimit 0 and no expiry — admin grants a plan later via PATCH.
  const user = await prisma.user.create({ data: { username: body.username, passwordHash: await hashPassword(body.password), role: body.role, deckLimit: body.deckLimit, planExpiresAt: planExpiry(body.planDays) } });
  return userDto(user);
});

app.get("/api/admin/users/:id/projects", async (request, reply) => {
  if (!(await requireAdmin(request, reply))) return;
  const params = parse(idParams, request.params, reply); if (!params) return;
  const target = await prisma.user.findUnique({ where: { id: params.id }, select: { id: true, username: true } });
  if (!target) return notFound(reply);
  const projects = await prisma.project.findMany({ where: { userId: params.id }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, description: true, createdAt: true, _count: { select: { buttons: true, effects: true } } } });
  return { user: target, projects };
});

app.patch("/api/admin/users/:id", async (request, reply) => {
  if (!(await requireAdmin(request, reply))) return;
  const params = parse(idParams, request.params, reply); if (!params) return;
  const body = parse(userPatchInput, request.body, reply); if (!body) return;
  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return notFound(reply);
  const data: { passwordHash?: string; role?: string; blocked?: boolean; deckLimit?: number; planExpiresAt?: Date | null } = {};
  if (body.password) data.passwordHash = await hashPassword(body.password);
  if (body.role !== undefined) data.role = body.role;
  if (body.blocked !== undefined) data.blocked = body.blocked;
  if (body.deckLimit !== undefined) data.deckLimit = body.deckLimit;
  if (body.planDays !== undefined) data.planExpiresAt = planExpiry(body.planDays, target.planExpiresAt);
  if (target.role === "ADMIN" && (data.role === "USER" || data.blocked)) {
    const admins = await prisma.user.count({ where: { role: "ADMIN", blocked: false, id: { not: target.id } } });
    if (!admins) return reply.code(409).send({ error: "Phải còn ít nhất một admin hoạt động" });
  }
  const user = await prisma.user.update({ where: { id: params.id }, data, include: { _count: { select: { projects: true } } } });
  if (data.blocked) await prisma.session.deleteMany({ where: { userId: user.id } });
  return userDto(user);
});

app.delete("/api/admin/users/:id", async (request, reply) => {
  if (!(await requireAdmin(request, reply))) return;
  const params = parse(idParams, request.params, reply); if (!params) return;
  if (params.id === request.user!.id) return reply.code(409).send({ error: "Không thể xóa chính mình" });
  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return notFound(reply);
  if (target.role === "ADMIN") {
    const admins = await prisma.user.count({ where: { role: "ADMIN", blocked: false, id: { not: target.id } } });
    if (!admins) return reply.code(409).send({ error: "Phải còn ít nhất một admin hoạt động" });
  }
  const projects = await prisma.project.findMany({ where: { userId: params.id }, select: { assets: { select: { path: true } } } });
  await prisma.user.delete({ where: { id: params.id } });
  const cleanup = await Promise.allSettled(projects.flatMap(project => project.assets.map(asset => storage.remove(asset.path))));
  if (cleanup.some(result => result.status === "rejected")) app.log.error({ cleanup }, "User file cleanup failed");
  return reply.code(204).send(null);
});

app.get("/health", async () => ({ ok: true }));
app.get("/ready", async (_req, reply) => {
  try { await prisma.$queryRaw`SELECT 1`; return { ok: true }; }
  catch (error) { app.log.error(error, "Database readiness failed"); return reply.code(503).send({ ok: false }); }
});
app.get("/api/providers", async () => [{ id: "mock", status: "ready" }, { id: "tiktok", status: "placeholder" }]);
app.get("/api/projects", async (request, reply) => {
  const user = await requireUser(request, reply); if (!user) return;
  const [projects, account] = await Promise.all([
    prisma.project.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { deckLimit: true, planExpiresAt: true } })
  ]);
  return { projects, deckLimit: account?.deckLimit ?? 0, planExpiresAt: account?.planExpiresAt ?? null, planActive: planActive({ role: user.role, blocked: false, planExpiresAt: account?.planExpiresAt ?? null }) };
});
app.post("/api/projects", async (request, reply) => {
  const user = await requireUser(request, reply); if (!user) return;
  const body = parse(projectInput, request.body, reply); if (!body) return;
  // Admins are exempt from quota/expiry so they can manage demo projects.
  if (user.role !== "ADMIN") {
    const account = await prisma.user.findUnique({ where: { id: user.id }, select: { blocked: true, deckLimit: true, planExpiresAt: true, _count: { select: { projects: true } } } });
    if (!account || account.blocked) return reply.code(403).send({ error: "Tài khoản không khả dụng" });
    if (account.planExpiresAt && account.planExpiresAt.getTime() <= Date.now()) return reply.code(402).send({ error: "Gói stream deck đã hết hạn. Liên hệ admin để gia hạn." });
    if (account._count.projects >= account.deckLimit) return reply.code(402).send({ error: `Đã đạt giới hạn ${account.deckLimit} stream deck. Liên hệ admin để nâng cấp.` });
  }
  return prisma.project.create({ data: { ...body, userId: user.id, overlayToken: newOverlayToken(), settings: { create: {} } } });
});
app.post("/api/projects/:id/rotate-token", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const params = parse(idParams, req.params, reply); if (!params) return;
  const project = await ownedProject(params.id, user); if (!project) return notFound(reply);
  const overlayToken = newOverlayToken();
  await prisma.project.update({ where: { id: project.id }, data: { overlayToken } });
  return { overlayToken };
});
app.get("/api/projects/:id", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const params = parse(idParams, req.params, reply); if (!params) return;
  const project = await prisma.project.findFirst({ where: { id: params.id, ...(user.role === "ADMIN" ? {} : { userId: user.id }) }, include: { effects: true, buttons: { orderBy: { position: "asc" } }, triggers: true, assets: true, settings: true } });
  return project ? { ...project, assets: project.assets.map(assetDto) } : notFound(reply);
});
app.patch("/api/projects/:id", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const params = parse(idParams, req.params, reply), body = parse(projectPatch, req.body, reply); if (!params || !body) return;
  if (!(await ownedProject(params.id, user))) return notFound(reply);
  return prisma.project.update({ where: { id: params.id }, data: body });
});
app.delete("/api/projects/:id", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const params = parse(idParams, req.params, reply); if (!params) return;
  if (!(await ownedProject(params.id, user))) return notFound(reply);
  const assets = await prisma.asset.findMany({ where: { projectId: params.id } });
  await prisma.project.delete({ where: { id: params.id } });
  const cleanup = await Promise.allSettled(assets.map(asset => storage.remove(asset.path)));
  if (cleanup.some(result => result.status === "rejected")) { app.log.error({ cleanup }, "Project file cleanup failed"); return reply.code(500).send({ error: "Project deleted, file cleanup incomplete" }); }
  return reply.code(204).send(null);
});

app.post("/api/projects/:id/effects", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const params = parse(idParams, req.params, reply), body = parse(effectInput, req.body, reply); if (!params || !body) return;
  if (!(await ownedProject(params.id, user))) return notFound(reply);
  return prisma.effect.create({ data: { ...body, actions: body.actions as Prisma.InputJsonValue, projectId: params.id } });
});
app.patch("/api/projects/:id/effects/:childId", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const params = parse(childParams, req.params, reply), body = parse(effectPatch, req.body, reply); if (!params || !body) return;
  if (!(await ownedProject(params.id, user)) || !(await ownedEffect(params.id, params.childId))) return notFound(reply);
  return prisma.effect.update({ where: { id: params.childId }, data: { ...body, actions: body.actions as Prisma.InputJsonValue | undefined } });
});
app.delete("/api/projects/:id/effects/:childId", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const params = parse(childParams, req.params, reply); if (!params) return;
  if (!(await ownedProject(params.id, user)) || !(await ownedEffect(params.id, params.childId))) return notFound(reply);
  await prisma.effect.delete({ where: { id: params.childId } }); return reply.code(204).send(null);
});

app.post("/api/projects/:id/buttons", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const params = parse(idParams, req.params, reply), body = parse(buttonInput, req.body, reply); if (!params || !body) return;
  if (!(await ownedProject(params.id, user)) || !(await ensureEffect(params.id, body.effectId))) return notFound(reply);
  return prisma.deckButton.create({ data: { ...body, icon: body.icon ?? null, projectId: params.id } });
});
app.post("/api/projects/:id/buttons/:childId/fire", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const params = parse(childParams, req.params, reply); if (!params) return;
  const button = await prisma.deckButton.findFirst({ where: { id: params.childId, projectId: params.id, project: user.role === "ADMIN" ? undefined : { userId: user.id } } });
  if (!button) return notFound(reply);
  if (!button.enabled) return reply.code(409).send({ error: "Button disabled" });
  return await fireEffect(params.id, button.effectId, { key: `button:${button.id}`, durationMs: button.cooldownMs }) ? { ok: true } : reply.code(409).send({ error: "Effect unavailable or cooldown active" });
});
app.patch("/api/projects/:id/buttons/:childId", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const params = parse(childParams, req.params, reply), body = parse(buttonPatch, req.body, reply); if (!params || !body) return;
  const item = await prisma.deckButton.findFirst({ where: { id: params.childId, projectId: params.id, project: user.role === "ADMIN" ? undefined : { userId: user.id } } });
  if (!item || (body.effectId && !(await ensureEffect(params.id, body.effectId)))) return notFound(reply);
  return prisma.deckButton.update({ where: { id: params.childId }, data: body });
});
app.delete("/api/projects/:id/buttons/:childId", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const params = parse(childParams, req.params, reply); if (!params) return;
  const item = await prisma.deckButton.findFirst({ where: { id: params.childId, projectId: params.id, project: user.role === "ADMIN" ? undefined : { userId: user.id } } }); if (!item) return notFound(reply);
  await prisma.deckButton.delete({ where: { id: params.childId } }); return reply.code(204).send(null);
});

app.post("/api/projects/:id/triggers", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const params = parse(idParams, req.params, reply), body = parse(triggerInput, req.body, reply); if (!params || !body) return;
  if (!(await ownedProject(params.id, user)) || !(await ensureEffect(params.id, body.effectId))) return notFound(reply);
  return prisma.trigger.create({ data: { ...body, match: body.match ?? null, config: body.config as Prisma.InputJsonValue | undefined, projectId: params.id } });
});
app.patch("/api/projects/:id/triggers/:childId", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const params = parse(childParams, req.params, reply), body = parse(triggerPatch, req.body, reply); if (!params || !body) return;
  const item = await prisma.trigger.findFirst({ where: { id: params.childId, projectId: params.id, project: user.role === "ADMIN" ? undefined : { userId: user.id } } });
  if (!item || (body.effectId && !(await ensureEffect(params.id, body.effectId)))) return notFound(reply);
  return prisma.trigger.update({ where: { id: params.childId }, data: { ...body, config: body.config as Prisma.InputJsonValue | undefined } });
});
app.delete("/api/projects/:id/triggers/:childId", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const params = parse(childParams, req.params, reply); if (!params) return;
  const item = await prisma.trigger.findFirst({ where: { id: params.childId, projectId: params.id, project: user.role === "ADMIN" ? undefined : { userId: user.id } } }); if (!item) return notFound(reply);
  await prisma.trigger.delete({ where: { id: params.childId } }); return reply.code(204).send(null);
});

app.patch("/api/projects/:id/settings", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const params = parse(idParams, req.params, reply), body = parse(settingsPatch, req.body, reply); if (!params || !body) return;
  if (!(await ownedProject(params.id, user))) return notFound(reply);
  const settings = await prisma.settings.upsert({ where: { projectId: params.id }, update: body, create: { projectId: params.id, ...body } });
  broadcast(params.id, { kind: "settings", projectId: params.id, settings: settingsDto(settings) });
  return settings;
});
app.post("/api/projects/:id/fire/:effectId", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const params = parse(fireParams, req.params, reply); if (!params) return;
  if (user.role !== "ADMIN" && !(await ownedProject(params.id, user))) return notFound(reply);
  return (await fireEffect(params.id, params.effectId)) ? { ok: true } : notFound(reply);
});
app.post("/api/projects/:id/control", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const params = parse(idParams, req.params, reply); if (!params) return;
  const body = parse(controlInput, req.body, reply); if (!body) return;
  if (!(await ownedProject(params.id, user))) return notFound(reply);
  broadcast(params.id, { kind: "control", projectId: params.id, command: body.type }); return { ok: true };
});
app.post("/api/projects/:id/events", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const params = parse(idParams, req.params, reply), body = parse(eventInput, req.body, reply); if (!params || !body) return;
  const project = await prisma.project.findFirst({ where: { id: params.id, ...(user.role === "ADMIN" ? {} : { userId: user.id }) }, include: { settings: true } }); if (!project) return notFound(reply);
  if (body.provider === "mock" && !project.settings?.allowMockEvents) return reply.code(403).send({ error: "Mock events disabled" });
  if (body.provider === "tiktok") return reply.code(501).send({ error: "TikTok provider not configured" });
  const triggers = await prisma.trigger.findMany({ where: { projectId: params.id, provider: body.provider, event: body.type, enabled: true } });
  let fired = 0;
  for (const trigger of triggers) if ((!trigger.match || trigger.match === body.value) && await fireEffect(params.id, trigger.effectId, { key: `trigger:${trigger.id}`, durationMs: trigger.cooldownMs })) fired++;
  return { fired };
});
app.post("/api/projects/:id/assets", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const params = parse(idParams, req.params, reply); if (!params) return;
  if (!(await ownedProject(params.id, user))) return notFound(reply);
  const file = await req.file(); if (!file) return reply.code(400).send({ error: "File required" });
  if (!allowedMime.has(file.mimetype)) { file.file.resume(); return reply.code(415).send({ error: "Unsupported file type" }); }
  const saved = await storage.save(file);
  if (file.file.truncated || saved.size > maxUploadBytes) { await storage.remove(saved.path); return reply.code(413).send({ error: "File too large" }); }
  try {
    const asset = await prisma.asset.create({ data: { projectId: params.id, name: file.filename.slice(0, 255), mime: file.mimetype, ...saved } });
    return assetDto(asset);
  } catch (error) { await storage.remove(saved.path); throw error; }
});
app.delete("/api/projects/:id/assets/:childId", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const params = parse(childParams, req.params, reply); if (!params) return;
  const asset = await prisma.asset.findFirst({ where: { id: params.childId, projectId: params.id, project: user.role === "ADMIN" ? undefined : { userId: user.id } } }); if (!asset) return notFound(reply);
  const effects = await prisma.effect.findMany({ select: { actions: true } });
  if (effects.some(effect => referencesAsset(effect.actions, storage.publicUrl(asset.path)))) return reply.code(409).send({ error: "Asset is referenced by an effect" });
  await prisma.asset.delete({ where: { id: asset.id } }); await storage.remove(asset.path); return reply.code(204).send(null);
});

app.get("/ws", { websocket: true }, socket => {
  realtime.track(socket);
  let subscriptionVersion = 0;
  let pending = 0;
  socket.on("message", (raw: RawData) => {
    if (++pending > 8) { pending--; socket.close(1008, "Too many pending messages"); return; }
    void (async () => {
    let value: unknown; try { value = JSON.parse(raw.toString()); } catch { socket.close(1003, "Invalid JSON"); return; }
    const result = clientMessageSchema.safeParse(value); if (!result.success) { socket.close(1008, "Invalid message"); return; }
    if (result.data.kind !== "subscribe") { if (result.data.kind === "ping") send(socket, { kind: "pong", at: result.data.at }); return; }
    const version = ++subscriptionVersion;
    const projectId = result.data.projectId;
    const project = await prisma.project.findFirst({ where: { id: projectId, ...(result.data.token ? { overlayToken: result.data.token } : {}) }, include: { settings: true } });
    if (version !== subscriptionVersion || socket.readyState !== socket.OPEN) return;
    if (!project) { socket.close(1008, "Not found"); return; }
    join(projectId, socket);
    send(socket, { kind: "settings", projectId, settings: settingsDto(project.settings) });
    })().catch(error => { app.log.error(error, "WebSocket handler failed"); socket.close(1011, "Internal error"); }).finally(() => { pending--; });
  });
});

return app;
}
