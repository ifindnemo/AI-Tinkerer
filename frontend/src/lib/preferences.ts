// Per-browser UI preferences. Server rendering always uses the fallback value;
// the stored value is applied on the client after hydration.
export type Lang = "vi" | "en";
// "device" streams real (or gateway-simulated) OBD data from the backend over SSE.
export type AgentMode = "backend" | "mock" | "device";
export type Text = {vi: string; en: string};

export type PreferenceStore<T extends string> = {
  get(): T;
  set(value: T): void;
  subscribe(listener: () => void): () => void;
  fallback: T;
};

function persistentStore<T extends string>(key: string, fallback: T, allowed: readonly T[]): PreferenceStore<T> {
  let current = fallback;
  let loaded = false;
  const listeners = new Set<() => void>();
  const load = () => {
    if (loaded || typeof window === "undefined") return;
    loaded = true;
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null && (allowed as readonly string[]).includes(stored)) current = stored as T;
    } catch {}
  };
  return {
    fallback,
    get: () => {load(); return current;},
    set: value => {
      load();
      if (value === current) return;
      current = value;
      try {localStorage.setItem(key, value);} catch {}
      listeners.forEach(listener => listener());
    },
    subscribe: listener => {listeners.add(listener); return () => {listeners.delete(listener);};},
  };
}

export const langStore = persistentStore<Lang>("car-neuron.lang", "vi", ["vi", "en"]);
// NEXT_PUBLIC_AGENT_MODE only picks the default; the dashboard can switch at runtime.
export const agentModeStore = persistentStore<AgentMode>(
  "car-neuron.agent-mode",
  process.env.NEXT_PUBLIC_AGENT_MODE === "mock" ? "mock" : "backend",
  ["backend", "mock", "device"],
);

// The language the agent writes and speaks in. "auto" follows the interface language; the page can also pin it
// (for example an English interface with a Vietnamese-speaking driver). It only chooses the wording: levels and
// mandatory steps are the same in both.
export type AgentLang = "auto" | Lang;
export const agentLangStore = persistentStore<AgentLang>("car-neuron.agent-lang", "auto", ["auto", "vi", "en"]);
/** The language the next agent answer is asked for. */
export const resolveAgentLang = (): Lang => {
  const chosen = agentLangStore.get();
  return chosen === "auto" ? langStore.get() : chosen;
};

// Volume of the agent's voice, in percent steps (a text value so it fits the same store).
export const VOICE_VOLUMES = ["20", "40", "60", "80", "100"] as const;
export type VoiceVolume = (typeof VOICE_VOLUMES)[number];
export const voiceVolumeStore = persistentStore<VoiceVolume>("car-neuron.voice-volume", "100", VOICE_VOLUMES);
/** 0.2 … 1, as `HTMLMediaElement.volume` wants it. */
export const voiceGain = () => Number(voiceVolumeStore.get()) / 100;

// For text generated outside React (mock analysis, incident timeline, adapter errors).
// The language is fixed when the text is created; stored history keeps its original language.
export const tr = (vi: string, en: string) => (langStore.get() === "en" ? en : vi);
// The same for text the agent would write (the on-device rules mirror the backend's wording): in the agent's language.
export const trAgent = (vi: string, en: string) => (resolveAgentLang() === "en" ? en : vi);
export const pick = (text: Text, lang: Lang) => text[lang];
export const localeOf = (lang: Lang) => (lang === "en" ? "en-GB" : "vi-VN");
export const timeOf = (iso: string, lang: Lang) =>
  iso ? new Date(iso).toLocaleTimeString(localeOf(lang), {hour: "2-digit", minute: "2-digit", second: "2-digit"}) : "—";
