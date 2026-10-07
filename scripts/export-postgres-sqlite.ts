import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import dotenv from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });

const requireFromApi = createRequire(path.join(root, "apps", "api", "package.json"));
const { PrismaClient } = requireFromApi("@prisma/client") as { PrismaClient: new () => { [key: string]: any } };

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputArg = process.argv.find(argument => argument.startsWith("--output="))?.slice("--output=".length);
const outputDir = path.resolve(root, outputArg ?? path.join("data", "backups", `postgres-to-sqlite-${timestamp}`));

const prisma = new PrismaClient();

const json = (value: unknown) => JSON.stringify(value);
const iso = (value: Date | null) => value?.toISOString() ?? null;

const sqliteSchema = `
PRAGMA foreign_keys = ON;
CREATE TABLE "User" (
  "id" TEXT PRIMARY KEY,
  "username" TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'USER',
  "blocked" INTEGER NOT NULL DEFAULT 0,
  "deckLimit" INTEGER NOT NULL DEFAULT 1,
  "planExpiresAt" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE TABLE "Session" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "expiresAt" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL
);
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE TABLE "Project" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "overlayToken" TEXT NOT NULL UNIQUE,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE INDEX "Project_userId_idx" ON "Project"("userId");
CREATE TABLE "Effect" (
  "id" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "actions" TEXT NOT NULL CHECK (json_valid("actions")),
  "mode" TEXT NOT NULL DEFAULT 'QUEUE' CHECK ("mode" IN ('QUEUE', 'REPLACE', 'DROP')),
  "cooldownMs" INTEGER NOT NULL DEFAULT 0,
  "enabled" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE TABLE "DeckButton" (
  "id" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
  "label" TEXT NOT NULL,
  "color" TEXT NOT NULL DEFAULT '#7c3aed',
  "icon" TEXT,
  "effectId" TEXT NOT NULL REFERENCES "Effect"("id") ON DELETE CASCADE,
  "position" INTEGER NOT NULL DEFAULT 0,
  "enabled" INTEGER NOT NULL DEFAULT 1,
  "cooldownMs" INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE "Asset" (
  "id" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL
);
CREATE TABLE "Settings" (
  "projectId" TEXT PRIMARY KEY REFERENCES "Project"("id") ON DELETE CASCADE,
  "volume" REAL NOT NULL DEFAULT 0.8,
  "queueLimit" INTEGER NOT NULL DEFAULT 50,
  "developerMode" INTEGER NOT NULL DEFAULT 0,
  "userToken" TEXT NOT NULL UNIQUE
);
CREATE TABLE "Cooldown" (
  "key" TEXT PRIMARY KEY,
  "expiresAt" TEXT NOT NULL
);
`;

const bool = (value: boolean) => value ? 1 : 0;

async function main() {
  await mkdir(outputDir, { recursive: true });
  const tables = {
    User: await prisma.user.findMany({ orderBy: { id: "asc" } }),
    Session: await prisma.session.findMany({ orderBy: { id: "asc" } }),
    Project: await prisma.project.findMany({ orderBy: { id: "asc" } }),
    Effect: await prisma.effect.findMany({ orderBy: { id: "asc" } }),
    DeckButton: await prisma.deckButton.findMany({ orderBy: { id: "asc" } }),
    Asset: await prisma.asset.findMany({ orderBy: { id: "asc" } }),
    Settings: await prisma.settings.findMany({ orderBy: { projectId: "asc" } }),
    Cooldown: await prisma.cooldown.findMany({ orderBy: { key: "asc" } })
  };

  await writeFile(path.join(outputDir, "data.json"), `${JSON.stringify({
    formatVersion: 1,
    source: "postgresql",
    exportedAt: new Date().toISOString(),
    tables
  }, null, 2)}\n`, "utf8");

  const databasePath = path.join(outputDir, "streamfx.sqlite");
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(sqliteSchema);
    database.exec("BEGIN");
    try {
      const insertUser = database.prepare("INSERT INTO \"User\" VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const row of tables.User) insertUser.run(row.id, row.username, row.passwordHash, row.role, bool(row.blocked), row.deckLimit, iso(row.planExpiresAt), iso(row.createdAt), iso(row.updatedAt));
      const insertSession = database.prepare("INSERT INTO \"Session\" VALUES (?, ?, ?, ?)");
      for (const row of tables.Session) insertSession.run(row.id, row.userId, iso(row.expiresAt), iso(row.createdAt));
      const insertProject = database.prepare("INSERT INTO \"Project\" VALUES (?, ?, ?, ?, ?, ?, ?)");
      for (const row of tables.Project) insertProject.run(row.id, row.name, row.description, row.userId, row.overlayToken, iso(row.createdAt), iso(row.updatedAt));
      const insertEffect = database.prepare("INSERT INTO \"Effect\" VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const row of tables.Effect) insertEffect.run(row.id, row.projectId, row.name, json(row.actions), row.mode, row.cooldownMs, bool(row.enabled), iso(row.createdAt), iso(row.updatedAt));
      const insertButton = database.prepare("INSERT INTO \"DeckButton\" VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const row of tables.DeckButton) insertButton.run(row.id, row.projectId, row.label, row.color, row.icon, row.effectId, row.position, bool(row.enabled), row.cooldownMs);
      const insertAsset = database.prepare("INSERT INTO \"Asset\" VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      for (const row of tables.Asset) insertAsset.run(row.id, row.projectId, row.name, row.mime, row.path, row.size, row.sha256, iso(row.createdAt));
      const insertSettings = database.prepare("INSERT INTO \"Settings\" VALUES (?, ?, ?, ?, ?)");
      for (const row of tables.Settings) insertSettings.run(row.projectId, row.volume, row.queueLimit, bool(row.developerMode), row.userToken);
      const insertCooldown = database.prepare("INSERT INTO \"Cooldown\" VALUES (?, ?)");
      for (const row of tables.Cooldown) insertCooldown.run(row.key, iso(row.expiresAt));
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    database.exec("PRAGMA optimize");
  } finally {
    database.close();
  }

  const uploadsSource = path.resolve(root, process.env.UPLOAD_DIR ?? "data/uploads");
  const uploadsTarget = path.join(outputDir, "uploads");
  await mkdir(uploadsTarget, { recursive: true });
  await cp(uploadsSource, uploadsTarget, { recursive: true, force: true, errorOnExist: false });

  const counts = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length]));
  console.log(JSON.stringify({ outputDir, database: databasePath, counts }, null, 2));
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());