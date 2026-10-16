"use client";
import {useEffect, useState} from "react";
import {useAgentLang, useVoiceVolume} from "@/hooks/use-preferences";
import type {Lang} from "@/lib/preferences";

export type VoiceClip = {id: string; seq: number; severity: "warning" | "critical" | "normal"; text: string; created_at: string};
export type VoiceState = {
  /** The backend has a Blaze voice for `enabledLang` (null until the first answer for the current language). */
  enabled: boolean | null;
  enabledLang: Lang;
  speaking: VoiceClip | null;
  last: VoiceClip | null;
  /** The browser refused to play before any click on the page. */
  blocked: boolean;
};

const POLL_MS = 2000;

type Update = (change: (current: VoiceState) => VoiceState) => void;

/** One clip at a time, in order. Plain object (not hooks): `playNext` calls itself when a clip ends. */
function createPlayer(update: Update) {
  const m = {queue: [] as VoiceClip[], playing: null as HTMLAudioElement | null, last: null as VoiceClip | null, stopped: false, on: true, volume: 1};
  const isOn = () => m.on;
  function playNext() {
    if (m.playing || m.stopped) return;
    const clip = m.queue.shift();
    if (!clip) return;
    if (!isOn()) {m.queue.length = 0; return;} // muted: drop, never replay later on its own
    const audio = new Audio(`/api/voice/clips/${clip.id}/audio`);
    audio.volume = m.volume;
    m.playing = audio;
    m.last = clip;
    update(current => ({...current, speaking: clip, last: clip, blocked: false}));
    const finish = () => {
      if (m.playing !== audio) return;
      m.playing = null;
      update(current => ({...current, speaking: null}));
      playNext();
    };
    audio.addEventListener("ended", finish);
    audio.addEventListener("error", finish);
    audio.addEventListener("pause", finish);
    audio.play().catch(error => {
      if (error instanceof DOMException && error.name === "NotAllowedError") update(current => ({...current, blocked: true}));
      finish();
    });
  }
  return {
    start() {
      m.stopped = false;
    },
    stop() {
      m.stopped = true;
      m.queue.length = 0;
      m.playing?.pause();
      m.playing = null;
    },
    isStopped: () => m.stopped,
    enqueue(clips: VoiceClip[]) {
      m.queue.push(...clips);
      playNext();
    },
    /** 0 … 1; also applies to the clip that is playing. */
    setVolume(volume: number) {
      m.volume = Math.min(1, Math.max(0, volume));
      if (m.playing) m.playing.volume = m.volume;
    },
    /** Muting stops the voice now, not after the sentence. */
    setOn(on: boolean) {
      m.on = on;
      if (!on) {
        m.queue.length = 0;
        m.playing?.pause();
      }
    },
    replay() {
      if (!m.last || !isOn()) return;
      m.playing?.pause();
      m.queue.unshift(m.last);
      playNext();
    },
  };
}

/** Plays the Blaze clips the backend speaks for `session` (the vehicle id): driver alerts in the
 * agent's words and car alerts, in the agent's language (a setting; each language has its own voice).
 * Clips older than the page are skipped. Turning `on` off stops the clip that is playing and drops the
 * queue; `replay()` plays the latest clip again. The volume is a setting too. */
export function useVoiceAlerts(session: string, on: boolean): VoiceState & {replay: () => void; lang: Lang} {
  const [state, setState] = useState<VoiceState>({enabled: null, enabledLang: "vi", speaking: null, last: null, blocked: false});
  const [player] = useState(() => createPlayer(setState));
  const {resolved: lang} = useAgentLang();
  const [volume] = useVoiceVolume();

  useEffect(() => player.setOn(on), [on, player]);
  useEffect(() => player.setVolume(Number(volume) / 100), [volume, player]);

  useEffect(() => {
    let after: number | null = null; // null: the first answer only sets the starting point
    player.start();

    const poll = async () => {
      if (player.isStopped() || document.visibilityState !== "visible") return;
      try {
        const response = await fetch(`/api/voice/clips?session=${encodeURIComponent(session)}&lang=${lang}&after=${after ?? 0}`, {cache: "no-store"});
        if (!response.ok) return;
        const data = (await response.json()) as {enabled: boolean; latest: number; clips: VoiceClip[]};
        if (player.isStopped()) return;
        setState(current => (current.enabled === data.enabled && current.enabledLang === lang ? current : {...current, enabled: data.enabled, enabledLang: lang}));
        if (after === null) {after = data.latest; return;}
        // The backend restarted: its clip numbers began again below ours. Start over, or every new clip would be skipped.
        if (data.latest < after) {after = 0; return;}
        for (const clip of data.clips) after = Math.max(after, clip.seq);
        player.enqueue(data.clips);
      } catch { /* the next poll retries */ }
    };

    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      clearInterval(timer);
      player.stop();
    };
    // Another language is another voice: the poll starts over (and the clip that was playing is cut off).
  }, [session, player, lang]);

  return {...state, enabled: state.enabledLang === lang ? state.enabled : null, lang, replay: player.replay};
}
