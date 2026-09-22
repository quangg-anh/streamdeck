-- Cooldown claims moved from Redis to PostgreSQL.
-- Expired rows are deleted and re-created atomically inside one transaction.
CREATE TABLE "Cooldown" (
    "key" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cooldown_pkey" PRIMARY KEY ("key")
);
