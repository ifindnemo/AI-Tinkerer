"use client";
import {useEffect, useRef, useState} from "react";
import {useAgentLang, useLang} from "@/hooks/use-preferences";
import {commandAfterWake, commandIsQuestion} from "@/lib/agent/wake";
import {presence} from "@/lib/agent/presence";

export type TalkPhase = "idle" | "armed" | "recording" | "sending";

const MAX_MS = 15_000;
const FOLLOW_MS = 8_000;
const WAKE_GRACE_MS = 900;
const MIN_BYTES = 200;

type TalkResponse = {
  text?: string;
  reply?: string | null;
  answer?: {id?: string} | null;
};

type WakeResult = {isFinal: boolean; 0: {transcript: string}};
type WakeEvent = {results: ArrayLike<WakeResult>};
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

function recognitionCtor(): (new () => WakeRec) | null {
  if (typeof window === "undefined") return null;
  const host = window as unknown as {SpeechRecognition?: new () => WakeRec; webkitSpeechRecognition?: new () => WakeRec};
  return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null;
}

/**
 * Talk to the vehicle agent. A tap records a clip. After any click on the page, the browser
 * also listens for "hey neuron" and then records the question (or sends it when it was spoken
 * in the same breath). The question still goes to `/api/voice/talk`. The wake phrase stays in
 * the browser; this hook never sends camera frames.
 *
 * `suspended` is true while the agent is speaking, so its own voice cannot wake it.
 */
export function useAgentTalk(session: string, suspended = false) {
  const {resolved: lang} = useAgentLang();
  const {t} = useLang();
  const [phase, setPhase] = useState<TalkPhase>("idle");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);
  const grace = useRef<number | null>(null);
  const recognition = useRef<WakeRec | null>(null);
  const heard = useRef("");
  const armed = useRef(false);
  const latched = useRef(false);
  const denied = useRef(false);
  const phaseRef = useRef<TalkPhase>("idle");
  const suspendedRef = useRef(suspended);
  const langRef = useRef(lang);
  const tRef = useRef(t);
  const sessionRef = useRef(session);
  useEffect(() => {
    suspendedRef.current = suspended;
    langRef.current = lang;
    tRef.current = t;
    sessionRef.current = session;
  }, [suspended, lang, t, session]);

  const setTalkPhase = (next: TalkPhase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  const release = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    recorder.current = null;
  };

  const clearGrace = () => {
    if (grace.current !== null) window.clearTimeout(grace.current);
    grace.current = null;
  };

  const say = (id: string, text: string) => presence.say({id, text, severity: "normal"});

  const listenAgain = () => {
    latched.current = false;
    heard.current = "";
    if (!armed.current || suspendedRef.current || phaseRef.current === "recording") {
      if (phaseRef.current !== "recording" && phaseRef.current !== "sending") setTalkPhase("idle");
      return;
    }
    setTalkPhase("armed");
    try { recognition.current?.start(); } catch { /* Chrome throws when it is already running. */ }
  };

  const post = async (body: FormData) => {
    const sayNow = tRef.current;
    setTalkPhase("sending");
    try {
      const response = await fetch("/api/voice/talk", {method: "POST", body});
      const data = response.ok ? await response.json() as TalkResponse : null;
      if (!response.ok || !data) {
        say(`talk-failed-${Date.now()}`, sayNow("Chưa nhận được câu trả lời. Thử lại.", "No answer came back. Try again."));
        return;
      }
      if (!data.text) {
        say(`talk-silent-${Date.now()}`, sayNow("Không nghe rõ. Nói gần micro rồi bấm lại.", "I could not hear that. Speak closer and tap again."));
        return;
      }
      if (data.reply) say(data.answer?.id ?? `talk-${Date.now()}`, data.reply);
    } catch {
      say(`talk-failed-${Date.now()}`, sayNow("Chưa nhận được câu trả lời. Thử lại.", "No answer came back. Try again."));
    } finally {
      listenAgain();
    }
  };

  const sendClip = async (blob: Blob) => {
    if (blob.size < MIN_BYTES) {
      say(`talk-silent-${Date.now()}`, tRef.current("Không nghe rõ. Nói gần micro rồi bấm lại.", "I could not hear that. Speak closer and tap again."));
      listenAgain();
      return;
    }
    // Two steps so the driver sees their question as soon as it is transcribed (a few seconds), not only
    // once the agent has also answered: speech to text first, then the answer for that text.
    const clip = new FormData();
    const kind = blob.type.includes("mp4") ? "mp4" : "webm";
    clip.set("file", blob, `speech.${kind}`);
    clip.set("lang", langRef.current);
    let text = "";
    try {
      const response = await fetch("/api/voice/transcribe", {method: "POST", body: clip});
      text = response.ok ? String(((await response.json()) as {text?: string}).text ?? "").trim() : "";
      if (!response.ok) {
        say(`talk-failed-${Date.now()}`, tRef.current("Chưa nhận được câu trả lời. Thử lại.", "No answer came back. Try again."));
        listenAgain();
        return;
      }
    } catch {
      say(`talk-failed-${Date.now()}`, tRef.current("Chưa nhận được câu trả lời. Thử lại.", "No answer came back. Try again."));
      listenAgain();
      return;
    }
    if (!text) {
      say(`talk-silent-${Date.now()}`, tRef.current("Không nghe rõ. Nói gần micro rồi bấm lại.", "I could not hear that. Speak closer and tap again."));
      listenAgain();
      return;
    }
    say(`talk-heard-${Date.now()}`, `${tRef.current("Bạn hỏi", "You asked")}: “${text}” · ${tRef.current("đang trả lời…", "answering…")}`);
    const body = new FormData();
    body.set("text", text);
    body.set("transcribed", "true");
    body.set("sessionId", sessionRef.current);
    body.set("lang", langRef.current);
    await post(body);
  };

  const sendText = (command: string) => {
    const body = new FormData();
    body.set("text", command);
    body.set("sessionId", sessionRef.current);
    body.set("lang", langRef.current);
    void post(body);
  };

  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const active = recorder.current;
    if (active && active.state === "recording") {
      setTalkPhase("sending");
      active.stop();
      return;
    }
    listenAgain();
  };

  const sendingNow = () => phaseRef.current === "sending";
  const start = async (limit: number) => {
    if (phaseRef.current === "recording" || phaseRef.current === "sending") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      say(`talk-unsupported-${Date.now()}`, tRef.current("Trình duyệt này không thu được tiếng.", "This browser cannot record audio."));
      listenAgain();
      return;
    }
    try {
      const live = await navigator.mediaDevices.getUserMedia({audio: true});
      if (sendingNow()) {
        live.getTracks().forEach(track => track.stop());
        return;
      }
      stream.current = live;
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(item => MediaRecorder.isTypeSupported(item)) ?? "";
      const rec = new MediaRecorder(live, mime ? {mimeType: mime} : undefined);
      chunks.current = [];
      rec.ondataavailable = event => { if (event.data.size) chunks.current.push(event.data); };
      rec.onstop = () => {
        const blob = new Blob(chunks.current, {type: rec.mimeType || "audio/webm"});
        release();
        void sendClip(blob);
      };
      recorder.current = rec;
      rec.start();
      setTalkPhase("recording");
      timer.current = window.setTimeout(() => stop(), limit);
    } catch (error) {
      release();
      const blocked = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "NotFoundError" || error.name === "SecurityError");
      say(
        `talk-mic-${Date.now()}`,
        blocked
          ? tRef.current("Chưa có quyền micro. Hãy cho phép micro rồi bấm lại.", "Microphone permission was denied. Allow it and tap again.")
          : tRef.current("Không mở được micro.", "The microphone could not be opened."),
      );
      listenAgain();
    }
  };

  const openQuestion = () => {
    if (latched.current) return;
    const command = commandAfterWake(heard.current);
    if (command === null) return;
    latched.current = true;
    clearGrace();
    try { recognition.current?.stop(); } catch { /* already stopped */ }
    if (commandIsQuestion(command)) sendText(command);
    else window.setTimeout(() => void start(FOLLOW_MS), 180);
  };

  useEffect(() => () => {
    const active = recorder.current;
    if (active && active.state === "recording") active.stop();
    else stream.current?.getTracks().forEach(track => track.stop());
  }, []);

  useEffect(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    recognition.current = rec;
    rec.onstart = () => {
      if (phaseRef.current === "recording" || phaseRef.current === "sending") return;
      setTalkPhase("armed");
    };
    rec.onresult = event => {
      if (latched.current || suspendedRef.current) return;
      let text = "";
      let final = false;
      for (let index = 0; index < event.results.length; index += 1) {
        text += `${event.results[index][0].transcript} `;
        final = event.results[index].isFinal;
      }
      heard.current = text;
      if (commandAfterWake(text) === null) return;
      clearGrace();
      if (final) openQuestion();
      else grace.current = window.setTimeout(() => openQuestion(), WAKE_GRACE_MS);
    };
    rec.onerror = event => {
      if (event.error !== "not-allowed" && event.error !== "service-not-allowed") return;
      armed.current = false;
      if (denied.current) return;
      denied.current = true;
      say(`talk-wake-${Date.now()}`, tRef.current("Chưa có quyền micro, nên chưa nghe được hey neuron.", "Microphone permission is off, so hey neuron cannot be heard."));
    };
    rec.onend = () => {
      if (!armed.current || latched.current || suspendedRef.current) return;
      if (phaseRef.current === "recording" || phaseRef.current === "sending") return;
      window.setTimeout(() => {
        if (!armed.current || latched.current || suspendedRef.current) return;
        try { rec.start(); } catch { /* a restart raced with a stop */ }
      }, 300);
    };
    const arm = (event: PointerEvent) => {
      if (armed.current) return;
      const target = event.target;
      if (target instanceof Element && target.closest("[data-talk-manual]")) return;
      armed.current = true;
      try { rec.start(); } catch { /* the permission prompt owns the next click */ }
    };
    window.addEventListener("pointerdown", arm);
    return () => {
      window.removeEventListener("pointerdown", arm);
      clearGrace();
      rec.onend = null;
      try { rec.abort(); } catch { /* already stopped */ }
      recognition.current = null;
    };
    // The listener is created once; the handlers read refs, so a new session id is still posted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!suspended) {
      if (armed.current && !latched.current && phaseRef.current !== "recording" && phaseRef.current !== "sending") {
        setTalkPhase("armed");
        try { recognition.current?.start(); } catch { /* already listening */ }
      }
      return;
    }
    clearGrace();
    try { recognition.current?.stop(); } catch { /* not running */ }
    if (phaseRef.current === "armed") setTalkPhase("idle");
  }, [suspended]);

  const toggle = () => {
    if (phaseRef.current === "sending") return;
    if (phaseRef.current === "recording") {
      stop();
      return;
    }
    armed.current = true;
    latched.current = true;
    clearGrace();
    try { recognition.current?.stop(); } catch { /* wake listening was not running */ }
    void start(MAX_MS);
  };

  return {phase, toggle};
}
