"use client";
import {useCallback, useEffect, useSyncExternalStore} from "react";
import {agentModeStore, langStore, localeOf, timeOf, type PreferenceStore} from "@/lib/preferences";

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
