"use client";
import {useEffect, useMemo, useState} from "react";
import AgentDock from "../agent/agent-dock";
import {presence} from "@/lib/agent/presence";
import {Camera, Check, ShieldCheck, Wifi, WifiOff, ArrowUpRight} from "lucide-react";
import {useDriverMonitor} from "@/hooks/use-driver-monitor";
import {useDemoReset} from "@/hooks/use-demo-reset";
import {useLang} from "@/hooks/use-preferences";
import {pick} from "@/lib/preferences";
import {SIMULATION_SCENARIOS, type SimulationScenario} from "@/lib/driver/simulation";
import type {AttentionState} from "@/lib/driver/types";
import SiteHeader from "../site/site-header";
import {ConfidenceBar, EyeGauge, HeadGauge} from "./instruments";
import {SEVERITY_LABEL, STATE_HINT, STATE_LABEL} from "./labels";
import DebugLine from "./debug-line";
import {EcuPicker, GuardianBoard} from "./guardian-board";
import {AgentCard} from "./agent-card";
import {canConfirm} from "@/lib/guardian/policy";
import Lens from "./lens";
import styles from "./driver.module.css";

const SCENARIO_LABEL: Record<SimulationScenario, {vi: string; en: string}> = {
  attentive: {vi: "Tập trung", en: "Attentive"},
  drowsy: {vi: "Buồn ngủ", en: "Drowsy"},
  distracted: {vi: "Quay đầu", en: "Looking away"},
  no_face: {vi: "Mất khuôn mặt", en: "Face out of view"},
};

const DEMO_VEHICLE = "bmw-m2";

/** The state word slides: the old one leaves upward while the new one rises from below. */
function StateWord({state}: {state: AttentionState | null}) {
  const {t, lang} = useLang();
  const label = state ? pick(STATE_LABEL[state], lang) : t("Chờ tín hiệu", "Waiting");
  const [words, setWords] = useState({current: label, previous: null as string | null, key: 0});
  useEffect(() => {
    if (label === words.current) return;
    const timer = setTimeout(() => setWords(w => ({current: label, previous: w.current, key: w.key + 1})), 0);
    return () => clearTimeout(timer);
  }, [label, words]);
  useEffect(() => {
    if (!words.previous) return;
    // The outgoing word is only needed while it animates away.
    const timer = setTimeout(() => setWords(w => (w.key === words.key ? {...w, previous: null} : w)), 320);
    return () => clearTimeout(timer);
  }, [words.key, words.previous]);
  return (
    <h1 className={styles.word} aria-live="polite" data-testid="driver-state">
      {words.previous && <span key={`out-${words.key}`} className={styles.wordOut} aria-hidden="true">{words.previous}</span>}
      <span key={`in-${words.key}`} className={styles.wordIn}>{words.current}</span>
    </h1>
  );
}

/** The last three minutes, merged into runs of the same state. */
function Ribbon({history}: {history: [number, AttentionState][]}) {
  const {t} = useLang();
  const runs = useMemo(() => {
    const out: {state: AttentionState; count: number; start: number}[] = [];
    for (const [time, state] of history.slice(-180)) {
      const last = out.at(-1);
      if (last && last.state === state) last.count += 1;
      else out.push({state, count: 1, start: time});
    }
    return out;
  }, [history]);
  const empty = Math.max(0, 180 - runs.reduce((sum, run) => sum + run.count, 0));
  return (
    <div className={styles.ribbon}>
      <div className={styles.kicker}><span>{t("Ba phút gần nhất", "Last three minutes")}</span></div>
      <div className={styles.ribbonTrack} role="img" aria-label={t("Lịch sử trạng thái chú ý", "Attention history")}>
        {empty > 0 && <span className={styles.ribbonSegment} style={{flexGrow: empty}} />}
        {runs.map(run => <span key={run.start} className={styles.ribbonSegment} data-state={run.state} style={{flexGrow: run.count}} />)}
      </div>
      <div className={styles.ribbonScale}><span>−3:00</span><span>{t("bây giờ", "now")}</span></div>
    </div>
  );
}

export default function DriverPage() {
  useDemoReset();
  // The demo car's id: the agent dock plays this vehicle's spoken alerts, as on the garage page.
  const monitorOptions = useMemo(() => ({vehicleId: DEMO_VEHICLE}), []);
  const {t, lang} = useLang();
  const {view, live: channel, videoRef, cameras, selectedCamera, selectCamera, refreshCameras, startWebcam, startSimulation, stop, recalibrate, updateSettings, setEcu, acknowledge, muteHorn, unmuteHorn, testHorn} = useDriverMonitor(monitorOptions);
  const {phase, source, event, reply, store} = view;
  const active = phase === "calibrating" || phase === "running";
  const live: AttentionState | null = active ? event?.state ?? null : null;
  const rank = {normal: 0, warning: 1, critical: 2};
  const local = view.localAssessment;
  const remote = reply?.assessment;
  const useLocal = !remote || view.sendError || (!!local && rank[local.severity] > rank[remote.severity]);
  const assessment = !active ? null : useLocal ? local : remote;
  // The car and the driver together (board, agent, mobile banner) …
  const overall = assessment?.severity ?? "normal";
  const guardian = !active ? null : !useLocal && reply?.guardian ? reply.guardian : view.guardian;
  // … while the camera chip and the lens speak only for the driver (a hot engine must not read as a drowsy driver).
  const severity = guardian ? (guardian.vehicle.level === "critical" ? "critical" : guardian.driver.severity) : overall;
  // Current observation and the retained safety alert are deliberately shown separately.
  // Once the driver has confirmed, the Guardian board states the response instead.
  const held = !!live && assessment?.state === "drowsy" && severity !== "normal" && live !== "drowsy" && !guardian?.driver.responded;
  const state: AttentionState | null = live;
  // What the agent dock shows: the camera, the backend link, and each new alert step in words.
  const responded = !!guardian?.driver.responded;
  const vehicleAlert = !!guardian && guardian.vehicle.level !== "normal";
  const sound = store.settings.sound;
  useEffect(() => {
    presence.set({
      camera: {active, sound: sound && !view.hornMuted, severity: active ? severity : "normal", responded, vehicleAlert},
      agent: active ? {phase: view.sendError ? "offline" : "ready", severity: overall} : null,
    });
  }, [active, sound, view.hornMuted, severity, responded, vehicleAlert, view.sendError, overall]);
  useEffect(() => () => presence.reset(), []);
  const alertText = active && overall !== "normal" ? assessment?.summary : null;
  const alertKey = `${guardian?.driver.alertSince ?? guardian?.action ?? ""}:${overall}`;
  useEffect(() => {
    if (alertText) presence.say({id: `driver:${alertKey}`, text: alertText, severity: overall});
    // One message per alert step; rewording of the same step does not re-open the bubble.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertKey, !!alertText]);

  const errorText: Record<string, string> = {
    insecure: t("Trình duyệt chỉ cho dùng camera trên HTTPS hoặc localhost. Hãy mở trang qua localhost hoặc đường dẫn HTTPS.", "Browsers only allow the camera on HTTPS or localhost. Open the page through localhost or an HTTPS link."),
    unsupported: t("Trình duyệt này không hỗ trợ camera.", "This browser does not support the camera."),
    denied: t("Quyền dùng camera bị từ chối. Bật lại quyền camera cho trang này trong cài đặt trình duyệt.", "Camera permission was denied. Allow the camera for this page in the browser settings."),
    no_camera: t("Không tìm thấy camera đã chọn. Cắm lại camera hoặc chọn thiết bị khác bên dưới khung hình.", "The selected camera was not found. Reconnect it or choose another device below the preview."),
    disconnected: t("Camera đã mất kết nối. Phiên theo dõi đã dừng; hãy cắm lại hoặc chọn camera khác rồi bật lại.", "The camera disconnected. Monitoring has stopped; reconnect it or choose another camera and start again."),
    busy: t("Camera đang được ứng dụng khác dùng.", "Another app is using the camera."),
    model: t("Không tải được mô hình nhận diện khuôn mặt.", "The face model could not be loaded."),
    other: t("Chưa mở được camera.", "The camera could not be started."),
  };

  return (
    <div className={styles.page} data-state={state ?? "idle"} data-severity={severity} data-overall={overall}>
      <SiteHeader current="driver" />

      <main>
        <div className={styles.sessionBar}>
          <div><span className={styles.kicker}>{t("CAMERA / TÀI XẾ", "CAMERA / DRIVER")}</span><p>{t("Thêm một góc nhìn. An tâm hơn trên đường.", "Another perspective. A more mindful journey.")}</p></div>
          <div className={styles.sessionStatus} data-testid="driver-connection" data-status={view.sendError ? "offline" : reply ? "connected" : "waiting"}>
            {view.sendError ? <WifiOff size={15}/> : <Wifi size={15}/>}
            <span>{!active ? t("Sẵn sàng bắt đầu", "Ready to begin") : view.sendError ? t("Ngoại tuyến · cảnh báo cục bộ", "Offline · local alerts") : reply ? t("Đã kết nối backend", "Backend connected") : t("Đang kết nối…", "Connecting…")}</span>
          </div>
        </div>
        <section className={styles.stage}>
          <div className={styles.lensColumn}>
          <Lens
            view={view}
            live={channel}
            videoRef={videoRef}
            severity={severity}
            shownState={state}
            onToggleVideo={() => updateSettings({showVideo: !store.settings.showVideo})}
            onToggleSound={() => updateSettings({sound: !store.settings.sound})}
            onRecalibrate={recalibrate}
            onStop={stop}
          />
          <div className={styles.sourceBar}>
            <div><b>{source === "simulated" ? t("Phiên mô phỏng", "Simulation session") : source === "webcam" && active ? t("Camera của bạn", "Your camera") : t("Chưa bật camera", "Camera is off")}</b><span>{source === "simulated" ? t("Quan sát thử · không sử dụng camera của bạn", "Try the experience · your camera stays off") : t("Video xử lý tại máy · không lưu hình ảnh", "Video stays on this device · never recorded")}</span></div>
            {source === "simulated" && <button type="button" className={styles.sourceAction} onClick={() => void startWebcam()}><Camera size={15}/>{t("Dùng camera", "Use camera")}</button>}
            {!active && phase !== "starting" && <button type="button" className={`${styles.sourceAction} ${styles.mobileStart}`} onClick={() => void startWebcam()}><Camera size={15}/>{t("Bật camera", "Turn on camera")}</button>}
          </div>
          <div className={styles.cameraPicker}>
            <label htmlFor="driver-camera">{t("Nguồn camera", "Camera source")}</label>
            <div className={styles.cameraChoices}>
              <select id="driver-camera" data-testid="camera-select" value={selectedCamera} disabled={phase === "starting"} onChange={change => selectCamera(change.target.value)} aria-describedby="camera-source-hint">
                <option value="">{t("Camera mặc định", "Default camera")}</option>
                {selectedCamera && !cameras.some(camera => camera.deviceId === selectedCamera) && <option value={selectedCamera}>{t("Camera đã chọn · chưa kết nối", "Selected camera · unavailable")}</option>}
                {cameras.map((camera, index) => <option key={camera.deviceId} value={camera.deviceId}>{camera.label || `${t("Camera", "Camera")} ${index + 1}`}</option>)}
              </select>
              <button type="button" className={styles.sourceAction} onClick={() => void refreshCameras()} disabled={phase === "starting"}>{t("Tìm lại", "Refresh")}</button>
            </div>
            <p id="camera-source-hint">{active && source === "webcam" ? t("Chuyển camera sẽ bắt đầu phiên mới và hiệu chỉnh lại. Chỉ chuyển khi xe đã dừng an toàn.", "Switching cameras starts a new session and calibration. Switch only when safely parked.") : t("Cắm camera USB rồi chọn thiết bị. Tên camera sẽ hiện sau khi bạn cấp quyền.", "Connect a USB camera and select it. Camera names appear after you grant permission.")}</p>
          </div>
          <div className={styles.strip} aria-label={t("Mô phỏng", "Simulation")}>
            <span className={styles.stripLabel}>{t("Thử các tình huống", "Explore the scenarios")}<small>{t("Dữ liệu mô phỏng", "Simulated data")}</small></span>
            <div className={styles.scenarios}>
              {SIMULATION_SCENARIOS.map(scenario => (
                <button key={scenario} type="button" className={styles.scenario} aria-pressed={source === "simulated" && view.scenario === scenario} onClick={() => startSimulation(scenario)} data-testid={`sim-${scenario}`}>
                  {pick(SCENARIO_LABEL[scenario], lang)}
                </button>
              ))}
            </div>
          </div>
          <EcuPicker value={store.settings.ecu} onChange={setEcu} />
          <details className={styles.setupGuide}><summary>{t("Đặt camera thế nào cho tốt?", "How should I position the camera?")}</summary><ol><li>{t("Đặt camera ngang tầm mắt, khuôn mặt nằm trọn trong khung.", "Place the camera at eye level with your whole face in view.")}</li><li>{t("Ánh sáng chiếu từ phía trước; tránh ngược sáng.", "Light your face from the front; avoid backlighting.")}</li><li>{t("Giữ mắt mở và nhìn thẳng để hiệu chỉnh. Có thể hiệu chỉnh lại bất cứ lúc nào.", "Keep your eyes open and face forward to calibrate. Recalibrate whenever needed.")}</li></ol></details>
          </div>

          {active ? (
            <div className={styles.readout}>
              <div>
                <div className={styles.kicker}>
                  <span>{t("Quan sát hiện tại", "Current observation")}</span>
                  <span className={styles.severity} data-severity={severity} data-testid="driver-severity">{severity === "normal" && (!state || ["uncertain", "no_face"].includes(state)) ? t("Chưa đủ tín hiệu", "Signal unavailable") : pick(SEVERITY_LABEL[severity], lang)}</span>
                </div>
                <StateWord state={phase === "calibrating" ? null : state} />
                <p key={state ?? phase} className={styles.summary}>
                  {phase === "calibrating"
                    ? t("Tạm ngừng đánh giá để hiệu chỉnh. Khi xe đã dừng an toàn, giữ đầu thẳng và mắt mở trong vài giây.", "Assessment pauses during calibration. Once safely parked, face forward with your eyes open for a few seconds.")
                    : state === "attentive" && event?.eyes.closed ? t("Đang quan sát; thời gian nhắm mắt chưa vượt ngưỡng cảnh báo.", "Observing; eye closure is below the alert threshold.") : state ? pick(STATE_HINT[state], lang) : ""}
                </p>
                {view.calibration.failed && phase === "running" && (
                  <p className={styles.fineprint}>{t("Chưa hiệu chỉnh được; đang dùng ngưỡng mặc định.", "Calibration did not complete; using default thresholds.")}</p>
                )}
              </div>
              {held && <div className={styles.notice} role="status" data-testid="driver-held"><ShieldCheck size={18}/><p>{t("Quan sát đã thay đổi; cảnh báo trước đó vẫn được giữ tối đa 60 giây sau lần nhắm mắt kéo dài. Đây chưa phải xác nhận đã tỉnh táo.", "The observation has changed; the earlier alert stays active for up to 60 seconds after a prolonged closure. This does not confirm recovery.")}</p></div>}
              {view.sendError && <div className={styles.notice} role="status"><WifiOff size={18}/><p>{t("Backend chưa phản hồi. Nhận diện, cảnh báo và âm báo trên thiết bị vẫn hoạt động; hệ thống sẽ tự kết nối lại.", "Backend unavailable. On-device detection, alerts and sound remain active; reconnection is automatic.")}</p></div>}
              <GuardianBoard
                guardian={guardian}
                assessment={assessment}
                maintenance={reply?.guardian?.maintenance ?? null}
                canConfirm={canConfirm(event)}
                onConfirm={acknowledge}
                sound={store.settings.sound}
                hornMuted={view.hornMuted}
                onMute={muteHorn}
                onUnmute={unmuteHorn}
                onTest={testHorn}
                now={event ? Date.parse(event.capturedAt) : 0}
              />
              <AgentCard assessment={assessment} offline={view.sendError} />
              <div className={styles.instruments}>
                <EyeGauge live={channel} event={event} />
                <HeadGauge live={channel} event={event} />
              </div>
              <ConfidenceBar value={event ? event.confidence : null} />
              <Ribbon history={view.history} />
              <details className={styles.outbox}>
                <summary>
                  <span>{t("Dữ liệu gửi đi", "What is sent")}</span>
                  <span><b data-testid="sent-count">{view.sentEvents}</b> {t("sự kiện · 0 khung hình", "events · 0 frames")}</span>
                </summary>
                <pre data-testid="outbox-json">{event ? JSON.stringify(event, null, 2) : "—"}</pre>
              </details>
              <DebugLine live={channel} />
            </div>
          ) : (
            <div className={styles.intro}>
              <span className={styles.kicker}>{t("Giám sát chú ý của tài xế", "Driver attention")}</span>
              <h1 className={styles.headline}>
                <span className={styles.line}><span>{t("Tập trung phía trước.", "Stay focused ahead.")}</span></span>
                <span className={styles.line}><span>{t("Để cảnh báo đến kịp lúc.", "Let alerts arrive in time.")}</span></span>
              </h1>
              <p className={styles.lede}>
                {t("Camera bổ sung trạng thái người lái cho Car Neuron. Theo dõi thời gian nhắm mắt và hướng đầu, cảnh báo khi cần chú ý — ngay trên thiết bị của bạn.", "Your camera adds driver context to Car Neuron. Track eye closure and head direction, with attention alerts right on your device.")}
              </p>
              <dl className={styles.spec}>
                <div><dt><Check size={14}/>{t("Riêng tư", "Private")}</dt><dd>{t("Video không rời khỏi trình duyệt", "Video never leaves your browser")}</dd></div>
                <div><dt><Check size={14}/>{t("Tức thời", "Immediate")}</dt><dd>{t("Cảnh báo tại máy, không chờ agent", "On-device alerts, without waiting for the agent")}</dd></div>
                <div><dt><Check size={14}/>{t("Chủ động", "In control")}</dt><dd>{t("Ẩn video, tắt âm hoặc dừng bất cứ lúc nào", "Hide video, mute or stop whenever you want")}</dd></div>
              </dl>
              {phase === "error" && view.error && (
                <div className={styles.error} role="alert" data-testid="driver-error">
                  <b>{t("Chưa mở được camera", "Camera not started")}</b>
                  <span>{errorText[view.error]}</span>
                </div>
              )}
              <div className={styles.actions}>
                <button type="button" className={styles.primary} onClick={() => void startWebcam()} disabled={phase === "starting"} data-testid="start-camera">
                  <Camera size={18} />{phase === "starting" ? t("Đang mở camera…", "Opening the camera…") : t("Bật camera", "Turn on the camera")}
                </button>
                <button type="button" className={styles.secondary} onClick={() => startSimulation("attentive")} data-testid="start-simulation">
                  {t("Xem mô phỏng", "Watch a simulation")} <ArrowUpRight size={16}/>
                </button>
              </div>
              <p className={styles.fineprint}>
                {t("Bấm Bật camera nghĩa là bạn đồng ý cho trang này dùng camera trong phiên này. Có thể dừng bất cứ lúc nào.", "Turning on the camera means you allow this page to use it for this session. You can stop at any time.")}
              </p>
            </div>
          )}
        </section>

      </main>

      {assessment && overall !== "normal" && <aside className={styles.mobileAlert} data-severity={overall} data-testid="driver-mobile-alert" aria-label={t("Cảnh báo tài xế", "Driver alert")}>
        <a href="#driver-agent"><div><b>{pick(SEVERITY_LABEL[overall], lang)}</b><span>{assessment.recommendations[0] ?? assessment.summary}</span></div><span className={styles.mobileAlertLink}>{t("Hướng dẫn", "Advice")} <ArrowUpRight size={16}/></span></a>
      </aside>}

      <AgentDock session={DEMO_VEHICLE} anchor="driver-agent" quietOver="[data-testid=guardian-board]" />

      <footer className={styles.footer}>
        {t("Prototype. Không điều khiển xe, không gọi cứu hộ và chưa được chứng nhận an toàn ô tô.", "Prototype. It does not control the vehicle, call emergency services, or claim automotive safety certification.")}
      </footer>
    </div>
  );
}
