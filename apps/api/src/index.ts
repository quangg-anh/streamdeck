import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import staticFiles from "@fastify/static";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RawData } from "ws";
import { Prisma } from "@prisma/client";
import { clientMessageSchema, effectActionSchema, overlaySettingsSchema, type EffectAction, type QueueMode } from "@streamfx/protocol";
import { prisma } from "./db.js";
import { createRealtime } from "./realtime.js";
import { createCooldowns, type Cooldown } from "./cooldown.js";
import { allowedOrigin, referencesAsset } from "./local-security.js";
import { LocalStorageProvider } from "./storage.js";
import { buttonInput, buttonPatch, childParams, controlInput, effectInput, effectPatch, eventInput, fireParams, idParams, projectInput, projectPatch, settingsPatch, triggerInput, triggerPatch } from "./schemas.js";

export async function buildApp() {
const app = Fastify({ logger: true });
const userId = process.env.DEV_USER_ID ?? "dev-user";
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
app.addHook("preClose", async () => { realtime.close(); });
app.addHook("onClose", async () => { cooldowns.close(); await prisma.$disconnect(); });
const assetDto = <T extends { path: string }>(asset: T) => { const { path: storedPath, ...dto } = asset; return { ...dto, url: storage.publicUrl(storedPath) }; };
const settingsDto = (settings: unknown) => overlaySettingsSchema.parse(settings ?? { volume: 0.8, ttsEnabled: true, ttsVoice: null, ttsRate: 1, ttsMaxLength: 280, queueLimit: 50 });

const ownedProject = (id: string) => prisma.project.findFirst({ where: { id, userId } });
const notFound = (reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => reply.code(404).send({ error: "Not found" });
const parse = <T>(schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: { flatten: () => unknown } } }, value: unknown, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
  const result = schema.safeParse(value);
  if (!result.success) { reply.code(400).send({ error: "Validation failed", details: result.error.flatten() }); return null; }
  return result.data;
};
const ownedEffect = (projectId: string, id: string) => prisma.effect.findFirst({ where: { id, projectId, project: { userId } } });
const ensureEffect = async (projectId: string, effectId: string) => Boolean(await ownedEffect(projectId, effectId));
const resolveActions = (actions: unknown): EffectAction[] => {
  const result = effectActionSchema.array().safeParse(actions);
  return result.success ? result.data : [];
};
const fireEffect = async (projectId: string, effectId: string, source?: Cooldown) => {
  const effect = await ownedEffect(projectId, effectId);
  if (!effect || !effect.enabled) return false;
  const actions = resolveActions(effect.actions);
  if (!actions.length) return false;
  if (!(await cooldowns.claim([{ key: `effect:${effect.id}`, durationMs: effect.cooldownMs }, ...(source ? [source] : [])]))) return false;
  broadcast(projectId, { kind: "effect", projectId, effectId, runId: randomUUID(), mode: effect.mode as QueueMode, actions });
  return true;
};

app.get("/health", async () => ({ ok: true }));
app.get("/ready", async (_req, reply) => {
  try { await prisma.$queryRaw`SELECT 1`; return { ok: true }; }
  catch (error) { app.log.error(error, "Database readiness failed"); return reply.code(503).send({ ok: false }); }
});
app.get("/api/providers", async () => [{ id: "mock", status: "ready" }, { id: "tiktok", status: "placeholder" }]);
app.get("/api/projects", async () => prisma.project.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }));
app.post("/api/projects", async (req, reply) => {
  const body = parse(projectInput, req.body, reply); if (!body) return;
  return prisma.project.create({ data: { ...body, user: { connectOrCreate: { where: { id: userId }, create: { id: userId } } }, settings: { create: {} } } });
});
app.get("/api/projects/:id", async (req, reply) => {
  const params = parse(idParams, req.params, reply); if (!params) return;
  const project = await prisma.project.findFirst({ where: { id: params.id, userId }, include: { effects: true, buttons: { orderBy: { position: "asc" } }, triggers: true, assets: true, settings: true } });
  return project ? { ...project, assets: project.assets.map(assetDto) } : notFound(reply);
});
app.patch("/api/projects/:id", async (req, reply) => {
  const params = parse(idParams, req.params, reply), body = parse(projectPatch, req.body, reply); if (!params || !body) return;
  if (!(await ownedProject(params.id))) return notFound(reply);
  return prisma.project.update({ where: { id: params.id }, data: body });
});
app.delete("/api/projects/:id", async (req, reply) => {
  const params = parse(idParams, req.params, reply); if (!params) return;
  if (!(await ownedProject(params.id))) return notFound(reply);
  const assets = await prisma.asset.findMany({ where: { projectId: params.id } });
  await prisma.project.delete({ where: { id: params.id } });
  const cleanup = await Promise.allSettled(assets.map(asset => storage.remove(asset.path)));
  if (cleanup.some(result => result.status === "rejected")) { app.log.error({ cleanup }, "Project file cleanup failed"); return reply.code(500).send({ error: "Project deleted, file cleanup incomplete" }); }
  return reply.code(204).send(null);
});

app.post("/api/projects/:id/effects", async (req, reply) => {
  const params = parse(idParams, req.params, reply), body = parse(effectInput, req.body, reply); if (!params || !body) return;
  if (!(await ownedProject(params.id))) return notFound(reply);
  return prisma.effect.create({ data: { ...body, actions: body.actions as Prisma.InputJsonValue, projectId: params.id } });
});
app.patch("/api/projects/:id/effects/:childId", async (req, reply) => {
  const params = parse(childParams, req.params, reply), body = parse(effectPatch, req.body, reply); if (!params || !body) return;
  if (!(await ownedEffect(params.id, params.childId))) return notFound(reply);
  return prisma.effect.update({ where: { id: params.childId }, data: { ...body, actions: body.actions as Prisma.InputJsonValue | undefined } });
});
app.delete("/api/projects/:id/effects/:childId", async (req, reply) => {
  const params = parse(childParams, req.params, reply); if (!params) return;
  if (!(await ownedEffect(params.id, params.childId))) return notFound(reply);
  await prisma.effect.delete({ where: { id: params.childId } }); return reply.code(204).send(null);
});

app.post("/api/projects/:id/buttons", async (req, reply) => {
  const params = parse(idParams, req.params, reply), body = parse(buttonInput, req.body, reply); if (!params || !body) return;
  if (!(await ownedProject(params.id)) || !(await ensureEffect(params.id, body.effectId))) return notFound(reply);
  return prisma.deckButton.create({ data: { ...body, icon: body.icon ?? null, projectId: params.id } });
});
app.post("/api/projects/:id/buttons/:childId/fire", async (req, reply) => {
  const params = parse(childParams, req.params, reply); if (!params) return;
  const button = await prisma.deckButton.findFirst({ where: { id: params.childId, projectId: params.id, project: { userId } } });
  if (!button) return notFound(reply);
  if (!button.enabled) return reply.code(409).send({ error: "Button disabled" });
  return await fireEffect(params.id, button.effectId, { key: `button:${button.id}`, durationMs: button.cooldownMs }) ? { ok: true } : reply.code(409).send({ error: "Effect unavailable or cooldown active" });
});
app.patch("/api/projects/:id/buttons/:childId", async (req, reply) => {
  const params = parse(childParams, req.params, reply), body = parse(buttonPatch, req.body, reply); if (!params || !body) return;
  const item = await prisma.deckButton.findFirst({ where: { id: params.childId, projectId: params.id, project: { userId } } });
  if (!item || (body.effectId && !(await ensureEffect(params.id, body.effectId)))) return notFound(reply);
  return prisma.deckButton.update({ where: { id: params.childId }, data: body });
});
app.delete("/api/projects/:id/buttons/:childId", async (req, reply) => {
  const params = parse(childParams, req.params, reply); if (!params) return;
  const item = await prisma.deckButton.findFirst({ where: { id: params.childId, projectId: params.id, project: { userId } } }); if (!item) return notFound(reply);
  await prisma.deckButton.delete({ where: { id: params.childId } }); return reply.code(204).send(null);
});

app.post("/api/projects/:id/triggers", async (req, reply) => {
  const params = parse(idParams, req.params, reply), body = parse(triggerInput, req.body, reply); if (!params || !body) return;
  if (!(await ownedProject(params.id)) || !(await ensureEffect(params.id, body.effectId))) return notFound(reply);
  return prisma.trigger.create({ data: { ...body, match: body.match ?? null, config: body.config as Prisma.InputJsonValue | undefined, projectId: params.id } });
});
app.patch("/api/projects/:id/triggers/:childId", async (req, reply) => {
  const params = parse(childParams, req.params, reply), body = parse(triggerPatch, req.body, reply); if (!params || !body) return;
  const item = await prisma.trigger.findFirst({ where: { id: params.childId, projectId: params.id, project: { userId } } });
  if (!item || (body.effectId && !(await ensureEffect(params.id, body.effectId)))) return notFound(reply);
  return prisma.trigger.update({ where: { id: params.childId }, data: { ...body, config: body.config as Prisma.InputJsonValue | undefined } });
});
app.delete("/api/projects/:id/triggers/:childId", async (req, reply) => {
  const params = parse(childParams, req.params, reply); if (!params) return;
  const item = await prisma.trigger.findFirst({ where: { id: params.childId, projectId: params.id, project: { userId } } }); if (!item) return notFound(reply);
  await prisma.trigger.delete({ where: { id: params.childId } }); return reply.code(204).send(null);
});

app.patch("/api/projects/:id/settings", async (req, reply) => {
  const params = parse(idParams, req.params, reply), body = parse(settingsPatch, req.body, reply); if (!params || !body) return;
  if (!(await ownedProject(params.id))) return notFound(reply);
  const settings = await prisma.settings.upsert({ where: { projectId: params.id }, update: body, create: { projectId: params.id, ...body } });
  broadcast(params.id, { kind: "settings", projectId: params.id, settings: settingsDto(settings) });
  return settings;
});
app.post("/api/projects/:id/fire/:effectId", async (req, reply) => {
  const params = parse(fireParams, req.params, reply); if (!params) return;
  return (await fireEffect(params.id, params.effectId)) ? { ok: true } : notFound(reply);
});
app.post("/api/projects/:id/control", async (req, reply) => {
  const params = parse(idParams, req.params, reply); if (!params) return;
  const body = parse(controlInput, req.body, reply); if (!body) return;
  if (!(await ownedProject(params.id))) return notFound(reply);
  broadcast(params.id, { kind: "control", projectId: params.id, command: body.type }); return { ok: true };
});
app.post("/api/projects/:id/events", async (req, reply) => {
  const params = parse(idParams, req.params, reply), body = parse(eventInput, req.body, reply); if (!params || !body) return;
  const project = await prisma.project.findFirst({ where: { id: params.id, userId }, include: { settings: true } }); if (!project) return notFound(reply);
  if (body.provider === "mock" && !project.settings?.allowMockEvents) return reply.code(403).send({ error: "Mock events disabled" });
  if (body.provider === "tiktok") return reply.code(501).send({ error: "TikTok provider not configured" });
  const triggers = await prisma.trigger.findMany({ where: { projectId: params.id, provider: body.provider, event: body.type, enabled: true } });
  let fired = 0;
  for (const trigger of triggers) if ((!trigger.match || trigger.match === body.value) && await fireEffect(params.id, trigger.effectId, { key: `trigger:${trigger.id}`, durationMs: trigger.cooldownMs })) fired++;
  return { fired };
});
app.post("/api/projects/:id/assets", async (req, reply) => {
  const params = parse(idParams, req.params, reply); if (!params) return;
  if (!(await ownedProject(params.id))) return notFound(reply);
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
  const params = parse(childParams, req.params, reply); if (!params) return;
  const asset = await prisma.asset.findFirst({ where: { id: params.childId, projectId: params.id, project: { userId } } }); if (!asset) return notFound(reply);
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
    const project = await prisma.project.findFirst({ where: { id: projectId, userId }, include: { settings: true } });
    if (version !== subscriptionVersion || socket.readyState !== socket.OPEN) return;
    if (!project) { socket.close(1008, "Not found"); return; }
    join(projectId, socket);
    send(socket, { kind: "settings", projectId, settings: settingsDto(project.settings) });
    })().catch(error => { app.log.error(error, "WebSocket handler failed"); socket.close(1011, "Internal error"); }).finally(() => { pending--; });
  });
});

return app;
}
