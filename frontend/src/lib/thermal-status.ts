import type {Telemetry} from "./telemetry";
import type {Text} from "./preferences";
export type ThermalLevel = "normal" | "watch" | "danger" | "unknown";

// Presentation rules for the authored overheating demo, not manufacturer limits.
// Fault labels and uncalibrated Excel channels do not determine heat severity.
export function thermalLevel(t: Telemetry, sensor: "engine" | "cooling"): ThermalLevel {
  if (!t.connected) return "unknown";
  const ev = t.powertrain === "ev";
  const value = ev ? sensor === "engine" ? t.traction?.motorTemp : t.traction?.batteryTemp : sensor === "engine" ? t.oil : t.coolant;
  if (value === undefined || !Number.isFinite(value)) return "unknown";
  if (ev) return value >= (sensor === "engine" ? 90 : 50) ? "danger" : value >= (sensor === "engine" ? 70 : 38) ? "watch" : "normal";
  const ongoingOverheat = t.coolant >= 105 && t.coolantTrend >= 2 && t.fan === 0;
  if (value >= (sensor === "engine" ? 125 : 115) || (ongoingOverheat && value >= (sensor === "engine" ? 110 : 105))) return "danger";
  return value >= (sensor === "engine" ? 110 : 100) ? "watch" : "normal";
}
export const thermalLabels: Record<ThermalLevel,Text> = {
  normal: {vi: "Trong ngưỡng mô phỏng", en: "Within simulated range"}, watch: {vi: "Nhiệt độ tăng", en: "Temperature rising"},
  danger: {vi: "Cảnh báo quá nhiệt", en: "Overheating warning"}, unknown: {vi: "Chưa có dữ liệu mới", en: "No fresh data"},
};
