"use client";
import {useCallback, useEffect, useSyncExternalStore} from "react";
import {agentLangStore, agentModeStore, driverVoiceStore, langStore, localeOf, timeOf, voiceRateStore, voiceVolumeStore, type Lang, type PreferenceStore} from "@/lib/preferences";

function usePreference<T extends string>(store: PreferenceStore<T>) {
  const fallback = useCallback(() => store.fallback, [store]);
  return useSyncExternalStore(store.subscribe, store.get, fallback);
}

export function useLang() {
  const lang = usePreference(langStore);
  useEffect(() => {document.documentElement.lang = lang;}, [lang]);
  const t = useCallback((vi: string, en: string) => (lang === "en" ? en : vi), [lang]);
  const time = useCallback((iso: string) => timeOf(iso, lang), [lang]);
  return {lang, t, time, locale: localeOf(lang), setLang: langStore.set};
}

export function useAgentMode() {
  return [usePreference(agentModeStore), agentModeStore.set] as const;
}

/** The agent's output language: the setting ("auto" follows the interface) and the language it resolves to. */
export function useAgentLang() {
  const setting = usePreference(agentLangStore);
  const ui = usePreference(langStore);
  const resolved: Lang = setting === "auto" ? ui : setting;
  return {setting, resolved, setAgentLang: agentLangStore.set};
}

export function useDriverVoice() {
  return [usePreference(driverVoiceStore) === "on", (on: boolean) => driverVoiceStore.set(on ? "on" : "off")] as const;
}

export function useVoiceRate() {
  return [usePreference(voiceRateStore), voiceRateStore.set] as const;
}

export function useVoiceVolume() {
  return [usePreference(voiceVolumeStore), voiceVolumeStore.set] as const;
}
