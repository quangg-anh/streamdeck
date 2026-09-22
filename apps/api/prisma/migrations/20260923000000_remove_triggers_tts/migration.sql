/*
  Warnings:

  - You are about to drop the column `ttsVoice` on the `Settings` table. This command is irreversible.
  - You are about to drop the column `ttsRate` on the `Settings` table. This command is irreversible.
  - You are about to drop the column `ttsMaxLength` on the `Settings` table. This command is irreversible.
  - You are about to drop the column `ttsEnabled` on the `Settings` table. This command is irreversible.
  - You are about to drop the column `allowMockEvents` on the `Settings` table. This command is irreversible.
  - You are about to drop the `Trigger` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Trigger" DROP CONSTRAINT "Trigger_effectId_fkey";

-- DropForeignKey
ALTER TABLE "Trigger" DROP CONSTRAINT "Trigger_projectId_fkey";

-- AlterTable
ALTER TABLE "Settings" DROP COLUMN "allowMockEvents",
DROP COLUMN "ttsEnabled",
DROP COLUMN "ttsMaxLength",
DROP COLUMN "ttsRate",
DROP COLUMN "ttsVoice";

-- DropTable
DROP TABLE "Trigger";
