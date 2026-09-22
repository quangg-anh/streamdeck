-- Auth (admin/user), sessions, deck quota and plan expiry for StreamFX business plans.

-- User: credentials + plan (deckLimit, planExpiresAt).
-- passwordHash '!' is an invalid scrypt hash -> legacy rows cannot log in
-- until an admin resets their password.
ALTER TABLE "User" ADD COLUMN "username" TEXT;
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT NOT NULL DEFAULT '!';
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'USER';
ALTER TABLE "User" ADD COLUMN "blocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "deckLimit" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "User" ADD COLUMN "planExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "User" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "User" SET "username" = "id" WHERE "username" IS NULL;
ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- Session: server-side sessions referenced by an opaque cookie value.
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- Project: overlay access token for OBS browser sources.
ALTER TABLE "Project" ADD COLUMN "overlayToken" TEXT;
UPDATE "Project" SET "overlayToken" = 'mig_' || md5(random()::text || clock_timestamp()::text) WHERE "overlayToken" IS NULL;
ALTER TABLE "Project" ALTER COLUMN "overlayToken" SET NOT NULL;
CREATE UNIQUE INDEX "Project_overlayToken_key" ON "Project"("overlayToken");
CREATE INDEX "Project_userId_idx" ON "Project"("userId");

-- Settings: token the deck operator uses to trigger buttons.
ALTER TABLE "Settings" ADD COLUMN "userToken" TEXT;
UPDATE "Settings" SET "userToken" = 'mig_' || md5(random()::text || clock_timestamp()::text) WHERE "userToken" IS NULL;
ALTER TABLE "Settings" ALTER COLUMN "userToken" SET NOT NULL;
CREATE UNIQUE INDEX "Settings_userToken_key" ON "Settings"("userToken");

-- ForeignKeys
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
