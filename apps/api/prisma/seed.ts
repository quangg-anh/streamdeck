import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient, QueueMode } from "@prisma/client";
import { hashPassword } from "../src/auth.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(directory, "../../../.env") });
const prisma = new PrismaClient();

// Bootstrap admin (username from ADMIN_USERNAME, password from ADMIN_PASSWORD).
// Demo user only created when DEMO_USER_PASSWORD is set.
const adminUsername = process.env.ADMIN_USERNAME ?? "admin";
const adminPassword = process.env.ADMIN_PASSWORD ?? "admin12345";
const demoPassword = process.env.DEMO_USER_PASSWORD;

const admin = await prisma.user.upsert({ where: { username: adminUsername }, update: { role: "ADMIN", blocked: false }, create: { username: adminUsername, passwordHash: await hashPassword(adminPassword), role: "ADMIN", deckLimit: 100, planExpiresAt: null } });
const existing = await prisma.project.findFirst({ where: { userId: admin.id } });
if (!existing) {
  await prisma.project.create({ data: { name: "My Stream", userId: admin.id, settings: { create: { developerMode: true } }, effects: { create: [{ name: "Celebration", mode: QueueMode.REPLACE, actions: [{ type: "confetti", durationMs: 4000 }] }, { name: "Say thanks", actions: [{ type: "tts", text: "Thanks for the support!", durationMs: 5000 }] }] } } });
}

if (demoPassword) {
  const demo = await prisma.user.upsert({ where: { username: "demo" }, update: {}, create: { username: "demo", passwordHash: await hashPassword(demoPassword), role: "USER", deckLimit: 1, planExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } });
  const demoProject = await prisma.project.findFirst({ where: { userId: demo.id } });
  if (!demoProject) await prisma.project.create({ data: { name: "Demo Deck", userId: demo.id, settings: { create: {} }, effects: { create: [{ name: "Confetti", actions: [{ type: "confetti", durationMs: 3000 }] }] } } });
}
await prisma.$disconnect();
