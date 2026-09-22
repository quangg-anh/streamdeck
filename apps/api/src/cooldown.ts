import Redis from "ioredis";

export type Cooldown = { key: string; durationMs: number };
const claimScript = `
for i, key in ipairs(KEYS) do
  if redis.call('EXISTS', key) == 1 then return 0 end
end
for i, key in ipairs(KEYS) do
  redis.call('SET', key, '1', 'PX', ARGV[i])
end
return 1`;

export function createCooldowns() {
  const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 }) : null;
  // Redis failures fail closed: switching stores can bypass existing cooldowns.
  redis?.on("error", () => {});
  const memory = new Map<string, number>();
  const sweep = () => { const now = Date.now(); for (const [key, expiry] of memory) if (expiry <= now) memory.delete(key); };
  const timer = setInterval(sweep, 30_000);
  timer.unref();
  return {
    async claim(items: Cooldown[]) {
      const grouped = new Map<string, number>();
      for (const { key, durationMs } of items) {
        if (!Number.isSafeInteger(durationMs) || durationMs < 0) throw new Error("Invalid cooldown");
        if (durationMs > 0) grouped.set(key, Math.max(grouped.get(key) ?? 0, durationMs));
      }
      if (!grouped.size) return true;
      if (redis) return Number(await redis.eval(claimScript, grouped.size, ...grouped.keys(), ...grouped.values())) === 1;
      sweep();
      const now = Date.now();
      for (const key of grouped.keys()) if ((memory.get(key) ?? 0) > now) return false;
      for (const [key, duration] of grouped) memory.set(key, now + duration);
      return true;
    },
    close() { clearInterval(timer); memory.clear(); redis?.disconnect(); }
  };
}
