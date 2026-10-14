// What the on-screen agent (the robot in the corner) knows. Pages publish into this small store;
// the dock reads it. Pure state plus one derivation, so the robot's behaviour is unit-tested.
import type {DriverSeverity} from "../driver/types";

// Collecting samples is the normal background; it shows as calm, not as busy work.
export type AgentPhase = "offline" | "nodata" | "analyzing" | "ready";
export type AgentPresence = {phase: AgentPhase; severity: DriverSeverity};
// `vehicleAlert`: the car itself is still warning (hot engine), whatever the driver does.
export type CameraPresence = {active: boolean; sound: boolean; severity: DriverSeverity; responded: boolean; vehicleAlert?: boolean};
export type AgentMessage = {id: string; text: string; severity: DriverSeverity};
export type VoicePresence = {enabled: boolean | null; blocked: boolean; speaking: AgentMessage | null};
export type Presence = {
  agent: AgentPresence | null;
  camera: CameraPresence | null;
  /** The latest alert in words, shown in the bubble even when the sound is off. */
  message: AgentMessage | null;
  voice: VoicePresence;
  /** What the bubble shows and until when (epoch ms); a playing clip keeps it open. */
  bubble: {message: AgentMessage; until: number; dismissed: boolean} | null;
  happyUntil: number;
  /** The last alert the viewer saw (bubble closed by hand or the panel opened); others show a badge. */
  seenId: string | null;
};

export type RobotState = "idle" | "thinking" | "listening" | "speaking" | "happy" | "error" | "sleeping";

const RANK: Record<DriverSeverity, number> = {normal: 0, warning: 1, critical: 2};
export const worst = (...levels: (DriverSeverity | undefined)[]): DriverSeverity =>
  levels.reduce<DriverSeverity>((a, b) => (b && RANK[b] > RANK[a] ? b : a), "normal");

/** Speaking wins; then trouble, analysis in progress, a short celebration, the camera, and rest. */
export function robotState(p: Presence, happy: boolean): RobotState {
  if (p.voice.speaking) return "speaking";
  if (p.agent?.phase === "offline") return "error";
  if (p.agent?.phase === "analyzing") return "thinking";
  if (happy) return "happy";
  if (p.camera?.active) return "listening";
  if (p.agent?.phase === "nodata") return "sleeping";
  return "idle";
}

/** A good moment worth a smile: the driver confirmed, or an alert cleared. */
export function becameHappy(before: Presence, after: Presence): boolean {
  if (!before.camera?.responded && after.camera?.responded) return true;
  const was = worst(before.agent?.severity, before.camera?.severity);
  const now = worst(after.agent?.severity, after.camera?.severity);
  return was !== "normal" && now === "normal";
}

export const HAPPY_MS = 3500;
export const SHOW_MS: Record<DriverSeverity, number> = {normal: 7000, warning: 10_000, critical: 16_000};
export const AFTER_SPEECH_MS = 5000;

/** The next state after a patch at time `now`: the bubble follows the newest words, the robot smiles
 * when something good happened. Pure, so the timing rules are tested without a browser. */
export function advance(before: Presence, patch: Partial<Presence>, now: number): Presence {
  const after: Presence = {...before, ...patch};
  if (becameHappy(before, after)) after.happyUntil = now + HAPPY_MS;
  const newSpeech = after.voice.speaking && after.voice.speaking.id !== before.voice.speaking?.id ? after.voice.speaking : null;
  const newMessage = after.message && after.message.id !== before.message?.id ? after.message : null;
  const words = newSpeech ?? newMessage;
  if (words && words.id !== before.bubble?.message.id) {
    after.bubble = {message: words, until: now + SHOW_MS[words.severity], dismissed: false};
  } else if (before.voice.speaking && !after.voice.speaking && after.bubble) {
    after.bubble = {...after.bubble, until: Math.max(after.bubble.until, now + AFTER_SPEECH_MS)};
  }
  return after;
}

/** Whether the bubble is open at `now`. */
export const bubbleOpen = (p: Presence, now: number) =>
  !!p.bubble && !p.bubble.dismissed && (p.voice.speaking?.id === p.bubble.message.id || now < p.bubble.until);

/** An alert the viewer has not seen: its bubble is gone, but nobody closed it or opened the panel. */
export const unread = (p: Presence, now: number) =>
  !!p.bubble && p.bubble.message.severity !== "normal" && p.bubble.message.id !== p.seenId && !bubbleOpen(p, now);

const initial = (): Presence => ({agent: null, camera: null, message: null, voice: {enabled: null, blocked: false, speaking: null}, bubble: null, happyUntil: 0, seenId: null});

let state: Presence = initial();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

export const presence = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {listeners.delete(listener);};
  },
  set(patch: Partial<Presence>) {
    state = advance(state, patch, Date.now());
    emit();
  },
  /** Put an alert in the bubble. Same id twice is ignored. */
  say(message: AgentMessage) {
    if (state.message?.id === message.id) return;
    state = advance(state, {message}, Date.now());
    emit();
  },
  dismiss() {
    if (!state.bubble) return;
    state = {...state, bubble: {...state.bubble, dismissed: true}, seenId: state.bubble.message.id};
    emit();
  },
  /** The viewer looked (opened the panel). */
  markSeen() {
    if (!state.bubble || state.seenId === state.bubble.message.id) return;
    state = {...state, seenId: state.bubble.message.id};
    emit();
  },
  /** A short smile, e.g. waking up when the viewer comes back. */
  cheer() {
    state = {...state, happyUntil: Date.now() + HAPPY_MS};
    emit();
  },
  /** Show the last words again (a click on the robot). */
  reopen() {
    if (!state.bubble) return;
    state = {...state, bubble: {...state.bubble, dismissed: false, until: Date.now() + SHOW_MS[state.bubble.message.severity]}};
    emit();
  },
  reset() {
    state = initial();
    emit();
  },
};
