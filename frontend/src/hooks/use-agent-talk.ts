"use client";
import {useEffect, useRef, useState} from "react";
import {useAgentLang, useLang} from "@/hooks/use-preferences";
import {audioFocus, type TurnIds} from "@/lib/agent/audio-focus";
import {replyToAudioMs} from "@/lib/agent/timing";
import {monotonicNow} from "@/lib/agent/clock";
import {claimSend, idleConversation, reduceConversation, requestStillValid, type CapturedRequest, type ConversationState} from "@/lib/agent/conversation";
import {demoHold} from "@/lib/demo-hold";
import {createVad, listenLimit, vadStep, UTTERANCE_MAX_MS, VAD_FOLLOW_MS, VAD_START_WAIT_MS} from "@/lib/agent/vad";
import {commandAfterWake, commandIsQuestion, looksLikeEcho, parseControl, playbackControl} from "@/lib/agent/wake";

export type TalkPhase = ConversationState["phase"] | "armed";

export type TalkTurn = {
  id: string;
  role: "user" | "neuron" | "separator";
  boundary?: "scene" | "language";
  archived?: boolean;
  text: string;
  pending?: boolean;
  interrupted?: boolean;
};

export type TalkMetrics = {
  turn: number;
  clickToSilenceMs: number | null;
  speechEndToUploadMs: number | null;
  sttMs: number | null;
  llmMs: number | null;
  replyToAudioMs: number | null;
  outcome: "queued" | "spoken" | "text-only" | "cancelled" | "error" | "control";
};

type TalkResponse = {text?: string; reply?: string | null; answer?: {id?: string} | null; spoken?: boolean; stale?: boolean; control?: boolean};
type WakeResult = {isFinal: boolean; 0: {transcript: string}};
type WakeEvent = {results: ArrayLike<WakeResult>; resultIndex?: number};
type WakeRec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: WakeEvent) => void) | null;
  onerror: ((event: {error: string}) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

const AUDIO_WAIT_MS = 12_000;

function recognitionCtor(): (new () => WakeRec) | null {
  if (typeof window === "undefined") return null;
  const host = window as unknown as {SpeechRecognition?: new () => WakeRec; webkitSpeechRecognition?: new () => WakeRec};
  return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null;
}

function rmsOf(buffer: Float32Array): number {
  let sum = 0;
  for (let index = 0; index < buffer.length; index += 1) sum += buffer[index] * buffer[index];
  return Math.sqrt(sum / Math.max(1, buffer.length));
}

/**
 * Multi-turn talk. The Ask button is the reliable path. "Hey neuron" is a browser extra and
 * is suspended as a question source while Neuron's own voice is playing, except for a direct
 * quiet/end command that does not match the line being spoken.
 */
export function useAgentTalk(session: string, options?: {spokenText?: string | null; spokenGroup?: string | null; voiceOn?: boolean; failedGroup?: string | null}) {
  const {resolved: lang} = useAgentLang();
  const {t} = useLang();
  const [machine, setMachine] = useState<ConversationState>(idleConversation);
  const [turns, setTurns] = useState<TalkTurn[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [micLive, setMicLive] = useState(false);
  const [wake, setWake] = useState<"unsupported" | "off" | "listening" | "denied">("off");
  const [wakeEnabled, setWakeEnabled] = useState(false);
  const [interim, setInterim] = useState<string | null>(null);
  const [capture, setCapture] = useState<{echoCancellation?: boolean; noiseSuppression?: boolean; autoGainControl?: boolean} | null>(null);
  const [metrics, setMetrics] = useState<TalkMetrics | null>(null);
  const [textOnly, setTextOnly] = useState(false);
  const machineRef = useRef(machine);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const heardSpeech = useRef(false);
  const intent = useRef<"send" | "discard">("discard");
  const timer = useRef<number | null>(null);
  const vadTimer = useRef<number | null>(null);
  const audioWait = useRef<number | null>(null);
  const follow = useRef<number | null>(null);
  const recognition = useRef<WakeRec | null>(null);
  const heard = useRef("");
  const armed = useRef(false);
  const latched = useRef(false);
  const denied = useRef(false);
  const mounted = useRef(true);
  const sessionRef = useRef(session);
  const langRef = useRef(lang);
  const tRef = useRef(t);
  const voiceOnRef = useRef(options?.voiceOn !== false);
  const spokenRef = useRef(options?.spokenText ?? null);
  const idsRef = useRef<TurnIds | null>(null);
  const capturedRef = useRef<CapturedRequest | null>(null);
  const aborts = useRef(new Set<AbortController>());
  const audioContext = useRef<AudioContext | null>(null);
  const armFollowRef = useRef<(ids: TurnIds, captured: CapturedRequest) => void>(() => {});
  const boundarySerial = useRef(0);
  const pendingReply = useRef<string | null>(null);
  const endedBeforeReply = useRef<string | null>(null);
  const startedPlayback = useRef<string | null>(null);
  const replyShownAt = useRef<number | null>(null);
  const audioStartedAt = useRef<number | null>(null);
  const failedPlayback = useRef<string | null>(null);
  useEffect(() => {
    machineRef.current = machine;
    sessionRef.current = session;
    langRef.current = lang;
    tRef.current = t;
    voiceOnRef.current = options?.voiceOn !== false;
    spokenRef.current = options?.spokenText ?? null;
  });

  const apply = (next: ConversationState) => {
    machineRef.current = next;
    setMachine(next);
  };

  const clearTimer = (slot: {current: number | null}) => {
    if (slot.current !== null) window.clearTimeout(slot.current);
    slot.current = null;
  };

  const stopMeter = () => {
    clearTimer(vadTimer);
    void audioContext.current?.close().catch(() => {});
    audioContext.current = null;
  };

  const releaseStream = () => {
    stopMeter();
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    recorder.current = null;
    setMicLive(false);
  };

  const abortFetches = () => {
    aborts.current.forEach(controller => controller.abort());
    aborts.current.clear();
  };

  const sayNotice = (text: string) => setNotice(text);

  const pushTurn = (turn: TalkTurn) => setTurns(current => [...current.slice(-31), turn]);

  const markInterrupted = () => setTurns(current => current.map(turn => turn.pending ? {...turn, pending: false, interrupted: true} : turn));

  const cancelServer = (ids: TurnIds | null) => {
    if (!ids) return;
    const body = new FormData();
    body.set("sessionId", capturedRef.current?.session ?? sessionRef.current);
    body.set("conversationId", ids.conversationId);
    body.set("generation", String(ids.generation));
    void fetch("/api/voice/talk/cancel", {method: "POST", body}).catch(() => {});
  };

  const listenWake = () => {
    latched.current = false;
    heard.current = "";
    if (!armed.current || !mounted.current) return;
    if (machineRef.current.phase !== "idle" && machineRef.current.phase !== "speaking") return;
    try { recognition.current?.start(); setWake("listening"); } catch { /* already running */ }
  };

  const stopWake = () => {
    latched.current = true;
    setWake(current => current === "unsupported" ? current : "off");
    try { recognition.current?.stop(); } catch { /* not running */ }
  };

  const finishIdle = (message: string | null, newConversation = false, boundary?: "scene" | "language") => {
    clearTimer(timer);
    clearTimer(audioWait);
    clearTimer(follow);
    intent.current = "discard";
    const active = recorder.current;
    if (active && active.state === "recording") active.stop();
    else releaseStream();
    abortFetches();
    cancelServer(idsRef.current);
    const cancelledGeneration = idsRef.current?.generation;
    setMetrics(current => current && current.turn === cancelledGeneration ? {...current, outcome: "cancelled", replyToAudioMs: null} : current);
    idsRef.current = null;
    capturedRef.current = null;
    audioFocus.endTalk(newConversation);
    apply(reduceConversation(machineRef.current, {type: "end"}));
    markInterrupted();
    armed.current = false;
    setWakeEnabled(false);
    latched.current = true;
    stopWake();
    setWake(current => current === "unsupported" ? current : "off");
    if (newConversation) {
      boundarySerial.current += 1;
      const dividerId = `boundary-${boundarySerial.current}`;
      setTurns(current => {
        if (!boundary || !current.some(turn => turn.role !== "separator")) return [];
        const history = current.at(-1)?.role === "separator" ? current.slice(0, -1) : current;
        return [...history.slice(-31).map(turn => ({...turn, archived: true})), {id: dividerId, role: "separator", boundary, text: ""}];
      });
      setInterim(null);
      setTextOnly(false);
      setMetrics(null);
    }
    if (message) sayNotice(message);
  };

  const currentIds = (): CapturedRequest => ({
    session: sessionRef.current,
    lang: langRef.current,
    generation: audioFocus.get().generation,
  });

  const postTalk = async (text: string, ids: TurnIds, captured: CapturedRequest, timing?: {uploadMs: number; sttMs: number}) => {
    setNotice(null);
    const sayNow = tRef.current;
    const userId = `user-${ids.turnId}`;
    pushTurn({id: userId, role: "user", text, pending: false});
    const neuronId = `neuron-${ids.turnId}`;
    pushTurn({id: neuronId, role: "neuron", text: sayNow("Đang trả lời…", "Answering…"), pending: true});
    apply({...machineRef.current, phase: "thinking"});
    audioFocus.setPhase("thinking");
    pendingReply.current = ids.turnId;
    endedBeforeReply.current = null;
    startedPlayback.current = null;
    replyShownAt.current = null;
    audioStartedAt.current = null;
    failedPlayback.current = null;
    const llmStarted = monotonicNow();
    const controller = new AbortController();
    aborts.current.add(controller);
    const body = new FormData();
    body.set("text", text);
    body.set("transcribed", "true");
    body.set("sessionId", captured.session);
    body.set("lang", captured.lang);
    body.set("conversationId", ids.conversationId);
    body.set("turnId", ids.turnId);
    body.set("generation", String(ids.generation));
    try {
      const response = await fetch("/api/voice/talk", {method: "POST", body, signal: controller.signal});
      if (!requestStillValid(captured, currentIds()) || controller.signal.aborted) return;
      const data = response.ok ? await response.json() as TalkResponse : null;
      if (!mounted.current || !requestStillValid(captured, currentIds()) || controller.signal.aborted) return;
      if (!response.ok || !data || data.stale) {
        if (data?.stale) { finishIdle(null); return; }
        finishIdle(null);
        apply(reduceConversation(machineRef.current, {type: "fail", message: "talk"}));
        sayNotice(sayNow("Chưa nhận được câu trả lời. Thử lại.", "No answer came back. Try again."));
        setMetrics({replyToAudioMs: null, turn: ids.generation, clickToSilenceMs: audioFocus.get().silenceMs, speechEndToUploadMs: timing?.uploadMs ?? null, sttMs: timing?.sttMs ?? null, llmMs: monotonicNow() - llmStarted, outcome: "error"});
        return;
      }
      if (data.control || !data.reply) {
        setTurns(current => current.filter(turn => turn.id !== neuronId));
        finishIdle(null);
        return;
      }
      replyShownAt.current = monotonicNow();
      const voiceOn = voiceOnRef.current;
      const queued = data.spoken === true && voiceOn;
      const played = startedPlayback.current === ids.turnId;
      const failed = failedPlayback.current === ids.turnId;
      setTextOnly(!queued || failed);
      setTurns(current => current.map(turn => turn.id === neuronId ? {...turn, text: data.reply ?? "", pending: queued && !played && !failed} : turn));
      const alreadySpeaking = queued && machineRef.current.phase === "speaking";
      if (!alreadySpeaking) {
        apply(reduceConversation({...machineRef.current, phase: "thinking"}, {type: "answer", textOnly: !queued}));
        audioFocus.setPhase(queued ? "thinking" : "followup");
      }
      setMetrics({replyToAudioMs: queued && !failed ? replyToAudioMs(replyShownAt.current, audioStartedAt.current) : null, turn: ids.generation, clickToSilenceMs: audioFocus.get().silenceMs, speechEndToUploadMs: timing?.uploadMs ?? null, sttMs: timing?.sttMs ?? null, llmMs: monotonicNow() - llmStarted, outcome: failed || !queued ? "text-only" : played ? "spoken" : "queued"});
      if (!queued || endedBeforeReply.current === ids.turnId) armFollow(ids, captured);
      else if (!alreadySpeaking) {
        clearTimer(audioWait);
        audioWait.current = window.setTimeout(() => {
          if (!requestStillValid(captured, currentIds())) return;
          setTextOnly(true);
          setMetrics(current => current?.turn === ids.generation ? {...current, outcome: "text-only", replyToAudioMs: null} : current);
          setTurns(current => current.map(turn => turn.id === neuronId ? {...turn, pending: false} : turn));
          sayNotice(sayNow("Chưa đọc được câu trả lời. Chữ vẫn ở đây.", "The answer could not be read aloud. The text is still here."));
          apply(reduceConversation(machineRef.current, {type: "tts-failed"}));
          audioFocus.setPhase("followup");
          armFollow(ids, captured);
        }, AUDIO_WAIT_MS);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (!mounted.current || !requestStillValid(captured, currentIds())) return;
      finishIdle(null);
      apply(reduceConversation(machineRef.current, {type: "fail", message: "talk"}));
      sayNotice(sayNow("Chưa nhận được câu trả lời. Thử lại.", "No answer came back. Try again."));
    } finally {
      if (pendingReply.current === ids.turnId) pendingReply.current = null;
      aborts.current.delete(controller);
    }
  };

  const armFollow = (ids: TurnIds, captured: CapturedRequest) => {
    if (!requestStillValid(captured, currentIds())) return;
    clearTimer(audioWait);
    cancelServer(ids);
    apply({...machineRef.current, phase: "followup", sendLatch: false});
    const next = audioFocus.nextTurn();
    idsRef.current = next;
    const nextCaptured = {...captured, generation: next.generation};
    capturedRef.current = nextCaptured;
    void openMic(next, nextCaptured, VAD_FOLLOW_MS);
  };
  useEffect(() => {
    armFollowRef.current = armFollow;
  });

  const sendTranscript = async (blob: Blob, ids: TurnIds, captured: CapturedRequest, speechEndedAt: number) => {
    if (!requestStillValid(captured, currentIds())) return;
    if (!heardSpeech.current) {
      sayNotice(tRef.current("Không nghe rõ. Nói gần micro rồi bấm lại.", "I could not hear that. Speak closer and tap again."));
      finishIdle(null);
      return;
    }
    const sayNow = tRef.current;
    apply({...machineRef.current, phase: "transcribing", sendLatch: true});
    audioFocus.setPhase("transcribing");
    const clip = new FormData();
    const kind = blob.type.includes("mp4") ? "mp4" : "webm";
    clip.set("file", blob, `speech.${kind}`);
    clip.set("lang", captured.lang);
    const controller = new AbortController();
    aborts.current.add(controller);
    const started = monotonicNow();
    const uploadMs = started - speechEndedAt;
    let text = "";
    try {
      let response = await fetch("/api/voice/transcribe", {method: "POST", body: clip, signal: controller.signal});
      if (response.status === 429 && requestStillValid(captured, currentIds())) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await new Promise<void>(resolve => {
          const timeout = window.setTimeout(resolve, Number.isFinite(retryAfter) ? Math.min(3000, Math.max(250, retryAfter * 1000)) : 1000);
          controller.signal.addEventListener("abort", () => {window.clearTimeout(timeout); resolve();}, {once: true});
        });
        if (!requestStillValid(captured, currentIds()) || controller.signal.aborted) return;
        response = await fetch("/api/voice/transcribe", {method: "POST", body: clip, signal: controller.signal});
      }
      if (!requestStillValid(captured, currentIds()) || controller.signal.aborted) return;
      text = response.ok ? String(((await response.json()) as {text?: string}).text ?? "").trim() : "";
      if (!mounted.current || !requestStillValid(captured, currentIds()) || controller.signal.aborted) return;
      if (!response.ok) {
        finishIdle(null);
        apply(reduceConversation(machineRef.current, {type: "fail", message: "stt"}));
        sayNotice(sayNow("Chưa nhận được câu trả lời. Thử lại.", "No answer came back. Try again."));
        setMetrics({replyToAudioMs: null, turn: ids.generation, clickToSilenceMs: null, speechEndToUploadMs: uploadMs, sttMs: monotonicNow() - started, llmMs: null, outcome: "error"});
        return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (!mounted.current || !requestStillValid(captured, currentIds())) return;
      finishIdle(null);
      apply(reduceConversation(machineRef.current, {type: "fail", message: "stt"}));
      sayNotice(sayNow("Chưa nhận được câu trả lời. Thử lại.", "No answer came back. Try again."));
      return;
    } finally {
      aborts.current.delete(controller);
    }
    if (!requestStillValid(captured, currentIds())) return;
    if (!text) {
      sayNotice(sayNow("Không nghe rõ. Nói gần micro rồi bấm lại.", "I could not hear that. Speak closer and tap again."));
      finishIdle(null);
      return;
    }
    const control = parseControl(text, {inConversation: true});
    if (control) {
      applyControl(control);
      setMetrics({replyToAudioMs: null, turn: ids.generation, clickToSilenceMs: null, speechEndToUploadMs: uploadMs, sttMs: monotonicNow() - started, llmMs: null, outcome: "control"});
      return;
    }
    setInterim(null);
    await postTalk(text, ids, captured, {uploadMs, sttMs: monotonicNow() - started});
  };

  const applyControl = (control: "quiet" | "resume" | "end") => {
    if (control === "quiet") {
      audioFocus.quiet();
      sayNotice(tRef.current("Đã im cảnh báo 60 giây.", "Alerts are quiet for 60 seconds."));
      finishIdle(null);
      return;
    }
    if (control === "resume") {
      finishIdle(null);
      audioFocus.resume();
      sayNotice(tRef.current("Đã bật lại tiếng cảnh báo.", "Alert sound is back."));
      return;
    }
    finishIdle(tRef.current("Đã kết thúc hội thoại.", "Conversation ended."));
  };

  const openMic = async (ids: TurnIds, captured: CapturedRequest, startWait: number) => {
    if (!mounted.current || !requestStillValid(captured, currentIds())) return;
    setNotice(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      sayNotice(tRef.current("Trình duyệt này không thu được tiếng. Gõ câu hỏi ở ô bên dưới.", "This browser cannot record. Type the question below."));
      finishIdle(null);
      apply(reduceConversation(machineRef.current, {type: "fail", message: "mic"}));
      return;
    }
    const generation = captured.generation;
    clearTimer(timer);
    timer.current = window.setTimeout(() => {
      if (requestStillValid(captured, currentIds())) finishIdle(tRef.current("Hết thời gian chờ quyền micro. Hãy thử lại.", "Microphone permission timed out. Please try again."));
    }, 15_000);
    try {
      const live = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true}});
      if (!mounted.current || generation !== audioFocus.get().generation || sessionRef.current !== captured.session) {
        live.getTracks().forEach(track => track.stop());
        return;
      }
      clearTimer(timer);
      const settings = live.getAudioTracks()[0]?.getSettings?.() ?? {};
      setCapture({
        echoCancellation: settings.echoCancellation,
        noiseSuppression: settings.noiseSuppression,
        autoGainControl: settings.autoGainControl,
      });
      stream.current = live;
      setMicLive(true);
      heardSpeech.current = false;
      intent.current = "send";
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(item => MediaRecorder.isTypeSupported(item)) ?? "";
      const rec = new MediaRecorder(live, mime ? {mimeType: mime} : undefined);
      const chunks: Blob[] = [];
      let speechEndedAt = monotonicNow();
      rec.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      rec.onstop = () => {
        const ownsCapture = recorder.current === rec;
        if (!ownsCapture) {live.getTracks().forEach(track => track.stop()); return;}
        clearTimer(timer);
        const blob = new Blob(chunks, {type: rec.mimeType || "audio/webm"});
        const send = intent.current === "send" && mounted.current && requestStillValid(captured, currentIds());
        const spoke = heardSpeech.current;
        const already = machineRef.current.sendLatch && machineRef.current.phase === "transcribing";
        releaseStream();
        if (!send) return;
        if (!spoke) {finishIdle(tRef.current("Không nghe thấy câu nói.", "No speech was heard.")); return;}
        if (!already) {
          const claimed = claimSend(machineRef.current);
          if (!claimed.send) return;
          apply(claimed.state);
        }
        void sendTranscript(blob, ids, captured, speechEndedAt);
      };
      recorder.current = rec;
      rec.start();
      const openedAt = monotonicNow();
      let onsetAt: number | null = null;
      const armDeadline = () => {
        clearTimer(timer);
        const wait = onsetAt === null ? startWait : Math.max(0, UTTERANCE_MAX_MS - (monotonicNow() - onsetAt));
        timer.current = window.setTimeout(() => {
          if (recorder.current !== rec || rec.state !== "recording") return;
          const limit = listenLimit(openedAt, onsetAt, monotonicNow(), startWait);
          if (limit === "open") return;
          if (limit === "no-speech") {
            intent.current = "discard";
            heardSpeech.current = false;
            rec.stop();
            sayNotice(tRef.current("Không nghe thấy câu nói.", "No speech was heard."));
            finishIdle(null);
            return;
          }
          intent.current = "send";
          sayNotice(tRef.current("Đã gửi phần nói trong giới hạn 20 giây.", "Sent the speech captured within the 20 second limit."));
          rec.stop();
        }, wait);
      };
      armDeadline();
      apply({...machineRef.current, phase: "listening", sendLatch: false});
      audioFocus.setPhase("listening");
      const Audio = window.AudioContext ?? (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
      if (Audio) {
        const context = new Audio();
        audioContext.current = context;
        void context.resume().catch(() => {});
        const source = context.createMediaStreamSource(live);
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const bins = new Float32Array(analyser.fftSize);
        let vad = createVad();
        let previous = monotonicNow();
        const tick = () => {
          if (recorder.current !== rec || rec.state !== "recording") return;
          analyser.getFloatTimeDomainData(bins);
          const now = monotonicNow();
          const step = vadStep(vad, rmsOf(bins), now - previous, {startWaitMs: startWait});
          vad = step.state;
          previous = now;
          if (step.state.heard && step.state.silenceMs === 0) speechEndedAt = now;
          if (step.state.heard) {
            heardSpeech.current = true;
            clearTimer(follow);
            if (onsetAt === null) {
              onsetAt = now;
              armDeadline();
            }
          }
          if (step.endpoint === "silence" || step.endpoint === "max") {
            intent.current = "send";
            clearTimer(timer);
            if (rec.state === "recording") rec.stop();
            return;
          }
          if (step.endpoint === "no-speech") {
            intent.current = "discard";
            heardSpeech.current = false;
            if (rec.state === "recording") rec.stop();
            sayNotice(tRef.current("Không nghe thấy câu nói.", "No speech was heard."));
            finishIdle(null);
            return;
          }
          vadTimer.current = window.setTimeout(tick, 80);
        };
        vadTimer.current = window.setTimeout(tick, 80);
      }
    } catch (error) {
      if (!mounted.current || !requestStillValid(captured, currentIds())) return;
      releaseStream();
      const blocked = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "NotFoundError" || error.name === "SecurityError");
      sayNotice(blocked
        ? tRef.current("Chưa có quyền micro. Hãy cho phép micro hoặc gõ câu hỏi.", "Microphone permission was denied. Allow it, or type the question.")
        : tRef.current("Không mở được micro. Bạn vẫn có thể gõ câu hỏi.", "The microphone could not be opened. You can still type the question."));
      finishIdle(null);
      apply(reduceConversation(machineRef.current, {type: "fail", message: "mic"}));
    }
  };

  const begin = (freshConversation: boolean) => {
    stopWake();
    latched.current = true;
    clearTimer(audioWait);
    clearTimer(follow);
    intent.current = "discard";
    if (recorder.current && recorder.current.state === "recording") recorder.current.stop();
    releaseStream();
    abortFetches();
    cancelServer(idsRef.current);
    const ids = freshConversation || !audioFocus.get().conversationId ? audioFocus.beginTalk() : audioFocus.nextTurn();
    idsRef.current = ids;
    const captured = {session: sessionRef.current, lang: langRef.current, generation: ids.generation};
    capturedRef.current = captured;
    apply(reduceConversation(machineRef.current, freshConversation ? {type: "start"} : {type: "interrupt"}));
    markInterrupted();
    void openMic(ids, captured, VAD_START_WAIT_MS);
  };

  const start = () => begin(machineRef.current.phase === "idle" || machineRef.current.phase === "error");
  const interrupt = () => begin(false);
  const send = () => {
    const claimed = claimSend(machineRef.current);
    if (!claimed.send) return;
    apply(claimed.state);
    heardSpeech.current = true; // Explicit Send permits a quiet utterance; automatic VAD still rejects noise.
    intent.current = "send";
    clearTimer(timer);
    if (recorder.current?.state === "recording") recorder.current.stop();
  };
  const end = () => finishIdle(tRef.current("Đã kết thúc hội thoại.", "Conversation ended."));
  const submitText = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    const control = parseControl(text, {inConversation: true, wake: true});
    if (control) {
      applyControl(control);
      return;
    }
    stopWake();
    clearTimer(timer);
    clearTimer(audioWait);
    clearTimer(follow);
    intent.current = "discard";
    if (recorder.current?.state === "recording") recorder.current.stop();
    releaseStream();
    markInterrupted();
    abortFetches();
    cancelServer(idsRef.current);
    const ids = audioFocus.get().conversationId ? audioFocus.nextTurn() : audioFocus.beginTalk();
    idsRef.current = ids;
    const captured = {session: sessionRef.current, lang: langRef.current, generation: ids.generation};
    capturedRef.current = captured;
    apply({phase: "transcribing", generation: ids.generation, sendLatch: true, error: null});
    void postTalk(text, ids, captured);
  };

  const spokenGroup = options?.spokenGroup ?? null;
  const turnKey = audioFocus.get().turnKey;
  const turnMatches = Boolean(spokenGroup && turnKey && spokenGroup === turnKey);
  useEffect(() => {
    const ids = idsRef.current;
    const captured = capturedRef.current;
    if (!ids || !captured || !turnMatches) return;
    if (machineRef.current.phase !== "thinking" && machineRef.current.phase !== "transcribing") return;
    startedPlayback.current = ids.turnId;
    audioStartedAt.current = monotonicNow();
    clearTimer(audioWait);
    apply(reduceConversation(machineRef.current, {type: "audio-start"}));
    audioFocus.setPhase("speaking");
    setMetrics(current => current?.turn === ids.generation ? {...current, outcome: "spoken", replyToAudioMs: replyToAudioMs(replyShownAt.current, audioStartedAt.current)} : current);
    setTurns(current => current.map(turn => turn.pending ? {...turn, pending: false} : turn));
  }, [turnMatches]);

  useEffect(() => {
    const ids = idsRef.current;
    const captured = capturedRef.current;
    if (!ids || !captured || options?.failedGroup !== ids.turnKey) return;
    if (!requestStillValid(captured, currentIds())) return;
    failedPlayback.current = ids.turnId;
    setTextOnly(true);
    setMetrics(current => current?.turn === ids.generation ? {...current, outcome: "text-only", replyToAudioMs: null} : current);
    sayNotice(tRef.current("Không đọc được hết câu trả lời. Nội dung vẫn ở đây.", "The answer could not be fully read aloud. The text is still here."));
    setTurns(current => current.map(turn => turn.pending ? {...turn, pending: false} : turn));
    if (pendingReply.current === ids.turnId) {endedBeforeReply.current = ids.turnId; return;}
    armFollowRef.current(ids, captured);
  }, [options?.failedGroup]);

  const wasSpeaking = useRef(false);
  useEffect(() => {
    const speaking = turnMatches && machineRef.current.phase === "speaking";
    if (wasSpeaking.current && !turnMatches && machineRef.current.phase === "speaking") {
      wasSpeaking.current = false;
      const ids = idsRef.current;
      const captured = capturedRef.current;
      if (!ids || !captured) {
        wasSpeaking.current = speaking;
        return;
      }
      if (pendingReply.current === ids.turnId) {endedBeforeReply.current = ids.turnId; wasSpeaking.current = speaking; return;}
      apply(reduceConversation(machineRef.current, {type: "audio-end"}));
      audioFocus.setPhase("followup");
      if (ids && captured) armFollowRef.current(ids, captured);
    }
    wasSpeaking.current = speaking;
  }, [turnMatches]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      armed.current = false;
      cancelServer(idsRef.current);
      audioFocus.endTalk();
      intent.current = "discard";
      clearTimer(timer);
      clearTimer(audioWait);
      clearTimer(follow);
      if (recorder.current && recorder.current.state === "recording") recorder.current.stop();
      releaseStream();
      abortFetches();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let seen = demoHold.scene();
    return demoHold.subscribe(() => {
      const next = demoHold.scene();
      if (next === seen) return;
      seen = next;
      intent.current = "discard";
      finishIdle(tRef.current("Đã đổi tình huống. Câu trước không còn được dùng.", "The scenario changed. The previous turn was dropped."), true, "scene");
    });
    // finishIdle is stable enough for the page lifetime; it reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const langSeen = useRef(lang);
  useEffect(() => {
    if (langSeen.current === lang) return;
    langSeen.current = lang;
    finishIdle(t("Đã đổi ngôn ngữ agent. Hỏi lại bằng ngôn ngữ mới.", "The agent language changed. Ask again in the new language."), true, "language");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const sessionSeen = useRef(session);
  useEffect(() => {
    if (sessionSeen.current === session) return;
    sessionSeen.current = session;
    finishIdle(t("Đã đổi xe. Câu trước không gửi sang xe mới.", "The vehicle changed. The previous turn was not sent to the new one."), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => audioFocus.subscribe(() => {
    const focus = audioFocus.get();
    if (focus.escalation === escalationSeen.current) return;
    escalationSeen.current = focus.escalation;
    if (machineRef.current.phase === "idle") return;
    finishIdle(null);
    sayNotice(tRef.current("Có cảnh báo mới nghiêm trọng hơn, nên hội thoại tạm dừng.", "A more serious alert interrupted the conversation."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const escalationSeen = useRef(0);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== "hidden") return;
      finishIdle(null);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      const timer = window.setTimeout(() => setWake("unsupported"), 0);
      return () => window.clearTimeout(timer);
    }
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    recognition.current = rec;
    rec.onstart = () => {
      if (!mounted.current || !armed.current || document.visibilityState === "hidden" || (machineRef.current.phase !== "idle" && machineRef.current.phase !== "speaking")) {
        try { rec.abort(); } catch { /* ended while permission was pending */ }
        return;
      }
      setWake("listening");
    };
    rec.onresult = event => {
      if (!armed.current || !mounted.current) return;
      if (latched.current && machineRef.current.phase !== "speaking") return;
      let text = "";
      let final = false;
      for (let index = event.resultIndex ?? 0; index < event.results.length; index += 1) {
        text += `${event.results[index][0].transcript} `;
        final = event.results[index].isFinal;
      }
      heard.current = text;
      const spoken = spokenRef.current;
      if (machineRef.current.phase === "speaking") {
        if (!armed.current) return;
        const control = playbackControl(text, spoken, final);
        if (control) applyControl(control);
        return;
      }
      if (machineRef.current.phase !== "idle") return;
      if (spoken && looksLikeEcho(text, spoken)) return;
      const control = parseControl(text, {inConversation: machineRef.current.phase !== "idle", wake: commandAfterWake(text) !== null});
      if (control && final) {
        latched.current = true;
        stopWake();
        applyControl(control);
        return;
      }
      if (commandAfterWake(text) === null) return;
      if (!final) {
        setInterim(text);
        return;
      }
      setInterim(null);
      const command = commandAfterWake(text) ?? "";
      latched.current = true;
      stopWake();
      if (commandIsQuestion(command)) submitText(command);
      else begin(true);
    };
    rec.onerror = event => {
      if (event.error !== "not-allowed" && event.error !== "service-not-allowed") return;
      armed.current = false;
      setWakeEnabled(false);
      setWake("denied");
      if (denied.current) return;
      denied.current = true;
      sayNotice(tRef.current("Trình duyệt không nghe hey neuron. Nút Hỏi Neuron vẫn dùng được.", "This browser cannot hear hey neuron. Talk to Neuron still works."));
    };
    rec.onend = () => {
      if (!armed.current || latched.current) return;
      if (machineRef.current.phase !== "idle" && machineRef.current.phase !== "speaking") return;
      window.setTimeout(() => {
        if (!armed.current || latched.current || !mounted.current || (machineRef.current.phase !== "idle" && machineRef.current.phase !== "speaking")) return;
        try { rec.start(); } catch { /* a restart raced with a stop */ }
      }, 400);
    };
    return () => {
      rec.onend = null;
      try { rec.abort(); } catch { /* already stopped */ }
      recognition.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => {
      if (wakeEnabled && (machine.phase === "idle" || machine.phase === "speaking")) listenWake();
      else stopWake();
    }, 0);
    return () => window.clearTimeout(task);
    // Recognition follows the local phase; callbacks read the current refs.
  }, [machine.phase, wakeEnabled]);

  const toggleWake = () => {
    if (armed.current) {armed.current = false; setWakeEnabled(false); stopWake(); return;}
    if (!recognition.current || denied.current || machineRef.current.phase !== "idle") return;
    armed.current = true;
    setWakeEnabled(true);
    listenWake();
  };

  const retry = () => {
    const lastQuestion = [...turns].reverse().find(turn => turn.role === "user" && !turn.archived);
    if (lastQuestion) submitText(lastQuestion.text);
  };

  useEffect(() => {
    if (metrics && new URLSearchParams(window.location.search).get("debug") === "1") {
      console.debug("car-neuron talk metrics", JSON.stringify(metrics));
    }
  }, [metrics]);

  const phase: TalkPhase = machine.phase === "idle" && wake === "listening" ? "armed" : machine.phase;
  return {phase, wake, wakeEnabled, turns, notice, error: machine.error, micLive, interim, capture, metrics, textOnly, start, interrupt, send, end, submitText, toggleWake, retry, canRetry: machine.phase === "error" && turns.some(turn => turn.role === "user" && !turn.archived)};
}
