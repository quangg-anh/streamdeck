import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, OverlayRuntime, parseMessage, type Frame, type Run } from "./runtime";
import { playMedia } from "./playback";

const run = (runId: string, durationMs = 1000): Run => ({ runId, actions: [{ type: "image", url: `/${runId}.png`, durationMs }] });
function setup() {
  vi.useFakeTimers();
  let frame: Frame | null = null;
  const runtime = new OverlayRuntime(value => { frame = value; });
  return { runtime, frame: () => frame };
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("overlay queue", () => {
  it("replacement aborts old work; stale completion cannot consume new queue", () => {
    const s = setup();
    s.runtime.enqueue(run("old"), "QUEUE");
    const old = s.frame()!;
    s.runtime.enqueue(run("discard"), "QUEUE");
    s.runtime.enqueue(run("new", 2000), "REPLACE");
    s.runtime.enqueue(run("next"), "QUEUE");
    expect(old.signal.aborted).toBe(true);
    old.done(); vi.advanceTimersByTime(1000);
    expect(s.frame()?.action.url).toBe("/new.png");
    vi.advanceTimersByTime(1000);
    expect(s.frame()?.action.url).toBe("/next.png");
    s.runtime.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it("stop starts pending, clear drops pending", () => {
    const s = setup();
    s.runtime.enqueue(run("a"), "QUEUE"); s.runtime.enqueue(run("b"), "QUEUE");
    s.runtime.control("stop"); expect(s.frame()?.action.url).toBe("/b.png");
    s.runtime.enqueue(run("c"), "QUEUE"); s.runtime.control("clear");
    expect(s.frame()).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds pending queue, drops newest overflow, trims on settings update", () => {
    const s = setup(); s.runtime.update({ queueLimit: 2 });
    for (const id of ["a", "b", "c", "overflow"]) s.runtime.enqueue(run(id), "QUEUE");
    s.runtime.enqueue(run("dropped"), "DROP"); s.runtime.update({ queueLimit: 1 });
    s.runtime.control("stop"); expect(s.frame()?.action.url).toBe("/b.png");
    s.runtime.control("stop"); expect(s.frame()).toBeNull();
  });
  it("repeated identical media get fresh keys; completion is idempotent", () => {
    const s = setup(); s.runtime.enqueue({ runId: "a", actions: [...run("a").actions, ...run("a").actions] }, "QUEUE");
    const first = s.frame()!; first.done();
    const second = s.frame()!; expect(second.key).not.toBe(first.key);
    first.done(); expect(s.frame()).toBe(second);
    second.done(); expect(s.frame()).toBeNull();
  });
  it("wait cancels immediately, action controls match external controls", () => {
    const s = setup();
    s.runtime.enqueue({ runId: "a", actions: [{ type: "wait", durationMs: 5000 }, { type: "stop", durationMs: 0 }] }, "QUEUE");
    expect(s.frame()).toBeNull();
    s.runtime.enqueue(run("pending"), "QUEUE"); vi.advanceTimersByTime(5000);
    expect(s.frame()?.action.url).toBe("/pending.png");
    s.runtime.enqueue({ runId: "clear", actions: [{ type: "wait", durationMs: 0 }, { type: "clear", durationMs: 0 }] }, "REPLACE");
    s.runtime.enqueue(run("discard"), "QUEUE"); vi.runAllTimers(); expect(s.frame()).toBeNull();
    s.runtime.dispose(); s.runtime.enqueue(run("ignored"), "QUEUE"); expect(s.frame()).toBeNull();
  });
});

describe("inbound validation", () => {
  const message = { kind: "effect", projectId: "p", effectId: "e", mode: "QUEUE", ...run("a") };
  it("accepts valid protocol actions and settings extension", () => {
    expect(parseMessage(JSON.stringify(message), "p")?.kind).toBe("effect");
    expect(parseMessage(JSON.stringify({ kind: "settings", settings: { volume: .3, queueLimit: 3, developerMode: true } }), "p")).toEqual({ kind: "settings", settings: { volume: .3, queueLimit: 3 } });
  });
  it("rejects malformed, cross-project and unsafe payloads without throwing", () => {
    for (const raw of ["{", "null", "[]", JSON.stringify({ ...message, projectId: "other" }), JSON.stringify({ ...message, mode: "bad" }), JSON.stringify({ ...message, actions: [{ type: "image", durationMs: 100, url: "javascript:alert(1)" }] }), JSON.stringify({ ...message, actions: [{ type: "wait", durationMs: -1 }] }), JSON.stringify({ kind: "settings", settings: { queueLimit: 201 } }), JSON.stringify({ kind: "control", projectId: "p", command: "bad" })]) expect(parseMessage(raw, "p")).toBeNull();
    expect(parseMessage({}, "p")).toBeNull();
  });
});

describe("playback lifecycle", () => {
  function mediaMock() {
    return Object.assign(new EventTarget(), { volume: 1, play: vi.fn(() => Promise.resolve()), pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn(), setAttribute: vi.fn() });
  }
  it.each(["ended", "error"])("media %s completes, abort releases media", event => {
    const s = setup(); s.runtime.enqueue(run("a"), "QUEUE");
    const frame = s.frame()!; const media = mediaMock();
    playMedia(media as unknown as HTMLMediaElement, frame, { ...defaultSettings, volume: .4 });
    expect(media.volume).toBe(.4); media.dispatchEvent(new Event(event));
    expect(s.frame()).toBeNull(); expect(media.pause).toHaveBeenCalledOnce(); expect(media.load).toHaveBeenCalledOnce();
  });
  it("rejected play advances; late rejection from replaced media stays harmless", async () => {
    const s = setup(); s.runtime.enqueue(run("a"), "QUEUE");
    const media = mediaMock(); media.play.mockRejectedValue(new Error("autoplay"));
    playMedia(media as unknown as HTMLMediaElement, s.frame()!, defaultSettings);
    await Promise.resolve(); expect(s.frame()).toBeNull();
    s.runtime.enqueue(run("old"), "QUEUE");
    playMedia(media as unknown as HTMLMediaElement, s.frame()!, defaultSettings);
    s.runtime.enqueue(run("new"), "REPLACE"); await Promise.resolve();
    expect(s.frame()?.action.url).toBe("/new.png"); s.runtime.dispose();
  });
});