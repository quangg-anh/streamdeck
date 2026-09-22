import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import { expect, it, vi } from "vitest";
import { createRealtime } from "./realtime.js";

it("deduplicates subscriptions, switches rooms, drops slow/dead sockets and closes timers", () => {
  vi.useFakeTimers();
  const realtime = createRealtime();
  const socket = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, bufferedAmount: 0, send: vi.fn(), ping: vi.fn(), terminate: vi.fn() });
  const ws = socket as unknown as WebSocket;
  socket.terminate.mockImplementation(() => { socket.readyState = 3; socket.emit("close"); });
  try {
    realtime.join("a", ws); realtime.join("a", ws); realtime.join("b", ws);
    expect(socket.listenerCount("close")).toBe(1);
    socket.send.mockClear();
    realtime.broadcast("a", { kind: "ping", at: 1 });
    expect(socket.send).not.toHaveBeenCalled();
    realtime.broadcast("b", { kind: "ping", at: 1 });
    expect(socket.send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(15_000);
    expect(socket.ping).toHaveBeenCalledTimes(1);
    socket.emit("pong");
    vi.advanceTimersByTime(15_000);
    expect(socket.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(15_000);
    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(socket.listenerCount("close")).toBe(0);
  } finally { realtime.close(); expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); }
});

it("terminates on outbound backpressure or asynchronous send failure", () => {
  const realtime = createRealtime();
  const socket = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, bufferedAmount: 1_000_001, send: vi.fn(), terminate: vi.fn() });
  try {
    realtime.send(socket as unknown as WebSocket, { kind: "pong", at: 1 });
    expect(socket.terminate).toHaveBeenCalledTimes(1);
    socket.bufferedAmount = 0;
    socket.send.mockImplementation((_data, callback) => callback(new Error("closed")));
    realtime.send(socket as unknown as WebSocket, { kind: "pong", at: 1 });
    expect(socket.terminate).toHaveBeenCalledTimes(2);
  } finally { realtime.close(); }
});