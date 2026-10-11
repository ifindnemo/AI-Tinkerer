// Browser mirror of backend/driver/guardian.py, so the horn and the mandatory stop never wait for
// the network. `decide()` is tested against the same case table as the Python version
// (backend/driver/guardian_cases.json); change both together.
import {tr} from "../preferences";
import type {AttentionState, DriverAssessment, DriverEvent, DriverSeverity} from "../driver/types";
import type {Attention, GuardianBlock, GuardianDecision, VehicleSnapshot} from "./types";

export const COOLANT_WARN_C = 105; // backend default (COOLANT_WARN_C); the reply carries the configured value
export const COOLANT_CRITICAL_C = 120;
export const MOVING_KMH = 5;
export const RESPONSE_TIMEOUT_MS = 10_000;
const RANK: Record<DriverSeverity, number> = {normal: 0, warning: 1, critical: 2};
const LOW: AttentionState[] = ["drowsy", "distracted"];
const max = (...levels: DriverSeverity[]) => levels.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "normal");

export const vehicleLevel = (coolantC: number, warnC = COOLANT_WARN_C): DriverSeverity =>
  coolantC >= COOLANT_CRITICAL_C ? "critical" : coolantC >= warnC ? "warning" : "normal";

export const attentionOf = (state: AttentionState): Attention =>
  LOW.includes(state) ? "low_attention" : state === "no_face" || state === "uncertain" ? "unknown" : "attentive";

export type DecideInput = {
  speedKmh: number; coolantC: number; warnC: number;
  driverState: AttentionState; driverSeverity: DriverSeverity;
  responded: boolean; unanswered: boolean;
};

export function decide(input: DecideInput): GuardianDecision {
  const level = vehicleLevel(input.coolantC, input.warnC);
  const moving = input.speedKmh >= MOVING_KMH;
  const attention = attentionOf(input.driverState);
  let driver = input.driverSeverity;
  if (driver !== "normal" && LOW.includes(input.driverState)) {
    if (input.responded) driver = "warning";
    else if (input.unanswered) driver = "critical";
  }
  const out = (severity: DriverSeverity, action: GuardianDecision["action"], mustStop: boolean): GuardianDecision =>
    ({severity, action, mustStop, attention, vehicleLevel: level, driverSeverity: driver});
  if (level === "critical") return out("critical", "stop_engine", true);
  if (input.driverState === "drowsy" && driver !== "normal") return out(max(driver, level), moving ? "stop_nearest_safe" : "stay_parked", moving);
  if (input.driverState === "distracted" && driver !== "normal") return out(max(driver, level), "refocus", false);
  if (level === "warning") return out(max(driver, level), "reduce_load", false);
  return out(driver, driver !== "normal" ? "check_camera" : "continue", false);
}

/** The horn is for the driver's alertness and for a mandatory engine stop: it sounds when either
 * rises, even if the combined level stays the same (a warm engine is already a warning). */
export function shouldSound(previous: GuardianDecision | null, next: GuardianDecision): boolean {
  if (next.vehicleLevel === "critical" && previous?.vehicleLevel !== "critical") return true;
  return RANK[next.driverSeverity] > RANK[previous?.driverSeverity ?? "normal"];
}

/** Can the driver confirm right now? Only with open eyes, facing forward, on a reliable reading. */
export const canConfirm = (event: DriverEvent | null) =>
  !!event && event.facePresent && event.confidence >= 0.5 && event.state === "attentive" && !event.eyes.closed && event.head.direction === "forward";

export type LocalGuardianResult = {decision: GuardianDecision; block: GuardianBlock; assessment: DriverAssessment};

/** Tracks the alert episode (start, response, closure peak) and applies `decide()` on every frame. */
export class LocalGuardian {
  private alertSince: number | null = null;
  private lastLow = -Infinity;
  private closures: [number, number][] = [];

  update(event: DriverEvent, driver: DriverAssessment, vehicle: VehicleSnapshot, acknowledgedAt: string | null, warnC = COOLANT_WARN_C): LocalGuardianResult {
    const now = Date.parse(event.capturedAt);
    const reliable = event.facePresent && event.confidence >= 0.5 && !["uncertain", "no_face"].includes(event.state);
    if (reliable && LOW.includes(event.state)) this.lastLow = now;
    if (reliable) this.closures.push([now, event.eyes.closedMs]);
    this.closures = this.closures.filter(([t]) => now - t <= 60_000);
    const alerting = driver.severity !== "normal" && LOW.includes(driver.state);
    if (alerting) this.alertSince ??= now;
    else this.alertSince = null;
    const ack = acknowledgedAt ? Date.parse(acknowledgedAt) : null;
    const responded = ack !== null && this.alertSince !== null && this.alertSince <= ack && this.lastLow <= ack;
    const unanswered = !responded && this.alertSince !== null && now - this.alertSince >= RESPONSE_TIMEOUT_MS;
    const decision = decide({
      speedKmh: vehicle.speedKmh, coolantC: vehicle.coolantC, warnC,
      driverState: driver.state, driverSeverity: driver.severity, responded, unanswered,
    });
    const block: GuardianBlock = {
      vehicle: {...vehicle, level: decision.vehicleLevel, warnC, criticalC: COOLANT_CRITICAL_C, moving: vehicle.speedKmh >= MOVING_KMH},
      driver: {
        attention: decision.attention, state: driver.state, severity: decision.driverSeverity,
        closedMs: this.closures.reduce((peak, [, ms]) => Math.max(peak, ms), 0),
        responded, unanswered, alertSince: this.alertSince === null ? null : new Date(this.alertSince).toISOString(),
      },
      action: decision.action, mustStop: decision.mustStop, maintenance: null,
    };
    return {decision, block, assessment: {...driver, ...localText(decision, vehicle, driver, responded), severity: decision.severity}};
  }
}

/** Short on-device wording; the backend adds evidence from all sources and the agent's explanation. */
function localText(d: GuardianDecision, v: VehicleSnapshot, driver: DriverAssessment, responded: boolean) {
  const hot = d.vehicleLevel === "warning";
  const c = Math.round(v.coolantC);
  switch (d.action) {
    case "stop_engine":
      return {
        summary: tr(`Động cơ quá nhiệt nghiêm trọng (${c}°C). Hành động bắt buộc, không phụ thuộc trạng thái người lái.`, `Severe engine overheating (${c}°C). Mandatory, whatever the driver's state.`),
        recommendations: [
          tr("Tấp vào vị trí an toàn gần nhất và tắt động cơ.", "Pull over at the nearest safe place and switch off the engine."),
          tr("Không tiếp tục đến trạm nghỉ hoặc garage.", "Do not continue to a rest stop or garage."),
          tr("Không mở nắp két nước khi động cơ còn nóng.", "Do not open the radiator cap while the engine is hot."),
        ],
      };
    case "stop_nearest_safe":
    case "stay_parked":
      return {
        summary: (responded ? tr("Đã ghi nhận phản hồi. ", "Response recorded. ") : "")
          + tr("Người lái có dấu hiệu mất tỉnh táo", "The driver shows signs of low alertness")
          + (hot ? tr(` và động cơ đang nóng (${c}°C).`, ` and the engine is warm (${c}°C).`) : ".")
          + (d.mustStop ? tr(" Không nên tiếp tục đến garage ở xa.", " Do not continue to a distant garage.") : ""),
        recommendations: [
          d.mustStop
            ? tr("Dừng tại vị trí an toàn gần nhất để nghỉ; không tiếp tục đến garage ở xa.", "Stop at the nearest safe place to rest; do not continue to a distant garage.")
            : tr("Giữ xe ở nơi đỗ an toàn; chưa tiếp tục lái khi còn buồn ngủ.", "Remain safely parked; do not resume driving while drowsy."),
          ...(hot ? [tr("Khi đã dừng, kiểm tra lại nhiệt độ động cơ trước khi khởi hành lại.", "Once stopped, check the engine temperature again before going on.")] : []),
          tr("Nghỉ ít nhất 15–20 phút hoặc đổi người lái.", "Rest for at least 15–20 minutes or change drivers."),
        ],
      };
    case "reduce_load":
      return {
        summary: tr(`Nhiệt độ động cơ đang tăng (${c}°C) và cần được theo dõi. `, `Engine temperature is rising (${c}°C) and needs watching. `)
          + (d.attention === "unknown"
            ? tr("Không thể xác định trạng thái người lái từ camera; cảnh báo của xe vẫn được duy trì.", "The camera cannot determine the driver's state; the vehicle warning stays.")
            : responded ? tr("Người lái đã xác nhận cảnh báo.", "The driver confirmed the alert.") : tr("Người lái đang chú ý.", "The driver is attentive.")),
        recommendations: [
          tr("Giảm tải động cơ: giảm tốc, tránh tăng ga mạnh.", "Ease the engine load: slow down, avoid hard acceleration."),
          tr("Theo dõi nhiệt độ; nếu tiếp tục tăng, dừng xe ở nơi an toàn.", "Watch the temperature; if it keeps rising, stop somewhere safe."),
          tr("Đến garage phù hợp nếu nhiệt độ không tiếp tục tăng.", "Head to a suitable garage if the temperature stops rising."),
        ],
      };
    case "refocus":
      return {
        summary: driver.summary,
        recommendations: [
          tr("Đưa mắt nhìn lại phía trước ngay.", "Look back at the road now."),
          ...(hot ? [tr("Giảm tốc và theo dõi nhiệt độ; nếu tiếp tục tăng, dừng ở nơi an toàn.", "Slow down and watch the temperature; stop somewhere safe if it keeps rising.")] : []),
        ],
      };
    default:
      return {summary: driver.summary, recommendations: driver.recommendations};
  }
}
