import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient, QueueMode } from "@prisma/client";

const directory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(directory, "../../../.env") });
const prisma = new PrismaClient();
const userId = process.env.DEV_USER_ID ?? "dev-user";
await prisma.user.upsert({ where: { id: userId }, update: {}, create: { id: userId } });
const existing = await prisma.project.findFirst({ where: { userId } });
if (!existing) {
  await prisma.project.create({ data: { name: "My Stream", userId, settings: { create: { developerMode: true } }, effects: { create: [{ name: "Celebration", mode: QueueMode.REPLACE, actions: [{ type: "confetti", durationMs: 4000 }] }, { name: "Say thanks", actions: [{ type: "tts", text: "Thanks for the support!", durationMs: 5000 }] }] } } });
}
await prisma.$disconnect();
