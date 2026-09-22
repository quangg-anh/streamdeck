// StreamFX serves Next.js THROUGH the Fastify API server (apps/api/src/server.ts).
// Running `next dev`/`next start` standalone leaves /api/* and /ws without a
// backend, which shows up as 404 on every login attempt. Block it loudly.
const script = process.argv[2];
if (script !== "dev" && script !== "start") {
  console.error(`Usage: node no-standalone.mjs <dev|start> [next args...]`);
  process.exit(1);
}
console.error(`
  [StreamFX] Không được chạy Next.js riêng lẻ ("next ${script}").

  Next.js phải chạy QUA máy chủ API Fastify để /api/* và /ws hoạt động:

    npm run dev        (từ thư mục gốc repository)

  Chi tiết: apps/api/src/server.ts nhúng Next vào cùng port với API.
`);
process.exit(1);
