import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./db.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

// scrypt with per-user salt: no external native dependency, hardened parameters (N=16384 via keylen budget).
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  let salt: Buffer, expected: Buffer;
  try { salt = Buffer.from(parts[1], "base64"); expected = Buffer.from(parts[2], "base64"); } catch { return false; }
  const derived = await scrypt(password, salt, expected.length);
  // Constant-time compare; length mismatch already fails via equal check on hash input.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export type SessionUser = { id: string; username: string; role: "ADMIN" | "USER" };

export const sessionCookie = "sfx_session";
const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;

export async function createSession(userId: string): Promise<{ id: string; cookieValue: string; expiresAt: Date }> {
  const id = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionTtlMs);
  await prisma.session.create({ data: { id, userId, expiresAt } });
  return { id, cookieValue: id, expiresAt };
}

export async function resolveSession(cookieValue: string | undefined): Promise<SessionUser | null> {
  if (!cookieValue) return null;
  const session = await prisma.session.findUnique({ where: { id: cookieValue }, include: { user: true } });
  if (!session || session.expiresAt.getTime() <= Date.now()) {
    if (session) void prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  const { id, username, role, blocked } = session.user;
  if (blocked || (role !== "ADMIN" && role !== "USER")) return null;
  return { id, username, role };
}

export async function destroySession(cookieValue: string | undefined): Promise<void> {
  if (!cookieValue) return;
  try { await prisma.session.delete({ where: { id: cookieValue } }); } catch { /* already gone */ }
}

export function setSessionCookie(reply: FastifyReply, value: string, expiresAt: Date): void {
  reply.setCookie(sessionCookie, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.STREAMFX_COOKIES_INSECURE !== "0",
    path: "/",
    expires: expiresAt
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(sessionCookie, { path: "/" });
}

// In-process login rate limiter: 10 failures per username+IP per 10 minutes.
const loginWindowMs = 10 * 60 * 1000;
const loginMaxFailures = 10;
const loginFailures = new Map<string, { count: number; resetAt: number }>();

export function loginRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = loginFailures.get(key);
  if (!entry || entry.resetAt <= now) return false;
  return entry.count >= loginMaxFailures;
}

export function recordLoginFailure(key: string): void {
  const now = Date.now();
  const entry = loginFailures.get(key);
  if (!entry || entry.resetAt <= now) loginFailures.set(key, { count: 1, resetAt: now + loginWindowMs });
  else entry.count += 1;
}

export function clearLoginFailures(key: string): void {
  loginFailures.delete(key);
}

// Periodic cleanup of expired sessions and stale limiter entries.
export function startAuthMaintenance(): () => void {
  const timer = setInterval(() => {
    void prisma.session.deleteMany({ where: { expiresAt: { lte: new Date() } } }).catch(() => {});
    const now = Date.now();
    for (const [key, entry] of loginFailures) if (entry.resetAt <= now) loginFailures.delete(key);
  }, 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}

export function requestKey(request: FastifyRequest): string {
  // Behind Cloudflare Tunnel / proxy, request.ip collapses to the proxy address —
  // prefer the real client IP so login rate limiting stays per-user.
  const cfIp = request.headers["cf-connecting-ip"];
  if (typeof cfIp === "string" && cfIp) return cfIp;
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0]!.trim();
  return request.ip;
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<SessionUser | null> {
  const user = await resolveSession(request.cookies[sessionCookie]);
  if (!user) {
    reply.code(401).send({ error: "Đăng nhập để tiếp tục" });
    return null;
  }
  request.user = user;
  return user;
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<SessionUser | null> {
  const user = await requireUser(request, reply);
  if (!user) return null;
  if (user.role !== "ADMIN") {
    reply.code(403).send({ error: "Chỉ admin" });
    return null;
  }
  return user;
}
