import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";

export type Cooldown = { key: string; durationMs: number };

// PostgreSQL-backed cooldown claims. A group claims all keys or none:
// the transaction rolls back on any active key, and concurrent claims
// on the same key resolve via the primary key (unique violation => loser
// rolls back having consumed nothing), matching the old Redis Lua semantics.
// Store failures fail closed: we never silently fall back to memory because
// switching stores can bypass existing cooldowns.

export function createCooldowns() {
  const memory = process.env.COOLDOWN_STORE === "memory";
  const store = new Map<string, number>();
  const sweepMemory = () => { const now = Date.now(); for (const [key, expiry] of store) if (expiry <= now) store.delete(key); };
  // The database sweep is opportunistic garbage collection; expiry itself is
  // enforced per claim, so a missed sweep only costs disk space, never correctness.
  const sweep = memory
    ? (() => { const timer = setInterval(sweepMemory, 30_000); timer.unref(); return timer; })()
    : (() => { const timer = setInterval(() => { void prisma.cooldown.deleteMany({ where: { expiresAt: { lte: new Date() } } }).catch(() => {}); }, 60_000); timer.unref(); return timer; })();
  return {
    async claim(items: Cooldown[]) {
      const grouped = new Map<string, number>();
      for (const { key, durationMs } of items) {
        if (!Number.isSafeInteger(durationMs) || durationMs < 0) throw new Error("Invalid cooldown");
        if (durationMs > 0) grouped.set(key, Math.max(grouped.get(key) ?? 0, durationMs));
      }
      if (!grouped.size) return true;
      if (memory) {
        sweepMemory();
        const now = Date.now();
        for (const key of grouped.keys()) if ((store.get(key) ?? 0) > now) return false;
        for (const [key, duration] of grouped) store.set(key, now + duration);
        return true;
      }
      // Sorted keys keep concurrent multi-key claims locking in a consistent
      // order, which prevents deadlocks between overlapping groups.
      const entries = [...grouped.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const keys = entries.map(([key]) => key);
      try {
        return await prisma.$transaction(async tx => {
          await tx.cooldown.deleteMany({ where: { key: { in: keys }, expiresAt: { lte: new Date() } } });
          if (await tx.cooldown.findFirst({ where: { key: { in: keys } }, select: { key: true } })) return false;
          await tx.cooldown.createMany({ data: entries.map(([key, duration]) => ({ key, expiresAt: new Date(Date.now() + duration) })) });
          return true;
        });
      } catch (error) {
        // Concurrent winner already inserted one of our keys: we lost the race cleanly.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
        throw error;
      }
    },
    close() { clearInterval(sweep); store.clear(); }
  };
}
