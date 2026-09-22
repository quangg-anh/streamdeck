import type { EffectAction, QueueMode } from "@streamfx/types";

export type OverlaySettings = { volume: number; ttsEnabled: boolean; ttsVoice: string | null; ttsRate: number; ttsMaxLength: number; queueLimit: number };
export const defaultSettings: OverlaySettings = { volume: 1, ttsEnabled: true, ttsVoice: null, ttsRate: 1, ttsMaxLength: 280, queueLimit: 50 };
export type Run = { runId: string; actions: EffectAction[] };
export type Frame = { key: number; action: EffectAction; signal: AbortSignal; done: () => void };
type Message = { kind: "effect"; mode: QueueMode; runId: string; actions: EffectAction[] } | { kind: "control"; command: "clear" | "stop" } | { kind: "settings"; settings: Partial<OverlaySettings> } | { kind: "ping"; at: number };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const number = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const integer = (v: unknown, min: number, max: number) => number(v, min, max) && Number.isInteger(v);

// Mirror protocol checks locally: web does not depend on protocol/zod.
export function parseMessage(raw: unknown, projectId: string): Message | null {
  try {
    if (typeof raw !== "string" || raw.length > 1_000_000) return null;
    const m: unknown = JSON.parse(raw);
    if (!object(m)) return null;
    if (m.kind === "ping") return number(m.at, -Number.MAX_VALUE, Number.MAX_VALUE) ? { kind: "ping", at: m.at } : null;
    if (m.kind === "settings") {
      if ((m.projectId !== undefined && m.projectId !== projectId) || !object(m.settings)) return null;
      const s = m.settings;
      const result: Partial<OverlaySettings> = {};
      for (const key of Object.keys(defaultSettings) as (keyof OverlaySettings)[]) {
        if (!(key in s)) continue;
        const v = s[key];
        const valid = key === "volume" ? number(v, 0, 1) : key === "ttsRate" ? number(v, .5, 2) : key === "queueLimit" ? integer(v, 1, 200) : key === "ttsMaxLength" ? integer(v, 1, 1000) : key === "ttsEnabled" ? typeof v === "boolean" : v === null || (typeof v === "string" && v.length <= 100);
        if (!valid) return null;
        Object.assign(result, { [key]: v });
      }
      return { kind: "settings", settings: result };
    }
    if (m.projectId !== projectId) return null;
    if (m.kind === "control") return (m.command === "stop" || m.command === "clear") && (m.runId === undefined || typeof m.runId === "string") ? { kind: "control", command: m.command } : null;
    if (m.kind !== "effect" || typeof m.runId !== "string" || typeof m.effectId !== "string" || !["QUEUE", "REPLACE", "DROP"].includes(String(m.mode)) || !Array.isArray(m.actions) || !m.actions.length || m.actions.length > 1000) return null;
    const actions: EffectAction[] = [];
    for (const a of m.actions) {
      if (!object(a) || typeof a.type !== "string") return null;
      const control = a.type === "stop" || a.type === "clear";
      const duration = a.durationMs ?? (control ? 0 : undefined);
      if (!integer(duration, control || a.type === "wait" ? 0 : 100, 300000)) return null;
      const action: EffectAction = { type: a.type as EffectAction["type"], durationMs: duration as number };
      if (["image", "video", "audio"].includes(a.type)) {
        if (typeof a.url !== "string" || !a.url.trim()) return null;
        const url = new URL(a.url, "http://overlay.local");
        if (!["http:", "https:", "blob:"].includes(url.protocol)) return null;
        if (a.volume !== undefined && !number(a.volume, 0, 1)) return null;
        action.url = a.url; action.volume = a.volume as number | undefined;
      } else if (a.type === "tts") {
        if (typeof a.text !== "string" || !a.text.length || a.text.length > 1000 || (a.rate !== undefined && !number(a.rate, .5, 2))) return null;
        action.text = a.text; action.rate = a.rate as number | undefined;
      } else if (!["wait", "confetti", "stop", "clear"].includes(a.type)) return null;
      actions.push(action);
    }
    return { kind: "effect", mode: m.mode as QueueMode, runId: m.runId, actions };
  } catch { return null; }
}

export class OverlayRuntime {
  settings = { ...defaultSettings };
  private pending: Run[] = [];
  private active: Run | null = null;
  private index = 0;
  private serial = 0;
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  constructor(private render: (frame: Frame | null) => void) {}
  update(settings: Partial<OverlaySettings>) {
    this.settings = { ...this.settings, ...settings };
    this.pending = this.pending.slice(0, this.settings.queueLimit);
  }
  enqueue(run: Run, mode: QueueMode) {
    if (this.disposed || (mode === "DROP" && this.active)) return;
    if (mode === "REPLACE") { this.pending = []; this.cancel(); this.active = null; }
    if (!this.active) { this.active = run; this.index = 0; this.advance(); }
    else if (this.pending.length < this.settings.queueLimit) this.pending.push(run);
  }
  control(command: "stop" | "clear") {
    if (this.disposed) return;
    if (command === "clear") this.pending = [];
    this.cancel(); this.active = null; this.advance();
  }
  dispose() { this.disposed = true; this.pending = []; this.active = null; this.cancel(); }
  private cancel() {
    ++this.serial;
    clearTimeout(this.timer); this.timer = undefined;
    this.controller?.abort(); this.controller = null;
    this.render(null);
  }
  private advance() {
    if (this.disposed) return;
    this.cancel();
    // Iterative drain prevents recursive overflow for runs containing controls.
    while (true) {
      if (!this.active || this.index >= this.active.actions.length) {
        this.active = this.pending.shift() ?? null; this.index = 0;
      }
      if (!this.active) return;
      const action = this.active.actions[this.index++];
      if (action.type === "clear" || action.type === "stop") {
        if (action.type === "clear") this.pending = [];
        this.active = null; continue;
      }
      if (action.type === "tts" && !this.settings.ttsEnabled) continue;
      const controller = new AbortController(); this.controller = controller;
      const key = ++this.serial;
      const done = () => { if (!controller.signal.aborted && key === this.serial) this.advance(); };
      this.timer = setTimeout(done, action.durationMs);
      if (action.type !== "wait") this.render({ key, action, signal: controller.signal, done });
      return;
    }
  }
}