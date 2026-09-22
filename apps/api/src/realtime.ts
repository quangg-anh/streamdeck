import type { WebSocket } from "ws";
import type { ServerMessage } from "@streamfx/protocol";

const heartbeatMs = 15000;
export function createRealtime() {
const rooms = new Map<string, Set<WebSocket>>();
const sockets = new Map<WebSocket, { alive: boolean; projectId?: string }>();
function track(socket: WebSocket) {
  if (sockets.has(socket)) return;
  sockets.set(socket, { alive: true });
  socket.on("pong", () => { const state = sockets.get(socket); if (state) state.alive = true; });
  socket.on("error", () => socket.terminate());
  socket.once("close", () => { leave(socket); sockets.delete(socket); });
}
function leave(socket: WebSocket) {
  const state = sockets.get(socket);
  if (!state?.projectId) return;
  const room = rooms.get(state.projectId);
  room?.delete(socket);
  if (!room?.size) rooms.delete(state.projectId);
  state.projectId = undefined;
}
function join(projectId: string, socket: WebSocket) {
  if (socket.readyState !== socket.OPEN) return;
  track(socket);
  leave(socket);
  const room = rooms.get(projectId) ?? new Set<WebSocket>();
  room.add(socket);
  rooms.set(projectId, room);
  sockets.get(socket)!.projectId = projectId;
  send(socket, { kind: "subscribed", projectId, heartbeatMs });
}

function send(socket: WebSocket, message: ServerMessage) {
  if (socket.readyState !== socket.OPEN) return;
  if (socket.bufferedAmount > 1_000_000) { socket.terminate(); return; }
  try { socket.send(JSON.stringify(message), error => { if (error) socket.terminate(); }); }
  catch { socket.terminate(); }
}

function broadcast(projectId: string, message: ServerMessage) {
  for (const socket of rooms.get(projectId) ?? []) send(socket, message);
}

const timer = setInterval(() => {
    const message: ServerMessage = { kind: "ping", at: Date.now() };
    for (const [socket, state] of sockets) {
      if (!state.alive) { socket.terminate(); continue; }
      state.alive = false;
      try { socket.ping(); send(socket, message); } catch { socket.terminate(); }
    }
  }, heartbeatMs);
  timer.unref();
return { track, join, send, broadcast, close() { clearInterval(timer); for (const socket of sockets.keys()) socket.terminate(); sockets.clear(); rooms.clear(); } };
}
