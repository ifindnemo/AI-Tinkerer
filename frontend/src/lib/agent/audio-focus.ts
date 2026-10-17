// One in-tab policy for the horn, alert voice, conversation voice and previews.
// Quiet and the live turn stay in memory: a reload does not reopen the microphone.

export type Severity = "normal" | "warning" | "critical";

export type AlertSnapshot = {
  severity: Severity;
  action: string;
  vehicleLevel: Severity;
  driverSeverity: Severity;
};

export type AudioKind = "horn" | "alert" | "talk" | "preview" | "replay";
export type TalkPhase = "idle" | "listening" | "transcribing" | "thinking" | "speaking" | "followup" | "error";
export type Admit = "play" | "drop" | "cut";

export const QUIET_MS = 60_000;

const SEVERITY_RANK: Record<Severity, number> = {normal: 0, warning: 1, critical: 2};
const ACTION_RANK: Record<string, number> = {
  continue: 0,
  check_camera: 1,
  reduce_load: 2,
  refocus: 2,
  stay_parked: 3,
  stop_nearest_safe: 4,
  stop_engine: 5,
};

export type FocusView = {
  quietUntil: number | null;
  quietSnapshot: AlertSnapshot | null;
  /** Alert identity already announced as an escalation during this hold. */
  escalatedKey: string | null;
  /** Snapshot taken when quiet or a conversation started. Null when nothing is held. */
  floor: AlertSnapshot | null;
  phase: TalkPhase;
  holdAlerts: boolean;
  pendingRemind: boolean;
  remindNonce: number;
  escalation: number;
  escalationAction: string | null;
  generation: number;
  conversationId: string | null;
  turnId: string | null;
  /** `talk:<conversation>:<turn>` of the reply the page is willing to play. */
  turnKey: string | null;
  live: AlertSnapshot | null;
  silenceMs: number | null;
};

export type ClipLike = {id?: string; severity?: string; group?: string | null};

const EMPTY: FocusView = {
  quietUntil: null,
  quietSnapshot: null,
  escalatedKey: null,
  floor: null,
  phase: "idle",
  holdAlerts: false,
  pendingRemind: false,
  remindNonce: 0,
  escalation: 0,
  escalationAction: null,
  generation: 0,
  conversationId: null,
  turnId: null,
  turnKey: null,
  live: null,
  silenceMs: null,
};

let view: FocusView = {...EMPTY};
let published: FocusView = view;
const listeners = new Set<() => void>();
let hornStop: (() => void) | null = null;
let voiceCut: ((scope: "alerts" | "all") => void) | null = null;
let previewStop: (() => void) | null = null;


function emit() {
  published = view;
  listeners.forEach(listener => listener());
}

export function alertIdentity(snapshot: AlertSnapshot): string {
  return `${snapshot.action}|${snapshot.severity}|${snapshot.vehicleLevel}|${snapshot.driverSeverity}`;
}

/** A new danger is a higher severity or a stricter action. Repeating the same pair is not new. */
export function isNewEscalation(previous: AlertSnapshot | null, next: AlertSnapshot): boolean {
  if (!previous) return false;
  if (alertIdentity(previous) === alertIdentity(next)) return false;
  if (next.action === "stop_engine" && previous.action !== "stop_engine") return true;
  if (SEVERITY_RANK[next.severity] > SEVERITY_RANK[previous.severity]) return true;
  if (SEVERITY_RANK[next.vehicleLevel] > SEVERITY_RANK[previous.vehicleLevel] && next.vehicleLevel === "critical") return true;
  return (ACTION_RANK[next.action] ?? 0) > (ACTION_RANK[previous.action] ?? 0) && next.severity !== "normal";
}

export function quietActive(state: FocusView, now: number): boolean {
  return state.quietUntil !== null && now < state.quietUntil;
}

export function alertsSuppressed(state: FocusView, now: number): boolean {
  if (state.holdAlerts && state.phase !== "idle" && state.phase !== "error") return true;
  return quietActive(state, now);
}

export function decidePlayback(state: FocusView, kind: AudioKind, now: number, userMuted: boolean): Admit {
  const listening = state.phase === "listening" || state.phase === "followup";
  const busy = listening || state.phase === "transcribing" || state.phase === "thinking" || state.phase === "speaking";
  if (kind === "preview" || kind === "replay") {
    if (userMuted || busy) return "drop";
    return "play";
  }
  if (kind === "talk") {
    if (userMuted || listening) return "drop";
    return "play";
  }
  if (alertsSuppressed(state, now) || busy) return "drop";
  if (kind === "alert" && userMuted) return "drop";
  return "play";
}

export function clipKind(clip: ClipLike): "talk" | "alert" | "preview" {
  const group = clip.group ?? "";
  if (group.startsWith("talk:")) return "talk";
  if (group.startsWith("preview:")) return "preview";
  return "alert";
}

/** Whether a polled clip may be queued. A talk clip must match the live turn or it is a late reply. */
export function admitClip(state: FocusView, clip: ClipLike, now: number, userMuted: boolean, replay = false): Admit {
  const kind = replay ? "replay" : clipKind(clip);
  if (kind === "talk" && !replay) {
    if (!state.turnKey || clip.group !== state.turnKey) return "drop";
  }
  return decidePlayback(state, kind, now, userMuted);
}

export function formatQuiet(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function token(prefix: string): string {
  const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}${id}`;
}

function cutHorn() {
  try { hornStop?.(); } catch { /* a second stop must not surface */ }
}

function cutVoice(scope: "alerts" | "all") {
  try { voiceCut?.(scope); } catch { /* player already gone */ }
}

function cutPreview() {
  try { previewStop?.(); } catch { /* preview already ended */ }
}

export type TurnIds = {conversationId: string; turnId: string; generation: number; turnKey: string};

function publishTurn(conversationId: string): TurnIds {
  view = {
    ...view,
    generation: view.generation + 1,
    conversationId,
    turnId: token("turn_"),
    turnKey: "",
    holdAlerts: true,
    floor: view.floor ?? view.live,
  };
  view = {...view, turnKey: `talk:${conversationId}:${view.turnId}`};
  return {conversationId, turnId: view.turnId!, generation: view.generation, turnKey: view.turnKey!};
}

export const audioFocus = {
  get: (): FocusView => published,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  noteLive(snapshot: AlertSnapshot) {
    if (view.live && alertIdentity(view.live) === alertIdentity(snapshot)) return;
    view = {...view, live: snapshot};
    emit();
  },
  /** Horn and alert voice stop. Screen state, driver confirmation and the saved mute are untouched. */
  quiet(now = Date.now(), ms = QUIET_MS) {
    const started = typeof performance !== "undefined" ? performance.now() : now;
    view = {
      ...view,
      quietUntil: now + ms,
      quietSnapshot: view.live,
      floor: view.live ?? view.floor,
      escalatedKey: null,
      pendingRemind: false,
    };
    emit();
    cutHorn();
    cutVoice("alerts");
    cutPreview();
    const silenceMs = (typeof performance !== "undefined" ? performance.now() : now) - started;
    view = {...view, silenceMs};
    emit();
  },
  resume(now = Date.now()) {
    if (!quietActive(view, now) && view.quietUntil === null) return;
    view = {...view, quietUntil: null, pendingRemind: true};
    emit();
  },
  /** Wall-clock expiry. One reminder, and none while a conversation still holds the speaker. */
  takeExpiry(now: number): "none" | "remind" | "held" {
    if (view.quietUntil === null || now < view.quietUntil) return "none";
    const held = view.holdAlerts && view.phase !== "idle" && view.phase !== "error";
    view = {...view, quietUntil: null, pendingRemind: held};
    emit();
    if (held) return "held";
    view = {...view, remindNonce: view.remindNonce + 1};
    emit();
    return "remind";
  },
  /**
   * Same alert repeating: drop. A stricter action or a higher severity: interrupt once.
   * The caller plays the horn after `interrupt` and must call `acceptEscalation`.
   */
  considerAlert(alert: AlertSnapshot, now: number): "play" | "drop" | "interrupt" {
    const baseline = view.quietSnapshot ?? (view.holdAlerts ? view.floor : null);
    const suppressed = alertsSuppressed(view, now);
    if (baseline && isNewEscalation(baseline, alert) && (suppressed || view.holdAlerts)) {
      if (view.escalatedKey === alertIdentity(alert)) return "drop";
      return "interrupt";
    }
    if (suppressed) return "drop";
    if (view.holdAlerts && view.phase !== "idle" && view.phase !== "error") return "drop";
    return "play";
  },
  acceptEscalation(alert: AlertSnapshot) {
    view = {
      ...view,
      quietUntil: null,
      quietSnapshot: alert,
      floor: alert,
      escalatedKey: alertIdentity(alert),
      pendingRemind: false,
      escalation: view.escalation + 1,
      escalationAction: alert.action,
      generation: view.generation + 1,
      turnKey: null,
      turnId: null,
      phase: "idle",
      holdAlerts: false,
    };
    emit();
    cutVoice("all");
    cutPreview();
  },
  setPhase(phase: TalkPhase) {
    const active = phase !== "idle" && phase !== "error";
    const remind = !active && view.pendingRemind;
    view = {
      ...view,
      phase,
      holdAlerts: active,
      pendingRemind: active ? view.pendingRemind : false,
      remindNonce: remind ? view.remindNonce + 1 : view.remindNonce,
      turnKey: active ? view.turnKey : null,
      turnId: active ? view.turnId : null,
    };
    emit();
  },
  beginTalk(): TurnIds {
    const conversationId = view.conversationId ?? token("conv_");
    view = {...view, conversationId, floor: view.live, phase: "listening", holdAlerts: true};
    const ids = publishTurn(conversationId);
    emit();
    cutHorn();
    cutVoice("all");
    cutPreview();
    return ids;
  },
  nextTurn(): TurnIds {
    const conversationId = view.conversationId ?? token("conv_");
    view = {...view, conversationId, phase: "listening", holdAlerts: true, floor: view.floor ?? view.live};
    const ids = publishTurn(conversationId);
    emit();
    cutHorn();
    cutVoice("all");
    cutPreview();
    return ids;
  },
  endTalk(newConversation = false) {
    const remind = view.pendingRemind;
    view = {
      ...view,
      phase: "idle",
      holdAlerts: false,
      pendingRemind: false,
      turnKey: null,
      turnId: null,
      conversationId: newConversation ? null : view.conversationId,
      generation: view.generation + 1,
      remindNonce: remind ? view.remindNonce + 1 : view.remindNonce,
    };
    emit();
    cutHorn();
    cutVoice("all");
    cutPreview();
  },
  /** Scenario and language changes drop the live turn without touching another tab's files. */
  endTransient() {
    view = {
      ...view,
      quietUntil: null,
      quietSnapshot: null,
      escalatedKey: null,
      floor: null,
      phase: "idle",
      holdAlerts: false,
      pendingRemind: false,
      turnKey: null,
      turnId: null,
      conversationId: null,
      generation: view.generation + 1,
    };
    emit();
    cutHorn();
    cutVoice("all");
    cutPreview();
  },
  bindHorn(stop: () => void) {
    hornStop = stop;
    return () => { if (hornStop === stop) hornStop = null; };
  },
  bindVoice(cut: (scope: "alerts" | "all") => void) {
    voiceCut = cut;
    return () => { if (voiceCut === cut) voiceCut = null; };
  },
  bindPreview(stop: () => void) {
    previewStop = stop;
    return () => { if (previewStop === stop) previewStop = null; };
  },
  reset() {
    view = {...EMPTY};
    published = view;
    emit();
  },
};
