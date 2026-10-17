"use client";
import {useEffect, useState} from "react";
import {useAgentLang, useDriverVoice, useVoiceRate, useVoiceVolume} from "@/hooks/use-preferences";
import {admitClip, audioFocus, clipKind, decidePlayback} from "@/lib/agent/audio-focus";
import {HURRY_FOR_MS, clipPollDelay, hurryTrigger} from "@/lib/agent/clip-poll";
import {presence} from "@/lib/agent/presence";
import {demoHold} from "@/lib/demo-hold";
import type {Lang} from "@/lib/preferences";

export type VoiceClip = {id: string; seq: number; severity: "warning" | "critical" | "normal"; text: string; created_at: string; group?: string | null; part_index?: number; part_count?: number};
export type VoiceState = {
  /** The backend has a Blaze voice for `enabledLang` (null until the first answer for the current language). */
  enabled: boolean | null;
  enabledLang: Lang;
  speaking: VoiceClip | null;
  last: VoiceClip | null;
  /** The browser refused to play before any click on the page. */
  blocked: boolean;
  failedGroup?: string | null;
};

/** An alert that waited this long behind others is no longer news: it is skipped, not read late. Replay still plays it. */
const STALE_MS = 45_000;

type Update = (change: (current: VoiceState) => VoiceState) => void;

/** One clip at a time, in order. Plain object (not hooks): `playNext` calls itself when a clip ends. */
function createPlayer(update: Update) {
  const m = {queue: [] as VoiceClip[], playing: null as AudioBufferSourceNode | null, loading: null as AbortController | null, current: null as VoiceClip | null, token: 0, context: null as AudioContext | null, gain: null as GainNode | null, last: null as VoiceClip | null, lastGroup: [] as VoiceClip[], stopped: false, on: true, blocked: false, visible: true, volume: 1, rate: 1, replaying: new Set<string>(), driverVoice: false};
  let partWait: ReturnType<typeof setTimeout> | null = null;
  const clearPartWait = () => {if (partWait !== null) clearTimeout(partWait); partWait = null;};
  const admit = (clip: VoiceClip, replay = false) => admitClip(audioFocus.get(), clip, Date.now(), !m.on, replay || m.replaying.has(clip.id));
  const isOn = () => m.on;
  const groupOf = (clip: VoiceClip) => clip.group || `${clip.severity}:${clip.created_at}`;
  function audioContext() {
    if (!m.context || m.context.state === "closed") {
      m.context = new AudioContext();
      m.gain = m.context.createGain();
      m.gain.gain.value = m.volume;
      m.gain.connect(m.context.destination);
    }
    return m.context;
  }
  function unlock() {
    if (!isOn() || m.stopped) return;
    const context = audioContext();
    if (context.state === "running") {
      m.blocked = false;
      update(current => ({...current, blocked: false}));
      playNext();
      return;
    }
    // Safari permits later Web Audio playback after a context resumes during a user gesture.
    void context.resume().then(() => {
      if (context.state !== "running" || m.stopped) return;
      m.blocked = false;
      update(current => ({...current, blocked: false}));
      playNext();
    }).catch(() => { /* the next gesture can retry */ });
  }
  function remember(clips: VoiceClip[]) {
    for (const clip of clips) {
      m.lastGroup = m.lastGroup.length && groupOf(m.lastGroup[0]) === groupOf(clip)
        ? [...m.lastGroup, clip] : [clip];
      m.last = clip;
    }
    if (m.last) update(current => ({...current, last: m.last}));
  }
  function playNext() {
    if (m.playing || m.loading || m.stopped || !m.visible || !isOn() || !m.queue.length) return;
    const context = audioContext();
    if (context.state !== "running") {
      m.blocked = true;
      update(current => ({...current, blocked: true}));
      unlock();
      return;
    }
    const clip = m.queue.shift()!;
    const replay = m.replaying.has(clip.id);
    if (!replay && Date.now() - Date.parse(clip.created_at) > STALE_MS) {playNext(); return;}
    if (admit(clip, replay) === "drop") {playNext(); return;}
    const request = new AbortController();
    const token = ++m.token;
    m.loading = request;
    m.current = clip;
    void (async () => {
      try {
        const response = await fetch(`/api/voice/clips/${encodeURIComponent(clip.id)}/audio`, {signal: request.signal});
        if (!response.ok) throw new Error(`Voice audio HTTP ${response.status}`);
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        if (m.loading !== request || token !== m.token || m.stopped || !isOn()) return;
        if (admit(clip, replay) === "drop") {m.loading = null; m.current = null; playNext(); return;}
        m.loading = null;
        if (!m.visible) {m.queue.unshift(clip); m.current = null; return;}
        clearPartWait();
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = m.rate;
        source.connect(m.gain!);
        source.onended = () => {
          if (m.playing !== source) return;
          m.playing = null;
          m.current = null;
          source.disconnect();
          const more = (clip.part_index ?? 0) + 1 < (clip.part_count ?? 1);
          if (more && clipKind(clip) === "talk") {
            partWait = setTimeout(() => {partWait = null; update(current => ({...current, speaking: null, failedGroup: clip.group}));}, 12_000);
          } else update(current => ({...current, speaking: null}));
          playNext();
        };
        source.start();
        m.playing = source;
        m.last = clip;
        update(current => ({...current, speaking: clip, last: clip, blocked: false}));
      } catch {
        if (m.loading !== request || token !== m.token) return;
        m.loading = null;
        m.current = null;
        clearPartWait();
        update(current => ({...current, speaking: null, failedGroup: clip.group}));
        // A failed download or decode must not hold up the next alert.
        playNext();
      }
    })();
  }
  function cancel() {
    clearPartWait();
    m.token += 1;
    m.loading?.abort();
    m.loading = null;
    m.current = null;
    const playing = m.playing;
    m.playing = null;
    if (playing) {
      try { playing.stop(); playing.disconnect(); } catch { /* already stopped */ }
    }
    update(current => ({...current, speaking: null}));
  }
  function drop(scope: "alerts" | "all") {
    if (scope === "all") {
      m.queue = [];
      cancel();
      return;
    }
    m.queue = m.queue.filter(clip => clipKind(clip) === "talk");
    if (m.current && clipKind(m.current) !== "talk") cancel();
  }
  return {
    start() {
      m.stopped = false;
      m.last = null;
      m.lastGroup = [];
      update(current => ({...current, last: null, speaking: null, blocked: false, failedGroup: null}));
    },
    setVisible(visible: boolean) {
      m.visible = visible;
      if (visible) unlock();
    },
    stop() {
      m.stopped = true;
      m.blocked = false;
      m.queue.length = 0;
      cancel();
    },
    isStopped: () => m.stopped,
    enqueue(clips: VoiceClip[]) {
      // Driver-camera alerts (their group starts with "driver:") are left out while that voice is off: not queued, not replayed.
      clips = m.driverVoice ? clips : clips.filter(clip => !clip.group?.startsWith("driver:"));
      remember(clips);
      const admitted: VoiceClip[] = [];
      for (const clip of clips) {
        const decision = admit(clip);
        if (decision === "drop") continue;
        if (decision === "cut" || clip.severity === "critical") {
          m.queue = m.queue.filter(item => item.severity === "critical" || clipKind(item) === "talk");
          if (m.current && clipKind(m.current) !== "talk" && m.current.severity !== "critical") cancel();
        }
        admitted.push(clip);
      }
      m.queue.push(...admitted);
      playNext();
    },
    drop,
    remember: (clips: VoiceClip[]) => remember(m.driverVoice ? clips : clips.filter(clip => !clip.group?.startsWith("driver:"))),
    setDriverVoice(on: boolean) {
      m.driverVoice = on;
      if (on) return;
      m.queue = m.queue.filter(clip => !clip.group?.startsWith("driver:"));
    },
    /** 0 … 1; also applies to the clip that is playing. */
    setVolume(volume: number) {
      m.volume = Math.min(1, Math.max(0, volume));
      if (m.gain) m.gain.gain.value = m.volume;
    },
    /** 1 … 1.3; also applies to the clip that is playing (Web Audio speeds the pitch up with it). */
    setRate(rate: number) {
      m.rate = Math.min(2, Math.max(0.5, rate));
      if (m.playing) m.playing.playbackRate.value = m.rate;
    },
    /** Muting stops the voice now, not after the sentence. */
    setOn(on: boolean) {
      m.on = on;
      if (!on) {
        m.blocked = false;
        m.queue.length = 0;
        cancel();
        update(current => ({...current, speaking: null, blocked: false}));
      }
    },
    retryBlocked() {
      unlock();
    },
    replay() {
      if (!m.last || !isOn() || decidePlayback(audioFocus.get(), "replay", Date.now(), !m.on) === "drop") return;
      cancel();
      m.queue.length = 0;
      const again = m.lastGroup.length ? m.lastGroup : [m.last];
      m.replaying = new Set(again.map(clip => clip.id));
      m.queue.push(...again);
      unlock();
    },
  };
}

/** Plays the Blaze clips the backend speaks for `session` (the vehicle id): driver alerts in the
 * agent's words and car alerts, in the agent's language (a setting; each language has its own voice).
 * Older clips remain available for replay. Turning `on` off stops the clip that is playing and drops the
 * queue; `replay()` plays the latest clip again. The volume is a setting too. */
export function useVoiceAlerts(session: string, on: boolean): VoiceState & {replay: () => void; lang: Lang} {
  const [state, setState] = useState<VoiceState>({enabled: null, enabledLang: "vi", speaking: null, last: null, blocked: false});
  const [player] = useState(() => createPlayer(setState));
  const {resolved: lang} = useAgentLang();
  const [volume] = useVoiceVolume();
  const [rate] = useVoiceRate();
  const [driverVoice] = useDriverVoice();

  useEffect(() => player.setOn(on), [on, player]);
  useEffect(() => player.setVolume(Number(volume) / 100), [volume, player]);
  useEffect(() => {
    const retry = () => player.retryBlocked();
    document.addEventListener("pointerdown", retry, true);
    document.addEventListener("keydown", retry, true);
    return () => {
      document.removeEventListener("pointerdown", retry, true);
      document.removeEventListener("keydown", retry, true);
    };
  }, [player]);
  useEffect(() => player.setRate(Number(rate) / 100), [rate, player]);
  useEffect(() => player.setDriverVoice(driverVoice), [driverVoice, player]);

  useEffect(() => {
    let after: number | null = null; // null: the first answer only sets the starting point
    const startedAt = Date.now();
    let polling = false;
    player.start();
    player.setVisible(document.visibilityState === "visible");

    const poll = async () => {
      if (polling || player.isStopped()) return;
      polling = true;
      try {
        const response = await fetch(`/api/voice/clips?session=${encodeURIComponent(session)}&lang=${lang}&after=${after ?? 0}`, {cache: "no-store"});
        if (!response.ok) return;
        const data = (await response.json()) as {enabled: boolean; latest: number; clips: VoiceClip[]};
        if (closed || player.isStopped()) return;
        setState(current => (current.enabled === data.enabled && current.enabledLang === lang ? current : {...current, enabled: data.enabled, enabledLang: lang}));
        if (after === null) {
          after = data.latest;
          const fresh = data.clips.filter(clip => Date.parse(clip.created_at) >= startedAt - 1000);
          player.remember(data.clips.filter(clip => Date.parse(clip.created_at) < startedAt - 1000));
          player.enqueue(fresh);
          return;
        }
        // The backend restarted: its clip numbers began again below ours. Start over, or every new clip would be skipped.
        if (data.latest < after) {after = 0; return;}
        for (const clip of data.clips) after = Math.max(after, clip.seq);
        player.enqueue(data.clips);
      } catch { /* the next poll retries */ }
      finally {polling = false;}
    };

    const visibilityChanged = () => {
      player.setVisible(document.visibilityState === "visible");
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", visibilityChanged);
    const unbind = audioFocus.bindVoice(scope => player.drop(scope));
    let scene = demoHold.scene();
    const unscene = demoHold.subscribe(() => {
      const next = demoHold.scene();
      if (next === scene) return;
      scene = next;
      player.drop("all");
    });
    let closed = false;
    // Right after an alert is raised its clip is a couple of seconds away: ask faster for a while.
    let hurryUntil = 0;
    let known = presence.get();
    const unwatch = presence.subscribe(() => {
      const next = presence.get();
      if (hurryTrigger(known, next)) hurryUntil = Date.now() + HURRY_FOR_MS;
      known = next;
    });
    void poll();
    let timer = 0;
    const loop = () => {
      if (closed) return;
      const hidden = document.visibilityState === "hidden";
      const phase = audioFocus.get().phase;
      const live = phase !== "idle" && phase !== "error";
      const wait = clipPollDelay({hidden, live, hurryUntil, now: Date.now()});
      timer = window.setTimeout(() => { void poll().finally(loop); }, wait);
    };
    loop();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibilityChanged);
      unbind();
      unscene();
      unwatch();
      player.stop();
    };
    // Another language is another voice: the poll starts over (and the clip that was playing is cut off).
  }, [session, player, lang]);

  return {...state, enabled: state.enabledLang === lang ? state.enabled : null, lang, replay: player.replay};
}
