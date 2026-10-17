// Energy VAD. Speech has to last long enough to count; trailing silence ends the turn once.
// Byte size of a recording is not evidence that anyone spoke.

export const VAD_TRAIL_MS = 900;
export const VAD_START_WAIT_MS = 8_000;
export const VAD_FOLLOW_MS = 10_000;
export const VAD_MAX_MS = 20_000;
export const UTTERANCE_MAX_MS = VAD_MAX_MS;
export const VAD_MIN_SPEECH_MS = 280;

export type VadState = {
  noise: number;
  speechMs: number;
  silenceMs: number;
  elapsed: number;
  heard: boolean;
  voicedElapsed?: number;
};

export type VadEndpoint = "none" | "silence" | "max" | "no-speech";

/** `no-speech` only before the first speech. After onset, the 20 s budget starts then, not from mic open. */
export function listenLimit(openedAt: number, onsetAt: number | null, now: number, startWaitMs: number): "open" | "no-speech" | "max" {
  if (!Number.isFinite(openedAt) || !Number.isFinite(now)) return "open";
  if (onsetAt === null) return now - openedAt >= startWaitMs ? "no-speech" : "open";
  if (!Number.isFinite(onsetAt)) return "open";
  return now - onsetAt >= UTTERANCE_MAX_MS ? "max" : "open";
}

export function createVad(): VadState {
  return {noise: 0.012, speechMs: 0, silenceMs: 0, elapsed: 0, heard: false};
}

export function vadStep(
  state: VadState,
  rms: number,
  dtMs: number,
  options?: {startWaitMs?: number; trailMs?: number; maxMs?: number},
): {state: VadState; endpoint: VadEndpoint} {
  const trail = options?.trailMs ?? VAD_TRAIL_MS;
  const startWait = options?.startWaitMs ?? VAD_START_WAIT_MS;
  const max = options?.maxMs ?? VAD_MAX_MS;
  const dt = Number.isFinite(dtMs) ? Math.max(0, dtMs) : 0;
  const sample = Number.isFinite(rms) ? Math.max(0, rms) : 0;
  const speaking = sample >= Math.max(0.02, state.noise * (state.heard ? 2 : 2.8));
  const noise = speaking || state.heard ? state.noise : state.noise * 0.92 + sample * 0.08;
  let speechMs = state.speechMs;
  let silenceMs = 0;
  let heard = state.heard;
  if (speaking) {
    speechMs += Math.min(400, dt);
    if (speechMs >= VAD_MIN_SPEECH_MS) heard = true;
  } else if (heard) {
    silenceMs = state.silenceMs + dt;
  } else {
    speechMs = 0;
  }
  const next: VadState = {noise, speechMs, silenceMs, elapsed: state.elapsed + dt, heard, voicedElapsed: heard ? (state.voicedElapsed ?? 0) + dt : 0};
  if (heard && silenceMs >= trail) return {state: next, endpoint: "silence"};
  if ((next.voicedElapsed ?? 0) >= max) return {state: next, endpoint: heard ? "max" : "no-speech"};
  if (!heard && next.elapsed >= startWait) return {state: next, endpoint: "no-speech"};
  return {state: next, endpoint: "none"};
}
