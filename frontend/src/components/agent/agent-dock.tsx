"use client";
import {useCallback, useEffect, useRef, useState, useSyncExternalStore} from "react";
import {ArrowUpRight, RotateCcw, Volume2, VolumeX, X} from "lucide-react";
import {useLang} from "@/hooks/use-preferences";
import {useVoiceAlerts} from "@/hooks/use-voice-alerts";
import {bubbleOpen, presence, robotState, unread, type RobotState} from "@/lib/agent/presence";
import {RobotHead} from "@/vendor/robot-heads";
import styles from "./agent-dock.module.css";

const STATE_LABEL: Record<RobotState, {vi: string; en: string}> = {
  idle: {vi: "Đang theo dõi", en: "Watching"},
  thinking: {vi: "Đang phân tích", en: "Analysing"},
  listening: {vi: "Camera tài xế đang bật", en: "Driver camera on"},
  speaking: {vi: "Đang nói", en: "Speaking"},
  happy: {vi: "Mọi thứ ổn", en: "All good"},
  error: {vi: "Mất kết nối backend", en: "Backend unreachable"},
  sleeping: {vi: "Chờ dữ liệu xe", en: "Waiting for vehicle data"},
};

const PHONE = "(max-width: 640px)";
const subscribePhone = (change: () => void) => {
  const query = matchMedia(PHONE);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
};

/** True when the browser draws without a GPU (software WebGL such as SwiftShader or llvmpipe). There a
 * robot redrawn every frame next to the 3D car starves the page (measured: navigation from 0.2 s to
 * 10 s), so it then holds each state's still face and only animates while it speaks. */
let softwareRendering: boolean | null = null;
function isSoftwareRendering() {
  if (softwareRendering !== null) return softwareRendering;
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    const renderer = gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    softwareRendering = !gl || /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    softwareRendering = true;
  }
  return softwareRendering;
}
const noSubscribe = () => () => {};

/** Reads a colour token so the canvas robot follows the theme (Studio, Midnight, Blueprint). */
function token(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

const DOZE_MS = 90_000; // no input and nothing happening for this long: the robot naps
const MUTE_KEY = "car-neuron.agent-dock.v1";

/** The dock's own mute, remembered in this browser only (a per-viewer convenience). */
const muteStore = {
  listeners: new Set<() => void>(),
  read(): boolean {
    try {
      return JSON.parse(localStorage.getItem(MUTE_KEY) ?? "{}").muted === true;
    } catch {
      return false;
    }
  },
  set(muted: boolean) {
    try {
      localStorage.setItem(MUTE_KEY, JSON.stringify({muted}));
    } catch { /* storage may be blocked: the choice still holds for this page */ }
    muteStore.value = muted;
    muteStore.listeners.forEach(listener => listener());
  },
  value: null as boolean | null,
  get: () => (muteStore.value ??= muteStore.read()),
  subscribe(listener: () => void) {
    muteStore.listeners.add(listener);
    return () => {muteStore.listeners.delete(listener);};
  },
};

/**
 * The agent's face in the corner of the garage and driver pages. It mirrors what the page already
 * shows (analysing, the camera, alerts), plays the Blaze clips the backend speaks for `session`, and
 * puts every alert in a bubble, so it is readable with the sound off. A click opens a small panel
 * (last alert, replay, mute, details); unseen alerts leave a badge; with nothing going on it naps.
 * It adds no alert of its own: the horn, cards and banners stay the primary warning.
 */
export default function AgentDock({session, anchor, quietOver}: {session: string; anchor: string; quietOver?: string}) {
  const {t, lang} = useLang();
  const state = useSyncExternalStore(presence.subscribe, presence.get, presence.get);
  const muted = useSyncExternalStore(muteStore.subscribe, muteStore.get, () => false);
  const soundOn = (state.camera?.sound ?? true) && !muted;
  const voice = useVoiceAlerts(session, soundOn);
  const [now, setNow] = useState(0);
  const [lastActivity, setLastActivity] = useState(0);
  const [panel, setPanel] = useState(false);
  const [colors, setColors] = useState({shell: "#1d7552", screen: "#eafff3", trim: "#cdd5ce"});
  const compact = useSyncExternalStore(subscribePhone, () => matchMedia(PHONE).matches, () => false);
  const software = useSyncExternalStore(noSubscribe, isSoftwareRendering, () => false);
  const dockRef = useRef<HTMLElement>(null);
  const robotRef = useRef<HTMLButtonElement>(null);
  const [covered, setCovered] = useState(false);

  // The bubble repeats what a card on the page already shows in full (the garage's Guardian band). While
  // that card is in view the bubble stops covering the page and only speaks to screen readers; the
  // robot, its voice and its panel stay.
  useEffect(() => {
    if (!quietOver || typeof IntersectionObserver === "undefined") return;
    let observer: IntersectionObserver | null = null;
    const attach = () => {
      const element = document.querySelector(quietOver);
      if (!element) return false;
      observer = new IntersectionObserver(([entry]) => setCovered(entry.isIntersecting && entry.intersectionRatio >= 0.45), {threshold: [0, 0.45, 1]});
      observer.observe(element);
      return true;
    };
    let timer: ReturnType<typeof setInterval> | null = null;
    if (!attach()) timer = setInterval(() => {if (attach() && timer) clearInterval(timer);}, 500);
    return () => {
      if (timer) clearInterval(timer);
      observer?.disconnect();
    };
  }, [quietOver]);

  // Publish the voice state (the garage camera card shows it); a playing clip becomes the bubble.
  const clip = voice.speaking;
  useEffect(() => {
    presence.set({voice: {enabled: voice.enabled, blocked: voice.blocked, speaking: clip ? {id: clip.id, text: clip.text, severity: clip.severity} : null}});
  }, [voice.enabled, voice.blocked, clip]);

  // One coarse clock for timeouts, the short smile and the nap.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, []);

  // Any input counts as "someone is here"; coming back from a nap earns a smile.
  useEffect(() => {
    let last = Date.now();
    setTimeout(() => setLastActivity(last), 0);
    const seen = () => {
      const at = Date.now();
      if (at - last < 1000) return;
      if (at - last > DOZE_MS) presence.cheer();
      last = at;
      setLastActivity(at);
    };
    const events = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"] as const;
    events.forEach(name => window.addEventListener(name, seen, {passive: true}));
    return () => events.forEach(name => window.removeEventListener(name, seen));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setColors({
      shell: token("--accent", "#1d7552"),
      screen: "#eafff3",
      trim: token("--border-strong", "#cdd5ce"),
    }), 0);
    return () => clearTimeout(timer);
  }, []);

  const closePanel = useCallback((focusRobot: boolean) => {
    setPanel(false);
    if (focusRobot) robotRef.current?.focus();
  }, []);

  // Escape closes the panel or the bubble; a click elsewhere closes the panel.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (panel) closePanel(true);
      else if (bubbleOpen(presence.get(), Date.now())) presence.dismiss();
    };
    const onDown = (event: PointerEvent) => {
      if (panel && dockRef.current && !dockRef.current.contains(event.target as Node)) closePanel(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [panel, closePanel]);

  const awake = robotState(state, now < state.happyUntil);
  const visible = !panel && bubbleOpen(state, now) ? state.bubble!.message : null;
  const napping = awake === "idle" && !visible && !panel && lastActivity > 0 && now - lastActivity > DOZE_MS;
  const face: RobotState = napping ? "sleeping" : awake;
  const badge = !panel && unread(state, now);
  // A smile after the driver's confirmation must not read "all good" while the car is still warning.
  const stillWarning = face === "happy" && !!state.camera?.responded && !!state.camera.vehicleAlert;
  const label = napping ? t("Đang chợp mắt · di chuột để đánh thức", "Napping · move the pointer to wake it")
    : stillWarning ? t("Đã ghi nhận phản hồi · xe vẫn đang cảnh báo", "Response recorded · the car is still warning")
    : lang === "en" ? STATE_LABEL[face].en : STATE_LABEL[face].vi;
  const tag = (severity: string | undefined) => severity === "critical" ? t("Nguy hiểm", "Critical") : severity === "warning" ? t("Cảnh báo", "Warning") : "Car Neuron";
  const last = state.bubble?.message ?? null;
  const voiceNote = voice.enabled === false ? t("Giọng nói chưa cấu hình trên backend", "Voice is not configured on the backend")
    : !soundOn ? t("Đang tắt tiếng", "Muted")
    : voice.blocked ? t("Trình duyệt chặn âm thanh: bấm vào trang một lần", "The browser blocked audio: click the page once")
    : t("Giọng nói bật", "Voice on");

  const openDetails = () => {
    setPanel(false);
    const target = document.getElementById(anchor);
    target?.scrollIntoView({behavior: "smooth", block: "start"});
    target?.focus({preventScroll: true});
  };
  const togglePanel = () => {
    if (!panel) presence.markSeen();
    setPanel(!panel);
  };

  return (
    <aside ref={dockRef} className={styles.dock} aria-label="Car Neuron Agent" data-testid="agent-dock" data-state={face} data-animated={!(software && face !== "speaking")}>
      {panel && (
        <div className={styles.panel} role="dialog" aria-label={t("Bảng nhanh của agent", "Agent quick panel")} data-testid="agent-panel">
          <div className={styles.panelHead}>
            <div>
              <b>Car Neuron Agent</b>
              <span className={styles.panelStatus} data-state={face}>{label}</span>
            </div>
            <button type="button" className={styles.iconButton} onClick={() => closePanel(true)} aria-label={t("Đóng", "Close")}><X size={15} /></button>
          </div>
          <div className={styles.panelMessage} data-severity={last?.severity ?? "normal"}>
            <span className={styles.bubbleTag}>{last ? tag(last.severity) : t("Chưa có cảnh báo", "No alerts yet")}</span>
            <p>{last ? last.text : t("Agent sẽ nói và hiện ở đây khi xe hoặc tài xế cần chú ý.", "The agent speaks and shows here when the car or the driver needs attention.")}</p>
          </div>
          <div className={styles.panelActions}>
            <button type="button" className={styles.action} onClick={voice.replay} disabled={!voice.last || !soundOn} data-testid="agent-replay"><RotateCcw size={15} />{t("Nghe lại", "Replay")}</button>
            <button type="button" className={styles.action} onClick={() => muteStore.set(!muted)} aria-pressed={muted} data-testid="agent-mute">{muted ? <VolumeX size={15} /> : <Volume2 size={15} />}{muted ? t("Bật tiếng", "Unmute") : t("Tắt tiếng", "Mute")}</button>
            <button type="button" className={`${styles.action} ${styles.primaryAction}`} onClick={openDetails}>{t("Xem chi tiết", "Details")} <ArrowUpRight size={15} /></button>
          </div>
          <p className={styles.panelFoot}>{voiceNote}</p>
        </div>
      )}
      {visible && (
        <div className={`${styles.bubble} ${covered ? styles.bubbleQuiet : ""}`} data-quiet={covered} data-severity={visible.severity} role="status" aria-live={visible.severity === "critical" ? "assertive" : "polite"} data-testid="agent-bubble">
          <div className={styles.bubbleHead}>
            <span className={styles.bubbleTag}>{tag(visible.severity)}</span>
            {state.voice.speaking?.id === visible.id && <span className={styles.bubbleLive}>{t("đang đọc", "speaking")}</span>}
            <button type="button" className={styles.bubbleClose} onClick={presence.dismiss} aria-label={t("Đóng thông báo", "Dismiss")}><X size={14} /></button>
          </div>
          <p key={visible.id}>{visible.text}</p>
          <button type="button" className={styles.bubbleLink} onClick={openDetails}>{t("Xem chi tiết", "Details")} <ArrowUpRight size={14} /></button>
        </div>
      )}
      <div className={styles.robotWrap}>
        <button
          ref={robotRef}
          type="button"
          className={styles.robot}
          onClick={togglePanel}
          aria-label={`Car Neuron Agent: ${label}${badge ? t(" · có cảnh báo chưa xem", " · unseen alert") : ""}`}
          aria-expanded={panel}
          aria-haspopup="dialog"
          title={label}
          data-testid="agent-robot"
        >
          <RobotHead shape="circle" state={face} size={compact ? 76 : 112} floorShadow={false} color={colors.shell} trimColor={colors.trim} screenColor={colors.screen} paused={software && face !== "speaking"} aria-hidden="true" />
        </button>
        {badge && <span className={styles.badge} data-severity={state.bubble?.message.severity} data-testid="agent-badge" aria-hidden="true" />}
      </div>
      <span className={styles.status} aria-hidden="true">{label}</span>
    </aside>
  );
}
