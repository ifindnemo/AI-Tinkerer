// Talk state machine. Side effects (microphone, fetch, audio) stay in the hook.

export type ConversationPhase = "idle" | "listening" | "transcribing" | "thinking" | "speaking" | "followup" | "error";

export type ConversationState = {
  phase: ConversationPhase;
  generation: number;
  /** True after this utterance has already been claimed by the timer or the Send button. */
  sendLatch: boolean;
  error: string | null;
};

export const idleConversation = (): ConversationState => ({phase: "idle", generation: 0, sendLatch: false, error: null});

export type ConversationEvent =
  | {type: "start"}
  | {type: "interrupt"}
  | {type: "endpoint"}
  | {type: "manual-send"}
  | {type: "no-speech"}
  | {type: "answer"; textOnly: boolean}
  | {type: "audio-start"}
  | {type: "audio-end"}
  | {type: "tts-failed"}
  | {type: "follow-timeout"}
  | {type: "end"}
  | {type: "scene"}
  | {type: "fail"; message: string};

export function reduceConversation(state: ConversationState, event: ConversationEvent): ConversationState {
  switch (event.type) {
    case "start":
    case "interrupt":
      return {phase: "listening", generation: state.generation + 1, sendLatch: false, error: null};
    case "endpoint":
    case "manual-send":
      if (state.sendLatch || (state.phase !== "listening" && state.phase !== "followup")) return state;
      return {...state, phase: "transcribing", sendLatch: true};
    case "no-speech":
      return state.phase === "listening" || state.phase === "followup" || state.phase === "transcribing"
        ? {phase: "idle", generation: state.generation + 1, sendLatch: false, error: null}
        : state;
    case "answer":
      if (state.phase !== "transcribing" && state.phase !== "thinking") return state;
      return {...state, phase: event.textOnly ? "followup" : "thinking", error: null};
    case "audio-start":
      return state.phase === "thinking" || state.phase === "transcribing" ? {...state, phase: "speaking"} : state;
    case "audio-end":
    case "tts-failed":
      return state.phase === "speaking" || state.phase === "thinking" ? {...state, phase: "followup"} : state;
    case "follow-timeout":
      return state.phase === "followup" || state.phase === "listening" ? {phase: "idle", generation: state.generation + 1, sendLatch: false, error: null} : state;
    case "end":
    case "scene":
      return {phase: "idle", generation: state.generation + 1, sendLatch: false, error: null};
    case "fail":
      return {...state, phase: "error", error: event.message, sendLatch: true};
    default:
      return state;
  }
}

/** Timer and Send share one latch. The first call sends; the second does not. */
export function claimSend(state: ConversationState): {state: ConversationState; send: boolean} {
  const next = reduceConversation(state, {type: "manual-send"});
  return {state: next, send: next !== state && next.sendLatch};
}

export type CapturedRequest = {session: string; lang: string; generation: number};

export function requestStillValid(captured: CapturedRequest, current: CapturedRequest): boolean {
  return captured.session === current.session && captured.lang === current.lang && captured.generation === current.generation;
}
