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

// For text generated outside React (mock analysis, incident timeline, adapter errors).
// The language is fixed when the text is created; stored history keeps its original language.
export const tr = (vi: string, en: string) => (langStore.get() === "en" ? en : vi);
export const pick = (text: Text, lang: Lang) => text[lang];
export const localeOf = (lang: Lang) => (lang === "en" ? "en-GB" : "vi-VN");
export const timeOf = (iso: string, lang: Lang) =>
  iso ? new Date(iso).toLocaleTimeString(localeOf(lang), {hour: "2-digit", minute: "2-digit", second: "2-digit"}) : "—";
