"use client";
import {useEffect, useMemo, useRef, useState, useSyncExternalStore} from "react";
import {createPortal} from "react-dom";
import Link from "next/link";
import {ArrowUpRight, AudioLines, Bell, BellOff, Camera, RefreshCw, ScanFace} from "lucide-react";
import {useDriverMonitor} from "@/hooks/use-driver-monitor";
import {presence} from "@/lib/agent/presence";
import {useLang} from "@/hooks/use-preferences";
import {pick} from "@/lib/preferences";
import {canConfirm} from "@/lib/guardian/policy";
import type {Attention, VehicleSnapshot} from "@/lib/guardian/types";
import type {AttentionState} from "@/lib/driver/types";
import ActionBanner from "./action-banner";
import {AgentCard} from "./agent-card";
import {GuardianBoard} from "./guardian-board";
import {SEVERITY_LABEL, STATE_LABEL} from "./labels";
import Lens from "./lens";
import styles from "./driver.module.css";

const attentionOf = (state: AttentionState): Attention =>
  state === "drowsy" || state === "distracted" ? "low_attention" : state === "attentive" ? "attentive" : "unknown";

/** The driver camera inside the blackbox dashboard. It watches on this device and posts only when it
 * raises an alert; the backend then has the agent word a short warning that Blaze speaks, and the
 * agent dock (the robot) plays it and shows it in its bubble. Video stays in the browser.
 *
 * The camera cell of the garage (row 1, right): what to do now (the action banner), the lens, the confirm
 * button and the horn, then the camera settings. The six facts of the Vehicle Guardian (speed, coolant, driver
 * state, eye closure, safety alert, recommendation) belong to the blackbox cell and the agent's words to the agent
 * cell, both in row 2: `factsSlot` and `agentSlot` (DOM nodes there) receive them through portals; without a slot
 * they stay in this card. `onAlertSent` fires once per alert, when the backend has the camera's alert: the garage
 * uses it to send the blackbox batch early so the vehicle agent sees car and driver together. */
export default function GarageCamera({vehicleId, vehicle, agentSlot = null, factsSlot = null, onAlertSent}: {vehicleId: string; vehicle: VehicleSnapshot | null; agentSlot?: HTMLElement | null; factsSlot?: HTMLElement | null; onAlertSent?: () => void}) {
  const {t, lang} = useLang();
  const options = useMemo(() => ({vehicleId, readVehicle: () => vehicle, alertsOnly: true}), [vehicleId, vehicle]);
  const monitor = useDriverMonitor(options);
  const agent = useSyncExternalStore(presence.subscribe, presence.get, presence.get);
  const voice = agent.voice;
  const {view, live, videoRef, cameras, selectedCamera, selectCamera, refreshCameras, startWebcam, startSimulation, stop, recalibrate, updateSettings, acknowledge, muteHorn, unmuteHorn, testHorn} = monitor;
  const {phase, event, store, reply} = view;
  const active = phase === "calibrating" || phase === "running";
  const rank = {normal: 0, warning: 1, critical: 2};
  const local = view.localAssessment;
  const remote = reply?.assessment;
  const useLocal = !remote || view.sendError || (!!local && rank[local.severity] > rank[remote.severity]);
  const guardian = !active ? null : !useLocal && reply?.guardian ? reply.guardian : view.guardian;
  const driverSeverity = guardian?.driver.severity ?? (useLocal ? local : remote)?.severity ?? "normal";
  const state = active ? event?.state ?? null : null;
  const heldState = guardian?.driver.state ?? (useLocal ? local : remote)?.state ?? state;
  const attention = heldState ? attentionOf(heldState) : null;
  const current = !active ? null : useLocal ? local : remote ?? null;
  // The reply is dropped whenever the observation changes (eyes reopen, head turns), but the agent's words
  // for the alert that is still going on should not flip back to the on-device text: keep them per alert.
  const alertId = guardian?.driver.alertSince ?? "";
  const [words, setWords] = useState<{alertId: string; summary: string} | null>(null);
  if (alertId && remote?.engine === "agent" && (words?.alertId !== alertId || words.summary !== remote.summary)) setWords({alertId, summary: remote.summary});
  const shown = current && words && words.alertId === alertId && current.severity !== "normal" && current.engine !== "agent"
    ? {...current, summary: words.summary, engine: "agent" as const, fallbackReason: null}
    : current;
  const sound = store.settings.sound;
  const hornMuted = view.hornMuted;
  const overall = shown?.severity ?? "normal";
  const vehicleAlert = !!guardian && guardian.vehicle.level !== "normal";
  const responded = !!guardian?.driver.responded;

  // Tell the robot what the camera sees; a new alert goes into its bubble at once (the agent's
  // spoken words replace it when the clip arrives). A muted horn silences the robot's voice too.
  useEffect(() => {
    presence.set({camera: {active, sound: sound && !hornMuted, severity: active ? driverSeverity : "normal", responded, vehicleAlert}});
  }, [active, sound, hornMuted, driverSeverity, responded, vehicleAlert]);
  useEffect(() => () => presence.set({camera: null}), []);
  const alertText = active && overall !== "normal" ? shown?.summary : null;
  const alertKey = `${guardian?.driver.alertSince ?? guardian?.action ?? ""}:${overall}`;
  useEffect(() => {
    if (alertText) presence.say({id: `camera:${alertKey}`, text: alertText, severity: overall});
    // One message per alert step; the wording of the same step does not re-open the bubble.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertKey, !!alertText]);

  // Once per alert, after the backend answered (it then holds the driver summary the vehicle agent reads).
  const flushedFor = useRef("");
  useEffect(() => {
    if (!alertId || view.sentEvents === 0 || flushedFor.current === alertId) return;
    flushedFor.current = alertId;
    onAlertSent?.();
  }, [alertId, view.sentEvents, onAlertSent]);

  const sharing = view.sendError
    ? t("Chưa gửi được cảnh báo · còi trên thiết bị vẫn hoạt động", "Alert not sent · on-device sound still works")
    : reply || view.sentEvents > 0 ? t("Đã gửi cảnh báo cho agent", "Alert sent to the agent") : t("Theo dõi trên thiết bị · chỉ gửi khi có cảnh báo", "Watching on this device · posts only on alerts");
  const voiceLine = !sound ? t("Giọng nói tắt (đang tắt âm)", "Voice off (muted)")
    : hornMuted ? t("Còi và giọng nói đã tắt cho cảnh báo này", "Horn and voice muted for this alert")
    : voice.enabled === false ? t("Giọng nói chưa cấu hình trên backend (Blaze)", "Voice not configured on the backend (Blaze)")
    : voice.blocked ? t("Trình duyệt chặn phát âm thanh: bấm vào trang một lần", "The browser blocked audio: click the page once")
    : voice.speaking ? t("Agent đang đọc cảnh báo", "The agent is speaking the alert")
    : voice.enabled ? t("Giọng nói sẵn sàng · agent đọc khi có cảnh báo", "Voice ready · the agent speaks on alerts") : "";

  /** Why the camera cannot judge yet, in words the person in the seat can act on. */
  const cameraHint = !active || phase !== "running" || !event ? null
    : !event.facePresent ? t("Không thấy khuôn mặt: ngồi vào giữa khung hình, bỏ vật che.", "No face in view: sit in the middle of the frame and clear anything covering it.")
    : event.state === "uncertain" ? t("Chưa chắc chắn: ngồi gần camera hơn (khoảng 50–80 cm), bật thêm ánh sáng phía trước. Nếu đeo kính, tránh đèn phản chiếu lên mắt kính.", "Not sure yet: sit closer (about 50–80 cm) and light your face from the front. With glasses, avoid lamps reflecting on the lenses.")
    : null;

  /** Browsers hide camera names (and often USB cameras) until permission is granted: ask once on this click. */
  const findCameras = async () => {
    const labelled = cameras.some(camera => camera.label);
    if (!labelled && !active && navigator.mediaDevices?.getUserMedia) {
      try {
        const probe = await navigator.mediaDevices.getUserMedia({video: true});
        probe.getTracks().forEach(track => track.stop());
      } catch { /* denied or busy: the list stays as the browser allows */ }
    }
    await refreshCameras();
  };

  const errorText: Record<string, string> = {
    insecure: t("Trình duyệt chỉ cho dùng camera trên HTTPS hoặc localhost. Hãy mở trang qua http://localhost hoặc đường dẫn HTTPS.", "Browsers only allow the camera on HTTPS or localhost. Open the page via http://localhost or an HTTPS link."),
    unsupported: t("Trình duyệt này không hỗ trợ camera.", "This browser does not support the camera."),
    denied: t("Quyền camera bị từ chối. Bật lại quyền camera cho trang này trong cài đặt trình duyệt.", "Camera permission was denied. Allow the camera for this page in the browser settings."),
    no_camera: t("Không tìm thấy camera. Cắm camera rồi thử lại.", "No camera found. Connect one and try again."),
    disconnected: t("Camera đã mất kết nối. Cắm lại rồi bật lại.", "The camera disconnected. Reconnect it and start again."),
    busy: t("Camera đang được ứng dụng hoặc tab khác dùng (ví dụ trang /driver). Tắt ở đó rồi thử lại.", "Another app or tab (e.g. /driver) is using the camera. Stop it there and try again."),
    model: t("Không tải được mô hình nhận diện khuôn mặt.", "The face model could not be loaded."),
    other: t("Chưa mở được camera. Thử lại hoặc dùng mô phỏng.", "The camera could not start. Try again or use the simulation."),
  };

  const closedSeconds = ((guardian?.driver.closedMs ?? event?.eyes.closedMs ?? 0) / 1000).toLocaleString(lang === "en" ? "en-GB" : "vi-VN", {minimumFractionDigits: 1, maximumFractionDigits: 1});

  const agentCard = <AgentCard assessment={shown} offline={view.sendError} id="garage-agent" testId="garage-agent" />;
  const boardProps = guardian ? {
    guardian,
    assessment: shown,
    maintenance: reply?.guardian?.maintenance ?? guardian.maintenance,
    canConfirm: canConfirm(event),
    onConfirm: acknowledge,
    sound,
    hornMuted,
    onMute: muteHorn,
    onUnmute: unmuteHorn,
    onTest: testHorn,
    now: event ? Date.parse(event.capturedAt) : 0,
  } : null;
  const board = boardProps ? (
    factsSlot ? (
      <>
        {createPortal(<GuardianBoard {...boardProps} part="facts" wide title="Vehicle Guardian · ECU + camera" />, factsSlot)}
        <GuardianBoard {...boardProps} part="controls" embedded />
      </>
    ) : <GuardianBoard {...boardProps} embedded title="Vehicle Guardian · ECU + camera" />
  ) : (
    <dl className={styles.boardRows}>
      <div className={styles.boardRow} data-level={attention === "low_attention" ? driverSeverity : attention === "unknown" ? "unknown" : "normal"}>
        <dt>{t("Trạng thái tài xế", "Driver state")}<small>{state ? pick(STATE_LABEL[state], lang) : t("Đang hiệu chỉnh", "Calibrating")}</small></dt>
        <dd data-testid="board-driver">{attention === "low_attention" ? t("Giảm tỉnh táo", "Low attention") : attention === "attentive" ? t("Tỉnh táo", "Attentive") : attention === "unknown" ? t("Không xác định", "Unknown") : "—"}</dd>
      </div>
      <div className={styles.boardRow}>
        <dt>{t("Nhắm mắt lâu nhất · 60 s", "Longest closure · 60 s")}<small>Camera</small></dt>
        <dd data-testid="board-eyes">{closedSeconds} s</dd>
      </div>
      <div className={styles.boardRow}>
        <dt>{t("Dữ liệu xe", "Vehicle data")}<small>ECU</small></dt>
        <dd data-testid="board-no-vehicle">{t("Chưa có", "Not available")}</dd>
      </div>
    </dl>
  );

  return (
    <section className={`${styles.scope} ${styles.garageCam}`} data-severity={driverSeverity} data-state={state ?? "idle"} data-phase={phase} aria-label={t("Camera tài xế", "Driver camera")} data-testid="garage-camera">
      {guardian && <ActionBanner guardian={guardian} severity={shown?.severity ?? driverSeverity} />}
      <div className={styles.garageCamHead}>
        <span className={styles.kicker}><span><ScanFace size={13} aria-hidden="true" /> {t("Camera tài xế", "Driver camera")}</span></span>
        {active && <span className={styles.severity} data-severity={driverSeverity} data-testid="garage-camera-severity">{pick(SEVERITY_LABEL[driverSeverity], lang)}</span>}
      </div>
      {/* Always mounted: the camera stream needs its <video> element at the moment "Bật camera" is pressed. */}
      <div className={styles.garageCamLens}><Lens
        view={view}
        live={live}
        videoRef={videoRef}
        severity={driverSeverity}
        shownState={state}
        onToggleVideo={() => updateSettings({showVideo: !store.settings.showVideo})}
        onToggleSound={() => updateSettings({sound: !store.settings.sound})}
        onRecalibrate={recalibrate}
        onStop={stop}
      /></div>
      {cameraHint && <p className={styles.garageCamHint} role="status" data-testid="garage-camera-hint">{cameraHint}</p>}

      {active ? (
        <>
          {board}
          {agentSlot ? createPortal(agentCard, agentSlot) : agentCard}
          <p className={styles.garageCamNote} data-testid="garage-camera-sharing">{sharing}{view.source === "simulated" ? ` · ${t("tài xế mô phỏng", "simulated driver")}` : ""}</p>
        </>
      ) : (
        <div className={styles.garageCamIdle}>
          <p>{t("Bật camera để agent xe biết thêm trạng thái người lái. Video xử lý ngay trên máy, chỉ gửi chỉ số, không gửi hình.", "Turn on the camera so the car agent also knows the driver's state. Video is processed on this device; only measurements are sent, never images.")}</p>
          {phase === "error" && <p className={styles.garageCamError} role="alert" data-testid="garage-camera-error">{errorText[view.error ?? "other"] ?? errorText.other}</p>}
          <div className={styles.garageCamActions}>
            <button type="button" className={styles.confirm} onClick={() => void startWebcam()} disabled={phase === "starting"} data-testid="garage-camera-start"><Camera size={15} />{phase === "starting" ? t("Đang mở…", "Opening…") : t("Bật camera", "Turn on camera")}</button>
            <button type="button" className={styles.scenario} onClick={() => startSimulation("drowsy")} data-testid="garage-camera-sim-drowsy">{t("Mô phỏng: buồn ngủ", "Simulate: drowsy")}</button>
            <button type="button" className={styles.scenario} onClick={() => startSimulation("attentive")} data-testid="garage-camera-sim-attentive">{t("Mô phỏng: tỉnh táo", "Simulate: alert")}</button>
          </div>
          <div className={styles.hornRow} data-state={sound ? "on" : "off"} data-testid="garage-camera-sound">
            <span>{sound ? <Bell size={14} aria-hidden="true" /> : <BellOff size={14} aria-hidden="true" />}{sound ? t("Còi và giọng nói bật", "Horn and voice on") : t("Âm thanh đang tắt", "Sound is off")}</span>
            <div className={styles.respondActions}>
              {sound && <button type="button" className={styles.mute} onClick={testHorn} data-testid="garage-camera-test-horn">{t("Thử còi", "Test horn")}</button>}
              <button type="button" className={styles.mute} onClick={() => updateSettings({sound: !sound})} aria-pressed={!sound} data-testid="garage-camera-sound-toggle">{sound ? t("Tắt âm", "Mute") : t("Bật âm", "Unmute")}</button>
            </div>
          </div>
          <details className={styles.garageCamTips}>
            <summary>{t("Đặt camera thế nào cho tốt?", "How should I position the camera?")}</summary>
            <ol>
              <li>{t("Camera ngang tầm mắt, khuôn mặt trọn trong khung, cách khoảng 50–80 cm.", "Camera at eye level, whole face in view, about 50–80 cm away.")}</li>
              <li>{t("Ánh sáng chiếu từ phía trước; tránh ngược sáng và đèn chiếu thẳng vào kính.", "Light your face from the front; avoid backlight and lamps shining straight onto glasses.")}</li>
              <li>{t("Giữ mắt mở và nhìn thẳng khi hiệu chỉnh (vài giây). Đeo kính thì hiệu chỉnh khi đã đeo kính.", "Keep your eyes open and look ahead while it calibrates (a few seconds). With glasses, calibrate while wearing them.")}</li>
              <li>{t("Chớp mắt bình thường không báo động; nhắm mắt liên tục khoảng 2 giây trở lên mới tạo cảnh báo.", "Normal blinks do not alert; closing your eyes for about 2 seconds or more does.")}</li>
            </ol>
          </details>
        </div>
      )}

      {voiceLine && <p className={styles.garageCamVoice} data-speaking={!!voice.speaking} data-testid="garage-camera-voice"><AudioLines size={13} aria-hidden="true" /><span>{voiceLine}</span></p>}
      <details className={styles.garageCamSettings} open={!active}>
        <summary>{t("Cài đặt camera", "Camera settings")}</summary>
        <div className={styles.garageCamPicker}>
          <label htmlFor={`${vehicleId}-camera`}>{t("Nguồn camera", "Camera")}</label>
          <select id={`${vehicleId}-camera`} data-testid="garage-camera-select" value={selectedCamera} disabled={phase === "starting"} onChange={change => selectCamera(change.target.value)}>
            <option value="">{t("Camera mặc định", "Default camera")}</option>
            {selectedCamera && !cameras.some(camera => camera.deviceId === selectedCamera) && <option value={selectedCamera}>{t("Camera đã chọn · chưa kết nối", "Selected camera · unavailable")}</option>}
            {cameras.map((camera, index) => <option key={camera.deviceId} value={camera.deviceId}>{camera.label || `${t("Camera", "Camera")} ${index + 1}`}</option>)}
          </select>
          <button type="button" onClick={() => void findCameras()} disabled={phase === "starting"} data-testid="garage-camera-refresh" aria-label={t("Tìm lại camera", "Refresh cameras")} title={t("Tìm lại camera: cấp quyền một lần để hiện tên mọi camera, kể cả camera USB", "Refresh cameras: grant access once to list every camera by name, USB ones included")}><RefreshCw size={14} /></button>
        </div>
        <Link className={styles.garageCamLink} href="/driver">{t("Trang camera đầy đủ", "Full camera page")} <ArrowUpRight size={14} /></Link>
      </details>
    </section>
  );
}
