import type {Telemetry} from "./telemetry";
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
export const thermalLabels: Record<ThermalLevel,string> = {
  normal: "Trong ngưỡng mô phỏng", watch: "Nhiệt độ tăng", danger: "Cảnh báo quá nhiệt", unknown: "Chưa có dữ liệu mới",
};
