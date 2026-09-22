import { describe, expect, it } from "vitest";
import { actionDuration, clear, complete, enqueue, type QueueState } from "./engine.js";

const idle: QueueState = { active: null, pending: [] };
const run = (runId: string) => ({ runId, actions: [{ type: "wait" as const, durationMs: 100 }] });

describe("effect queue", () => {
  it("starts first run and queues later runs", () => {
    const started = enqueue(idle, run("one"), "QUEUE", 2);
    expect(enqueue(started, run("two"), "QUEUE", 2)).toEqual({ active: run("one"), pending: [run("two")] });
  });
  it("replaces active run", () => expect(enqueue({ active: run("one"), pending: [run("two")] }, run("three"), "REPLACE", 2)).toEqual({ active: run("three"), pending: [] }));
  it("drops while active", () => {
    const state = { active: run("one"), pending: [] };
    expect(enqueue(state, run("two"), "DROP", 2)).toBe(state);
  });
  it("enforces queue limit and advances", () => {
    const state = { active: run("one"), pending: [run("two")] };
    expect(enqueue(state, run("three"), "QUEUE", 1)).toBe(state);
    expect(complete(state)).toEqual({ active: run("two"), pending: [] });
  });
  it("clears and totals action duration", () => {
    expect(clear()).toEqual(idle);
    expect(actionDuration([{ type: "wait", durationMs: 100 }, { type: "clear", durationMs: 0 }])).toBe(100);
  });
});
