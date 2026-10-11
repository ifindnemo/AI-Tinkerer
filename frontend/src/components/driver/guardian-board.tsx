"use client";
import {BellOff, Check, Gauge} from "lucide-react";
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

type Row = {key: string; label: string; value: string; source: string; level?: string; testId: string};

/** One line per fact, each with its source: what the CEO demo board must show at a glance. */
export function GuardianBoard({guardian, assessment, maintenance, canConfirm, onConfirm, sound, onMute, now}: {
  guardian: GuardianBlock | null;
  assessment: DriverAssessment | null;
  maintenance: MaintenanceSummary | null;
  canConfirm: boolean;
  onConfirm: () => void;
  sound: boolean;
  onMute: () => void;
  now: number;
}) {
  const {t, lang} = useLang();
  if (!guardian) return null;
  const {vehicle, driver} = guardian;
  const engine = !assessment ? "" : assessment.fallbackReason === "local" ? t("Luật trên thiết bị", "On-device rules") : assessment.engine === "agent" ? "Agent" : t("Luật", "Rules");
  const alertActive = !!driver.alertSince && driver.attention === "low_attention" && driver.severity !== "normal";
  const waited = driver.alertSince ? Math.max(0, Math.round((now - Date.parse(driver.alertSince)) / 1000)) : 0;
  const rows: Row[] = [
    {key: "speed", testId: "board-speed", label: t("Tốc độ xe", "Vehicle speed"), value: `${Math.round(vehicle.speedKmh)} km/h`, source: t("ECU · mô phỏng", "ECU · simulated")},
    {key: "coolant", testId: "board-coolant", label: t("Nước làm mát", "Coolant"), value: `${decimal(vehicle.coolantC, lang)} °C`, level: vehicle.level, source: t(`ECU · cảnh báo ≥ ${vehicle.warnC}`, `ECU · warns ≥ ${vehicle.warnC}`)},
    {key: "driver", testId: "board-driver", label: t("Trạng thái tài xế", "Driver state"), value: pick(ATTENTION_LABEL[driver.attention], lang), level: driver.attention === "low_attention" ? driver.severity : driver.attention === "unknown" ? "unknown" : "normal", source: "Camera"},
    {key: "eyes", testId: "board-eyes", label: t("Nhắm mắt lâu nhất · 60 s", "Longest closure · 60 s"), value: `${decimal(driver.closedMs / 1000, lang)} s`, source: "Camera"},
    {key: "alert", testId: "board-alert", label: t("Cảnh báo an toàn", "Safety alert"), value: pick(alertLabel(guardian), lang), level: guardian.action === "stop_engine" || alertActive ? (assessment?.severity ?? "warning") : vehicle.level, source: "Safety policy"},
    {key: "action", testId: "board-action", label: t("Đề xuất", "Recommendation"), value: pick(ACTION_LABEL[guardian.action], lang), level: guardian.mustStop ? "critical" : undefined, source: engine},
  ];
  return (
    <section className={styles.board} aria-label="Vehicle Guardian" data-testid="guardian-board" data-action={guardian.action} data-must-stop={guardian.mustStop}>
      <div className={styles.boardHead}>
        <span className={styles.kicker}>Vehicle Guardian</span>
        <span className={styles.boardNote}>{t("ECU + camera + lịch sử bảo trì", "ECU + camera + service history")}</span>
      </div>
      <dl className={styles.boardRows}>
        {rows.map(row => (
          <div key={row.key} className={styles.boardRow} data-level={row.level}>
            <dt>{row.label}<small>{row.source}</small></dt>
            <dd key={row.value} data-testid={row.testId}>{row.value}</dd>
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
            {sound && !driver.responded && <button type="button" className={styles.mute} onClick={onMute} data-testid="guardian-mute" aria-label={t("Tắt còi", "Mute the horn")}><BellOff size={16} /></button>}
          </div>
        </div>
      )}
    </section>
  );
}
