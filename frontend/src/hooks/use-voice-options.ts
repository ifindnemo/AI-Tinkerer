"use client";
import {useCallback, useEffect, useRef, useState} from "react";

export type VoiceOption = {id: string; name: string; gender: string | null; type: string | null; category: string | null};
export type VoiceOptions = {
  voices: VoiceOption[];
  selected: string;
  /** The voice used when the person has not chosen one. */
  fallback: string;
  /** The backend has Blaze credentials and a voice for this language. */
  enabled: boolean;
};

type Answer = {selected?: string; default?: string; enabled?: boolean; voices?: VoiceOption[]};
const read = (data: Answer): VoiceOptions | null =>
  Array.isArray(data.voices) && typeof data.selected === "string" ? {voices: data.voices, selected: data.selected, fallback: data.default ?? data.selected, enabled: data.enabled === true} : null;

/** The Blaze voices for one language and the one in use; `choose(null)` goes back to the default.
 * `failed` means the backend could not be reached or refused the choice. `preview` plays a few seconds of a voice. */
export function useVoiceOptions(lang: "vi" | "en") {
  const [state, setState] = useState<{lang: string; options: VoiceOptions | null; failed: boolean}>({lang, options: null, failed: false});
  const audio = useRef<HTMLAudioElement | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/voice/voices?lang=${lang}`, {cache: "no-store"})
      .then(response => (response.ok ? (response.json() as Promise<Answer>) : Promise.reject(new Error("unavailable"))))
      .then(data => {
        const options = read(data);
        if (!cancelled) setState({lang, options, failed: options === null});
      })
      .catch(() => {
        if (!cancelled) setState({lang, options: null, failed: true});
      });
    return () => {
      cancelled = true;
      audio.current?.pause();
    };
  }, [lang]);

  const choose = useCallback(async (voiceId: string | null) => {
    try {
      const response = await fetch("/api/voice/voices", {method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify({lang, voiceId})});
      const options = response.ok ? read((await response.json()) as Answer) : null;
      setState(current => ({lang, options: options ?? current.options, failed: options === null}));
    } catch {
      setState(current => ({...current, failed: true}));
    }
  }, [lang]);

  const preview = useCallback((voiceId: string) => {
    audio.current?.pause();
    const clip = new Audio(`/api/voice/voices/${encodeURIComponent(voiceId)}/preview?lang=${lang}`);
    audio.current = clip;
    setPreviewing(voiceId);
    const done = () => setPreviewing(current => (current === voiceId ? null : current));
    clip.addEventListener("ended", done);
    clip.addEventListener("pause", done);
    clip.addEventListener("error", done);
    clip.play().catch(done);
  }, [lang]);

  // A late answer for the other language must not show here.
  const options = state.lang === lang ? state.options : null;
  return {options, failed: state.lang === lang && state.failed, choose, preview, previewing};
}
