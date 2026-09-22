import type { EffectAction, QueueMode } from "@streamfx/protocol";

export type EffectRun = { runId: string; actions: EffectAction[] };
export type QueueState = { active: EffectRun | null; pending: EffectRun[] };

export function enqueue(state: QueueState, run: EffectRun, mode: QueueMode, limit: number): QueueState {
  if (mode === "REPLACE") return { active: run, pending: [] };
  if (mode === "DROP" && state.active) return state;
  if (!state.active) return { active: run, pending: [] };
  if (state.pending.length >= limit) return state;
  return { active: state.active, pending: [...state.pending, run] };
}

export function complete(state: QueueState): QueueState {
  const [active = null, ...pending] = state.pending;
  return { active, pending };
}

export function clear(): QueueState {
  return { active: null, pending: [] };
}

export function actionDuration(actions: EffectAction[]) {
  return actions.reduce((total, action) => total + action.durationMs, 0);
}
