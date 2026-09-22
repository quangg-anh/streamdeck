import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import next from "next";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../..");
process.chdir(root);
dotenv.config({ path: path.join(root, ".env") });

const dev = !process.argv.includes("--production");
const configuredHost = process.env.STREAMFX_HOST ?? "127.0.0.1";
// Resolve localhost ourselves: never trust DNS to choose a non-loopback address.
const host = configuredHost === "localhost" ? "127.0.0.1" : configuredHost;
if (host !== "127.0.0.1" && host !== "::1") {
  throw new Error("StreamFX is LOCAL ONLY and has no authentication. STREAMFX_HOST must be 127.0.0.1, ::1, or localhost; non-loopback binding is forbidden.");
}
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}
const web = next({ dev, dir: path.join(root, "apps/web"), hostname: host, port });
let app: Awaited<ReturnType<typeof import("./index.js").buildApp>> | undefined;
let closing: Promise<void> | undefined;
const close = () => closing ??= (async () => {
  // Force exit only if graceful cleanup stalls (open requests or Next dev handles).
  const deadline = setTimeout(() => process.exit(1), 10_000);
  deadline.unref();
  for (const cleanup of [() => app?.close(), () => web.close(), async () => {
    const { prisma } = await import("./db.js");
    await prisma.$disconnect();
  }]) {
    try { await cleanup(); }
    catch (error) { console.error("StreamFX shutdown failed:", error); process.exitCode = 1; }
  }
  clearTimeout(deadline);
})();
const onSignal = () => {
  void close().then(() => process.exit(process.exitCode ?? 0));
};
try {
  await web.prepare();
  const { buildApp } = await import("./index.js");
  app = await buildApp();
  const handle = web.getRequestHandler();
  app.setNotFoundHandler(async (request, reply) => {
    reply.hijack();
    try { await handle(request.raw, reply.raw); }
    catch (error) {
      request.log.error(error, "Next request failed");
      if (!reply.raw.headersSent) { reply.raw.statusCode = 500; reply.raw.end("Internal Server Error"); }
      else { reply.raw.destroy(); }
    }
  });
  await app.listen({ host, port });
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
} catch (error) {
  console.error("StreamFX startup failed:", error);
  process.exitCode = 1;
  await close();
  process.exit(1);
}
