"use client";
import {useCallback, useEffect, useRef, useState, useSyncExternalStore} from "react";
import {ArrowUpRight, Mic, Pause, Play, RotateCcw, Square, Volume2, VolumeX, X} from "lucide-react";
import {useAgentTalk} from "@/hooks/use-agent-talk";
import {useLang} from "@/hooks/use-preferences";
import {useVoiceAlerts} from "@/hooks/use-voice-alerts";
import {audioFocus, formatQuiet} from "@/lib/agent/audio-focus";
import {demoHold} from "@/lib/demo-hold";
import {provisionalReport} from "@/lib/agent/report";
import {muteStore} from "@/lib/agent/mute";
import {bubbleOpen, presence, questionWaiting, reportOpen, robotState, unread, type RobotState} from "@/lib/agent/presence";
import {RobotHead} from "@/vendor/robot-heads";
import AgentReportCard from "./agent-report-card";
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

/**
 * The agent's face in the corner of the garage and driver pages. It mirrors what the page already
 * shows (analysing, the camera, alerts), plays the Blaze clips the backend speaks for `session`, and
 * puts every alert in a bubble, so it is readable with the sound off. A click opens a small panel
 * (last alert, replay, mute, details); unseen alerts leave a badge; with nothing going on it naps.
 * It adds no alert of its own: the horn, cards and banners stay the primary warning.
 */
export default function AgentDock({session, anchor, quietOver, quietRatio = 0.45, allowPause = false}: {session: string; anchor: string; quietOver?: string; quietRatio?: number; allowPause?: boolean}) {
  const {t, lang} = useLang();
  const state = useSyncExternalStore(presence.subscribe, presence.get, presence.get);
  const muted = useSyncExternalStore(muteStore.subscribe, muteStore.get, () => false);
  const soundOn = !muted;
  const voice = useVoiceAlerts(session, soundOn);
  const talk = useAgentTalk(session, {spokenText: voice.speaking?.text ?? null, spokenGroup: voice.speaking?.group ?? null, voiceOn: soundOn, failedGroup: voice.failedGroup});
  const focus = useSyncExternalStore(audioFocus.subscribe, audioFocus.get, audioFocus.get);
  const paused = useSyncExternalStore(demoHold.subscribe, () => demoHold.isPaused(), () => false);
  const logRef = useRef<HTMLOListElement>(null);
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
    let observed: Element | null = null;
    // The card can be unmounted and mounted again (camera stopped and started): look for it every half second.
    const watch = () => {
      const element = document.querySelector(quietOver);
      if (element === observed) return;
      observer?.disconnect();
      observed = element;
      if (!element) {
        setCovered(false);
        return;
      }
      observer = new IntersectionObserver(([entry]) => setCovered(entry.isIntersecting && entry.intersectionRatio >= quietRatio), {threshold: [0, quietRatio, 1]});
      observer.observe(element);
    };
    watch();
    const timer = setInterval(watch, 500);
    return () => {
      clearInterval(timer);
      observer?.disconnect();
    };
  }, [quietOver, quietRatio]);

  // Publish the voice state (the garage camera card shows it); a playing clip becomes the bubble.
  const clip = voice.speaking;
  useEffect(() => {
    presence.set({voice: {enabled: voice.enabled, blocked: voice.blocked, lang: voice.lang, speaking: clip ? {id: clip.id, text: clip.text, severity: clip.severity, car: !!clip.group && !clip.group.startsWith("driver:")} : null}});
  }, [voice.enabled, voice.blocked, voice.lang, clip]);

  // The rules' first line arrives seconds before the agent's report: show it in the popup right away
  // (also with the sound off). Only when it says more than the popup already does.
  const latest = voice.last;
  useEffect(() => {
    if (!latest?.group?.endsWith(":fast") || latest.severity === "normal") return;
    if (Date.now() - Date.parse(latest.created_at) > 60_000) return; // an old clip remembered for Replay, not news
    const current = presence.get().report;
    const rank = {normal: 0, warning: 1, critical: 2} as const;
    if (current && !current.provisional && rank[current.severity] >= rank[latest.severity]) return;
    presence.set({report: provisionalReport({id: latest.id, text: latest.text, severity: latest.severity})});
  }, [latest]);

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
    const el = logRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [talk.turns, talk.interim]);

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
      if (talk.micLive || talk.phase === "listening" || talk.phase === "followup") talk.end();
      if (panel) closePanel(true);
      else if (reportOpen(presence.get(), Date.now())) presence.dismissReport();
      else if (bubbleOpen(presence.get(), Date.now())) presence.dismiss();
    };
    const onDown = (event: PointerEvent) => {
      if (panel && dockRef.current && !dockRef.current.contains(event.target as Node)) {if (talk.phase !== "idle") talk.end(); closePanel(false);}
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [panel, closePanel, talk]);

  const awake = robotState(state, now < state.happyUntil);
  const popup = !panel && reportOpen(state, now) ? state.report : null;
  // The popup carries the car agent's words itself; the bubble stays for anything else (the driver camera).
  const visible = !panel && bubbleOpen(state, now) && !(popup && state.bubble!.message.id.startsWith("car:")) ? state.bubble!.message : null;
  const napping = awake === "idle" && !visible && !popup && !panel && lastActivity > 0 && now - lastActivity > DOZE_MS && talk.phase !== "listening" && talk.phase !== "transcribing" && talk.phase !== "thinking" && talk.phase !== "speaking";
  const face: RobotState = talk.phase === "listening" || talk.phase === "followup" ? "listening" : talk.phase === "transcribing" || talk.phase === "thinking" ? "thinking" : talk.phase === "speaking" ? "speaking" : napping ? "sleeping" : awake;
  const badge = !panel && (unread(state, now) || questionWaiting(state, now));
  // A smile after the driver's confirmation must not read "all good" while the car is still warning.
  const stillWarning = face === "happy" && !!state.camera?.responded && !!state.camera.vehicleAlert;
  const label = talk.phase === "listening" ? t("Đang nghe · bấm để gửi", "Listening · tap to send")
    : talk.phase === "transcribing" ? t("Đang nhận chữ", "Transcribing")
    : talk.phase === "thinking" ? t("Đang trả lời", "Answering")
    : talk.phase === "speaking" ? t("Đang nói · bấm để ngắt", "Speaking · tap to interrupt")
    : talk.phase === "followup" ? t("Hỏi tiếp trong vài giây", "Ask a follow-up")
    : talk.phase === "error" ? t("Chưa trả lời được · thử lại", "No answer · try again")
    : napping ? t("Đang chợp mắt · di chuột để đánh thức", "Napping · move the pointer to wake it")
    : stillWarning ? t("Đã ghi nhận phản hồi · xe vẫn đang cảnh báo", "Response recorded · the car is still warning")
    : talk.phase === "armed" && (face === "idle" || face === "sleeping") ? t("Nói hey neuron để hỏi", "Say hey neuron to ask")
    : lang === "en" ? STATE_LABEL[face].en : STATE_LABEL[face].vi;
  const quietLeft = focus.quietUntil === null ? 0 : focus.quietUntil - now;
  const quietOn = quietLeft > 0;
  const ask = () => {
    setPanel(true);
    if (talk.phase === "listening") talk.send();
    else if (talk.phase === "speaking" || talk.phase === "thinking" || talk.phase === "transcribing" || talk.phase === "followup") talk.interrupt();
    else talk.start();
  };
  const tag = (severity: string | undefined) => severity === "critical" ? t("Nguy hiểm", "Critical") : severity === "warning" ? t("Cảnh báo", "Warning") : "Car Neuron";
  const last = state.bubble?.message ?? null;
  const voiceNote = voice.enabled === false ? (voice.lang === "en" ? t("Giọng tiếng Anh chưa cấu hình trên backend", "The English voice is not configured on the backend") : t("Giọng nói chưa cấu hình trên backend", "Voice is not configured on the backend"))
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
    <aside ref={dockRef} className={`${styles.dock} ${quietOver ? styles.dockTight : ""}`} aria-label="Car Neuron Agent" data-testid="agent-dock" data-state={face} data-animated={!(software && face !== "speaking")}>
      {panel && (
        <div className={styles.panel} role="dialog" aria-label={t("Bảng nhanh của agent", "Agent quick panel")} data-testid="agent-panel">
          <div className={styles.panelHead}>
            <div>
              <b>Car Neuron Agent</b>
              <span className={styles.panelStatus} data-state={face}>{label}</span>
            </div>
            <button type="button" className={styles.iconButton} onClick={() => {if (talk.phase !== "idle") talk.end(); closePanel(true);}} aria-label={t("Đóng", "Close")}><X size={15} /></button>
          </div>
          {!(state.report && last?.id.startsWith("car:")) && (
            <div className={styles.panelMessage} data-severity={last?.severity ?? "normal"}>
              <span className={styles.bubbleTag}>{last ? tag(last.severity) : t("Chưa có cảnh báo", "No alerts yet")}</span>
              <p>{last ? last.text : t("Agent sẽ nói và hiện ở đây khi xe hoặc tài xế cần chú ý.", "The agent speaks and shows here when the car or the driver needs attention.")}</p>
            </div>
          )}
          {state.report && <AgentReportCard report={state.report} t={t} lang={lang} />}
          <div className={styles.panelActions}>
            {quietOn ? (
              <button type="button" className={styles.action} onClick={() => audioFocus.resume(now)}><Play size={15} />{t("Bật lại", "Resume")} {formatQuiet(quietLeft)}</button>
            ) : (
              <button type="button" className={styles.action} onClick={() => audioFocus.quiet(now)} title={t("Chỉ tắt tiếng cảnh báo 60 giây. Mức nguy hiểm trên màn hình không đổi.", "Silences alerts for 60 seconds. The on-screen severity stays.")}><VolumeX size={15} />{t("Tạm im lặng 60s", "Quiet for 60s")}</button>
            )}
            <button type="button" className={styles.action} onClick={ask} aria-pressed={talk.phase === "listening"} data-testid="agent-talk-panel" data-talk-manual=""><Mic size={15} />{talk.phase === "listening" ? t("Gửi", "Send") : talk.phase === "speaking" ? t("Ngắt lời và hỏi", "Interrupt and ask") : t("Hỏi Neuron", "Talk to Neuron")}</button>
            {talk.phase !== "idle" && talk.phase !== "armed" && <button type="button" className={styles.action} onClick={talk.end} data-testid="talk-end"><Square size={15} />{t("Kết thúc", "End")}</button>}
            <button type="button" className={styles.action} onClick={voice.replay} disabled={!voice.last || !soundOn} data-testid="agent-replay"><RotateCcw size={15} />{t("Nghe lại", "Replay")}</button>
            <button type="button" className={styles.action} onClick={() => muteStore.set(!muted)} aria-pressed={muted} data-testid="agent-mute">{muted ? <VolumeX size={15} /> : <Volume2 size={15} />}{muted ? t("Bật tiếng", "Unmute") : t("Tắt tiếng", "Mute")}</button>
            <button type="button" className={`${styles.action} ${styles.primaryAction}`} onClick={openDetails}>{t("Xem chi tiết", "Details")} <ArrowUpRight size={15} /></button>
          </div>
          {(talk.turns.length > 0 || talk.interim) && (
            <ol ref={logRef} className={styles.log} data-testid="talk-log">
              {talk.turns.map(turn => turn.role === "separator" ? (
                <li key={turn.id} role="separator" data-testid="talk-divider" aria-label={turn.boundary === "language" ? t("Ngôn ngữ đã đổi", "Language changed") : t("Tình huống mới", "New scenario")}>
                  {turn.boundary === "language" ? t("Ngôn ngữ đã đổi", "Language changed") : t("Tình huống mới", "New scenario")}
                </li>
              ) : (
                <li key={turn.id} data-role={turn.role} data-archived={turn.archived ? "true" : undefined} aria-busy={turn.pending === true} data-interrupted={turn.interrupted ? "true" : undefined}>
                  <span>{turn.role === "user" ? t("Bạn", "You") : "Neuron"}</span>
                  <p>{turn.text}</p>
                </li>
              ))}
              {talk.interim && <li data-role="interim"><span>{t("Đang nghe", "Hearing")}</span><p>{talk.interim}</p></li>}
            </ol>
          )}
          <form className={styles.typed} onSubmit={event => { event.preventDefault(); const field = event.currentTarget.elements.namedItem("question"); const value = field instanceof HTMLInputElement ? field.value : ""; talk.submitText(value); if (field instanceof HTMLInputElement) field.value = ""; }}>
            <input name="question" data-testid="talk-text" aria-label={t("Gõ câu hỏi", "Type a question")} placeholder={t("Gõ câu hỏi", "Type a question")} />
            <button type="submit" data-testid="talk-send">{t("Gửi", "Send")}</button>
          </form>
          {talk.canRetry && <button type="button" className={styles.action} onClick={talk.retry} data-testid="talk-retry">{t("Thử lại câu hỏi", "Retry question")}</button>}
          {talk.wake !== "unsupported" && <button type="button" className={styles.action} onClick={talk.toggleWake} aria-pressed={talk.wakeEnabled} title={t("Dịch vụ nhận giọng nói của trình duyệt có thể nhận âm thanh. Khi đang đọc, chỉ lệnh Hey Neuron mới ngắt tiếng. Kết thúc sẽ tắt chế độ này.", "Your browser speech service may receive audio. During playback, use an explicit Hey Neuron command to interrupt. End switches this mode off.")} data-testid="talk-wake">{talk.wakeEnabled ? t("Tắt Hey Neuron", "Disable Hey Neuron") : t("Bật Hey Neuron", "Enable Hey Neuron")}</button>}
          <p className={styles.panelFoot} data-testid="talk-status">{talk.notice ?? label}. {voiceNote}{talk.textOnly ? t(" · chỉ chữ", " · text only") : ""}{talk.micLive ? t(" · micro đang bật", " · microphone on") : ""}{talk.wake === "unsupported" ? t(" · hey neuron không có trên trình duyệt này", " · hey neuron is unavailable in this browser") : talk.wake === "denied" ? t(" · micro wake bị từ chối", " · wake microphone denied") : ""}</p>
        </div>
      )}
      {popup && <AgentReportCard report={popup} t={t} lang={lang} onClose={presence.dismissReport} onDetails={openDetails} speaking={!!state.voice.speaking} />}
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
      {paused && allowPause && (
        <p className={styles.pausedNote} data-testid="demo-paused-note" role="status">
          {t("Demo đang dừng. Số liệu là ảnh chụp lúc ", "Demo is paused. Figures are the snapshot from ")}
          {new Date(demoHold.get().pausedAt ?? now).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit", second: "2-digit"})}
          {t(". Câu trả lời dùng bản đánh giá cuối, không phải số đo sau thời điểm đó.", ". Answers use the last saved assessment, not readings after that moment.")}
        </p>
      )}
      {talk.micLive && <p className={styles.micLive} data-testid="talk-mic">{t("Micro đang bật", "Microphone is on")} <button type="button" onClick={talk.end} data-testid="talk-end-live">{t("Kết thúc", "End")}</button></p>}
      <div className={styles.robotWrap}>
        {quietOn ? (
          <button type="button" className={styles.quiet} onClick={() => audioFocus.resume(now)} data-testid="alert-quiet-resume" aria-label={t(`Bật lại tiếng cảnh báo, còn ${formatQuiet(quietLeft)}`, `Resume alert sound, ${formatQuiet(quietLeft)} left`)}>
            <span data-testid="alert-quiet-remaining">{formatQuiet(quietLeft)}</span>
          </button>
        ) : (
          <button type="button" className={styles.quiet} onClick={() => audioFocus.quiet(now)} data-testid="alert-quiet" aria-label={t("Tạm im lặng 60 giây", "Quiet for 60 seconds")} title={t("Chỉ tắt tiếng cảnh báo 60 giây. Mức nguy hiểm trên màn hình không đổi.", "Silences alerts for 60 seconds. The on-screen severity stays.")}>
            <VolumeX size={14} /><span className={styles.quietLabel}>{t("Im 60s", "Quiet")}</span>
          </button>
        )}
        {allowPause && (paused ? (
          <button type="button" className={styles.pause} onClick={() => demoHold.resume(now)} data-testid="demo-pause-resume" aria-label={t("Tiếp tục demo", "Resume demo")}><Play size={14} /></button>
        ) : (
          <button type="button" className={styles.pause} onClick={() => demoHold.pause(now)} data-testid="demo-pause" aria-label={t("Tạm dừng demo", "Pause demo")}><Pause size={14} /></button>
        ))}
        <button
          type="button"
          className={styles.mic}
          onClick={ask}
          aria-pressed={talk.phase === "listening" || talk.phase === "speaking"}
          aria-label={talk.phase === "listening" ? t("Gửi câu nói", "Send what you said") : talk.phase === "speaking" ? t("Ngắt lời và hỏi", "Interrupt and ask") : t("Hỏi Neuron", "Talk to Neuron")}
          data-phase={talk.phase}
          data-testid="agent-talk"
          data-talk-manual=""
        >
          <Mic size={14} />
        </button>
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
          <RobotHead shape="circle" state={face} size={compact ? 76 : quietOver ? 72 : 112} floorShadow={false} color={colors.shell} trimColor={colors.trim} screenColor={colors.screen} paused={software && face !== "speaking"} aria-hidden="true" />
        </button>
        {badge && <span className={styles.badge} data-severity={state.report && questionWaiting(state, now) ? state.report.severity : state.bubble?.message.severity} data-testid="agent-badge" aria-hidden="true" />}
      </div>
      <span className={styles.status} aria-hidden="true">{label}</span>
    </aside>
  );
}
