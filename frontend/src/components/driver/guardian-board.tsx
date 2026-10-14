"use client";
import {Bell, BellOff, Check, Gauge} from "lucide-react";
import {useLang} from "@/hooks/use-preferences";
import {pick, type Text} from "@/lib/preferences";
import {ECU_SCENARIOS, type EcuScenario} from "@/lib/guardian/ecu";
import type {Attention, GuardianAction, GuardianBlock, MaintenanceSummary} from "@/lib/guardian/types";
import type {DriverAssessment} from "@/lib/driver/types";
import styles from "./driver.module.css";

const ECU_LABEL: Record<EcuScenario, Text> = {
  normal: {vi: "Bình thường", en: "Normal"},
  warm: {vi: "Nóng nhẹ", en: "Running warm"},
  overheat: {vi: "Quá nhiệt", en: "Overheating"},
  parked: {vi: "Đỗ xe", en: "Parked"},
};

const ATTENTION_LABEL: Record<Attention, Text> = {
  attentive: {vi: "Tỉnh táo", en: "Attentive"},
  low_attention: {vi: "Giảm tỉnh táo", en: "Low attention"},
  unknown: {vi: "Không xác định", en: "Unknown"},
};

const ACTION_LABEL: Record<GuardianAction, Text> = {
  continue: {vi: "Tiếp tục hành trình", en: "Continue the trip"},
  reduce_load: {vi: "Giảm tải, theo dõi nhiệt độ", en: "Ease off, watch the temperature"},
  refocus: {vi: "Nhìn lại phía trước", en: "Eyes back on the road"},
  stop_nearest_safe: {vi: "Dừng ở vị trí an toàn gần nhất", en: "Stop at the nearest safe place"},
  stay_parked: {vi: "Giữ xe đỗ, nghỉ ngơi", en: "Stay parked and rest"},
  check_camera: {vi: "Chỉnh camera khi đã dừng", en: "Fix the camera once stopped"},
  stop_engine: {vi: "Tấp vào nơi an toàn, tắt máy", en: "Pull over, switch the engine off"},
};

function alertLabel(g: GuardianBlock): Text {
  if (g.action === "stop_engine") return {vi: "Dừng xe bắt buộc", en: "Mandatory stop"};
  if (g.driver.attention === "low_attention" && g.driver.severity !== "normal") {
    if (g.driver.responded) return {vi: "Đã phản hồi · vẫn theo dõi", en: "Acknowledged · still watching"};
    if (g.driver.unanswered) return {vi: "Chưa phản hồi · nhắc lại", en: "No response · repeating"};
    return {vi: "Cảnh báo tài xế ngay", en: "Immediate driver warning"};
  }
  if (g.vehicle.level === "warning") return {vi: "Cảnh báo kỹ thuật", en: "Vehicle warning"};
  if (g.action === "check_camera") return {vi: "Camera mất tài xế", en: "Driver out of view"};
  return {vi: "Không có cảnh báo", en: "No alert"};
}

const decimal = (value: number, lang: string, digits = 1) =>
  value.toLocaleString(lang === "en" ? "en-GB" : "vi-VN", {minimumFractionDigits: digits, maximumFractionDigits: digits});

/** The simulated car: four situations, always labelled as simulated ECU data. */
export function EcuPicker({value, onChange}: {value: EcuScenario; onChange: (ecu: EcuScenario) => void}) {
  const {t, lang} = useLang();
  return (
    <div className={styles.strip} aria-label={t("Dữ liệu xe mô phỏng", "Simulated vehicle data")}>
      <span className={styles.stripLabel}><span><Gauge size={14} aria-hidden="true" /> {t("Xe · ECU", "Car · ECU")}</span><small>{t("Dữ liệu ECU mô phỏng", "Simulated ECU data")}</small></span>
      <div className={styles.scenarios}>
        {ECU_SCENARIOS.map(scenario => (
          <button key={scenario} type="button" className={styles.scenario} aria-pressed={value === scenario} onClick={() => onChange(scenario)} data-testid={`ecu-${scenario}`}>
            {pick(ECU_LABEL[scenario], lang)}
          </button>
        ))}
      </div>
    </div>
  );
}

// `animate`: the value slides in when it changes. Numbers that move several times a second must not, or they flicker.
type Row = {key: string; label: string; value: string; source: string; level?: string; testId: string; animate: boolean};

/** One line per fact, each with its source: what the CEO demo board must show at a glance. */
export function GuardianBoard({guardian, assessment, maintenance, canConfirm, onConfirm, sound, hornMuted, onMute, onUnmute, onTest, now, embedded = false, title}: {
  guardian: GuardianBlock | null;
  assessment: DriverAssessment | null;
  maintenance: MaintenanceSummary | null;
  canConfirm: boolean;
  onConfirm: () => void;
  /** The saved sound setting (the horn can still be muted by hand for one alert). */
  sound: boolean;
  hornMuted: boolean;
  onMute: () => void;
  onUnmute: () => void;
  onTest: () => void;
  now: number;
  /** Inside another card: no frame of its own, and rows two by two when there is room. */
  embedded?: boolean;
  title?: string;
}) {
  const {t, lang} = useLang();
  if (!guardian) return null;
  const {vehicle, driver} = guardian;
  const engine = !assessment ? "" : assessment.fallbackReason === "local" ? t("Luật trên thiết bị", "On-device rules") : assessment.engine === "agent" ? "Agent" : t("Luật", "Rules");
  const alertActive = !!driver.alertSince && driver.attention === "low_attention" && driver.severity !== "normal";
  const ongoing = alertActive || guardian.mustStop || vehicle.level === "critical";
  const waited = driver.alertSince ? Math.max(0, Math.round((now - Date.parse(driver.alertSince)) / 1000)) : 0;
  const rows: Row[] = [
    {key: "speed", animate: false, testId: "board-speed", label: t("Tốc độ xe", "Vehicle speed"), value: `${Math.round(vehicle.speedKmh)} km/h`, source: vehicle.source === "obd" ? t("ECU · xe thật (OBD)", "ECU · real car (OBD)") : t("ECU mô phỏng", "Simulated ECU")},
    {key: "coolant", animate: false, testId: "board-coolant", label: t("Nước làm mát", "Coolant"), value: `${decimal(vehicle.coolantC, lang)} °C`, level: vehicle.level, source: vehicle.source === "obd" ? t(`ECU · OBD · cảnh báo ≥ ${vehicle.warnC}`, `ECU · OBD · warns ≥ ${vehicle.warnC}`) : t(`ECU mô phỏng · cảnh báo ≥ ${vehicle.warnC} °C`, `Simulated ECU · warns ≥ ${vehicle.warnC} °C`)},
    {key: "driver", animate: true, testId: "board-driver", label: t("Trạng thái tài xế", "Driver state"), value: pick(ATTENTION_LABEL[driver.attention], lang), level: driver.attention === "low_attention" ? driver.severity : driver.attention === "unknown" ? "unknown" : "normal", source: "Camera"},
    {key: "eyes", animate: false, testId: "board-eyes", label: t("Nhắm mắt lâu nhất · 60 s", "Longest closure · 60 s"), value: `${decimal(driver.closedMs / 1000, lang)} s`, source: "Camera"},
    {key: "alert", animate: true, testId: "board-alert", label: t("Cảnh báo an toàn", "Safety alert"), value: pick(alertLabel(guardian), lang), level: guardian.action === "stop_engine" || alertActive ? (assessment?.severity ?? "warning") : vehicle.level, source: "Safety policy"},
    {key: "action", animate: true, testId: "board-action", label: t("Đề xuất", "Recommendation"), value: pick(ACTION_LABEL[guardian.action], lang), level: guardian.mustStop ? "critical" : undefined, source: engine},
  ];
  return (
    <section className={`${styles.board} ${embedded ? styles.boardEmbedded : ""}`} aria-label="Vehicle Guardian" data-testid="guardian-board" data-action={guardian.action} data-must-stop={guardian.mustStop}>
      <div className={styles.boardHead}>
        <span className={styles.kicker}>{title ?? "Vehicle Guardian"}</span>
        <span className={styles.boardNote}>{vehicle.source === "obd" ? t("ECU + camera + lịch sử bảo trì", "ECU + camera + service history") : t("ECU mô phỏng + camera + lịch sử bảo trì (mô phỏng)", "Simulated ECU + camera + service history (simulated)")}</span>
      </div>
      <dl className={styles.boardRows}>
        {rows.map(row => (
          <div key={row.key} className={styles.boardRow} data-level={row.level}>
            <dt>{row.label}<small>{row.source}</small></dt>
            <dd key={row.animate ? row.value : row.key} data-animate={row.animate} data-testid={row.testId}>{row.value}</dd>
          </div>
        ))}
      </dl>
      {maintenance && (
        <p className={styles.boardFoot}>
          {t(
            `Lịch sử bảo trì (mô phỏng): ${maintenance.records} lần vào garage, ${maintenance.coolingRecords ? `${maintenance.coolingRecords} lần liên quan làm mát` : "chưa có sửa chữa hệ thống làm mát"}. Chỉ là bối cảnh.`,
            `Service history (simulated): ${maintenance.records} garage visits, ${maintenance.coolingRecords ? `${maintenance.coolingRecords} cooling-related` : "no cooling-system repairs"}. Context only.`,
          )}
        </p>
      )}
      {(alertActive || driver.responded) && (
        <div className={styles.respond} data-state={driver.responded ? "done" : driver.unanswered ? "late" : "waiting"}>
          <div>
            <b>{driver.responded ? t("Đã ghi nhận phản hồi", "Response recorded") : driver.unanswered ? t(`Chưa phản hồi · ${waited} s`, `No response · ${waited} s`) : t(`Chờ tài xế phản hồi · ${waited} s`, `Waiting for the driver · ${waited} s`)}</b>
            <span>{driver.responded
              ? t("Cảnh báo kỹ thuật của xe vẫn được giữ để tiếp tục theo dõi.", "The vehicle warning stays on for monitoring.")
              : canConfirm ? t("Mắt đã mở và nhìn thẳng: có thể xác nhận.", "Eyes open, facing forward: you can confirm.") : t("Mở mắt và nhìn thẳng để xác nhận.", "Open your eyes and face forward to confirm.")}</span>
          </div>
          <div className={styles.respondActions}>
            {!driver.responded && <button type="button" className={styles.confirm} disabled={!canConfirm} onClick={onConfirm} data-testid="guardian-ack"><Check size={16} />{t("Tôi đã tỉnh", "I'm alert")}</button>}
          </div>
        </div>
      )}
      <div className={styles.hornRow} data-state={!sound ? "off" : hornMuted ? "muted" : "on"} data-testid="guardian-horn">
        <span>
          {!sound ? <BellOff size={14} aria-hidden="true" /> : <Bell size={14} aria-hidden="true" />}
          {!sound ? t("Âm thanh đang tắt", "Sound is off") : hornMuted ? t("Còi đã tắt cho cảnh báo này", "Horn muted for this alert") : t("Còi và giọng nói bật", "Horn and voice on")}
        </span>
        <div className={styles.respondActions}>
          {sound && !hornMuted && <button type="button" className={styles.mute} onClick={onTest} data-testid="guardian-test">{t("Thử còi", "Test horn")}</button>}
          {sound && !hornMuted && ongoing && <button type="button" className={`${styles.mute} ${styles.muteStrong}`} onClick={onMute} data-testid="guardian-mute" aria-label={t("Tắt còi", "Mute the horn")}><BellOff size={14} aria-hidden="true" />{t("Tắt còi", "Mute")}</button>}
          {sound && hornMuted && <button type="button" className={styles.mute} onClick={onUnmute} data-testid="guardian-unmute">{t("Bật lại", "Unmute")}</button>}
        </div>
      </div>
    </section>
  );
}
