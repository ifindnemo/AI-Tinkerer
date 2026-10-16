// What the on-screen agent (the robot in the corner) knows. Pages publish into this small store;
// the dock reads it. Pure state plus one derivation, so the robot's behaviour is unit-tested.
import type {DriverSeverity} from "../driver/types";
import {needsConfirmation, reportKey, type AgentReport} from "./report";

// Collecting samples is the normal background; it shows as calm, not as busy work.
export type AgentPhase = "offline" | "nodata" | "analyzing" | "ready";
export type AgentPresence = {phase: AgentPhase; severity: DriverSeverity};
// `vehicleAlert`: the car itself is still warning (hot engine), whatever the driver does.
export type CameraPresence = {active: boolean; sound: boolean; severity: DriverSeverity; responded: boolean; vehicleAlert?: boolean};
export type AgentMessage = {id: string; text: string; severity: DriverSeverity};
// `lang`: the language `enabled` is about (each language has its own voice on the backend).
export type VoicePresence = {enabled: boolean | null; blocked: boolean; speaking: AgentMessage | null; lang?: "vi" | "en"};
export type Presence = {
  agent: AgentPresence | null;
  camera: CameraPresence | null;
  /** The latest alert in words, shown in the bubble even when the sound is off. */
  message: AgentMessage | null;
  voice: VoicePresence;
  /** What the bubble shows and until when (epoch ms); a playing clip keeps it open. */
  bubble: {message: AgentMessage; until: number; dismissed: boolean} | null;
  happyUntil: number;
  /** What the car agent just did (tools, nearest garage, a proposed appointment): the robot's popup. */
  report: AgentReport | null;
  /** Until when (epoch ms) a report without a pending question stays open. */
  reportUntil: number;
  /** The report the viewer closed by hand (its key, see `reportKey`). */
  reportClosed: string | null;
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
export const REPORT_MS = 25_000;

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
  if (patch.report !== undefined) {
    const was = before.report, now_ = after.report;
    // A new report opens the popup when something new happened: first alert, a higher level, a new proposal or a saved
    // appointment. The same alert analysed again every 15 s only refreshes its content.
    if (now_ && (!was || RANK[now_.severity] > RANK[was.severity] || (now_.pending && now_.pending.id !== was.pending?.id) || (now_.appointment && now_.appointment.id !== was.appointment?.id))) {
      after.reportUntil = now + REPORT_MS;
      after.reportClosed = null;
    }
  }
  return after;
}

/** Whether the report popup is open at `now`: a question for the driver stays until it is answered or closed. */
export const reportOpen = (p: Presence, now: number) =>
  !!p.report && p.reportClosed !== reportKey(p.report) && (needsConfirmation(p.report) || now < p.reportUntil);

/** The driver still has to confirm something, but the popup was closed: the robot shows a badge. */
export const questionWaiting = (p: Presence, now: number) => needsConfirmation(p.report) && !reportOpen(p, now);

/** Whether the bubble is open at `now`. */
export const bubbleOpen = (p: Presence, now: number) =>
  !!p.bubble && !p.bubble.dismissed && (p.voice.speaking?.id === p.bubble.message.id || now < p.bubble.until);

/** An alert the viewer has not seen: its bubble is gone, but nobody closed it or opened the panel. */
export const unread = (p: Presence, now: number) =>
  !!p.bubble && p.bubble.message.severity !== "normal" && p.bubble.message.id !== p.seenId && !bubbleOpen(p, now);

const initial = (): Presence => ({agent: null, camera: null, message: null, voice: {enabled: null, blocked: false, speaking: null}, bubble: null, report: null, reportUntil: 0, reportClosed: null, happyUntil: 0, seenId: null});

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
  /** The viewer closed the popup. */
  dismissReport() {
    if (!state.report) return;
    state = {...state, reportClosed: reportKey(state.report)};
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
