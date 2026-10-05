import type { Analysis, Telemetry } from "./telemetry";
import { tr, type Text } from "./preferences";

export type IncidentStatus = "MONITORING" | "WARNING" | "WAITING_CONFIRMATION" | "ACTION_IN_PROGRESS" | "CRITICAL" | "STABILIZING" | "RESOLVED";
export type RiskSeverity = "LOW" | "HIGH" | "CRITICAL";
export type SimulationPhase = "moving" | "slowing" | "stopped" | "cooling";
export type ActionKind = "NAVIGATE_SAFE_STOP" | "CREATE_RESCUE_REQUEST";
export type ActionPayload = {
  incidentId: string; vehicleId: string; vehicleName: string;
  latitude: number; longitude: number; capturedAt: string;
  coolant: number; speed: number; dtc: string[];
};
export type AgentAction = {
  id: string; kind: ActionKind; status: "proposed" | "pending" | "succeeded" | "declined" | "failed";
  payload: ActionPayload; error?: string; result?: { requestId: string; message: string };
};
export type IncidentEntry = { id: string; at: string; message: string };
export type SafetyIncident = {
  id: string; vehicleId: string; vehicleName: string; status: IncidentStatus;
  severity: RiskSeverity; phase: SimulationPhase; phaseTick: number;
  driverAcknowledged: boolean; navigationDone: boolean; rescueDone: boolean;
  action: AgentAction | null; packet: Telemetry | null; timeline: IncidentEntry[];
};
export const statusLabels: Record<IncidentStatus, Text> = {
  MONITORING: {vi: "Đang theo dõi", en: "Monitoring"}, WARNING: {vi: "Đã cảnh báo", en: "Warning issued"}, WAITING_CONFIRMATION: {vi: "Chờ xác nhận", en: "Awaiting confirmation"},
  ACTION_IN_PROGRESS: {vi: "Đang xử lý", en: "In progress"}, CRITICAL: {vi: "Cần dừng an toàn", en: "Stop safely"}, STABILIZING: {vi: "Đang ổn định", en: "Stabilising"}, RESOLVED: {vi: "Đã kết thúc sự cố", en: "Incident closed"},
};
export function createIncident(id: string, vehicleId: string, vehicleName: string): SafetyIncident {
  return {id, vehicleId, vehicleName, status: "WARNING", severity: "HIGH", phase: "moving", phaseTick: 0,
    driverAcknowledged: false, navigationDone: false, rescueDone: false, action: null, packet: null,
    timeline: [{id: `${id}:start`, at: new Date().toISOString(), message: tr("Phát hiện nguy cơ nóng máy từ nhiều tín hiệu. Bắt đầu theo dõi sự cố.", "Overheating risk detected from several signals. Incident monitoring started.")}]};
}
function addEntry(s: SafetyIncident, key: string, message: string): SafetyIncident {
  if (s.timeline.some(item => item.id === `${s.id}:${key}`)) return s;
  return {...s, timeline: [...s.timeline, {id: `${s.id}:${key}`, at: new Date().toISOString(), message}].slice(-30)};
}
function proposal(s: SafetyIncident, kind: ActionKind, t: Telemetry): SafetyIncident {
  return {...s, status: "WAITING_CONFIRMATION", action: {
    id: `${s.id}:${kind}`, kind, status: "proposed", payload: {
      incidentId: s.id, vehicleId: s.vehicleId, vehicleName: s.vehicleName,
      latitude: t.location.lat, longitude: t.location.lon, capturedAt: t.capturedAt,
      coolant: t.coolant, speed: t.speed, dtc: [...t.dtc],
    },
  }};
}
export function simulateIncidentPacket(base: Telemetry, s: SafetyIncident): Telemetry {
  const phase = s.phase;
  const cooling = phase === "cooling";
  const stopped = phase === "stopped" || cooling;
  const coolant = cooling ? Math.max(98, 112 - s.phaseTick * 4) : phase === "moving" ? 108 : phase === "slowing" ? 112 : 114;
  return {...base, operatingSource: "scenario", speed: stopped ? 0 : phase === "moving" ? 65 : 28,
    rpm: stopped ? 0 : phase === "moving" ? 3800 : 1900,
    engineLoad: stopped ? 0 : phase === "moving" ? 84 : 42,
    tps: stopped ? 0 : phase === "moving" ? 48 : 18,
    consumption: stopped ? 0 : phase === "moving" ? 9.2 : 4.1,
    map: stopped ? 100 : phase === "moving" ? 82 : 44,
    battery: stopped ? 12.6 : 14.2, coolant, oil: coolant + 7,
    coolantTrend: cooling ? (s.phaseTick >= 4 ? 0 : -4) : 4.5,
    fan: 0, fault: 1, dtc: ["P0217"],
  };
}
export function observeIncident(s: SafetyIncident, packet: Telemetry): SafetyIncident {
  if (!packet.connected || packet.vehicleId !== s.vehicleId) return s;
  let next: SafetyIncident = {...s, packet, phaseTick: s.phaseTick + 1};
  if (s.phase === "moving") return next;
  if (s.phase === "slowing") {
    next = {...next, severity: "CRITICAL"};
    next = addEntry(next, "slowing", tr("Telemetry xác nhận tốc độ 65 → 28 km/h, RPM 3.800 → 1.900; nhiệt vẫn tăng 108 → 112°C. Nâng cảnh báo.", "Telemetry confirms speed 65 → 28 km/h, RPM 3,800 → 1,900; temperature still rising 108 → 112°C. Escalating."));
    if (!s.action && !s.navigationDone) next = proposal(next, "NAVIGATE_SAFE_STOP", packet);
  }
  if (s.phase === "stopped") {
    next = {...next, severity: "CRITICAL"};
    next = addEntry(next, "stopped", tr("Telemetry xác nhận xe đã dừng, RPM về 0. Nhiệt độ vẫn cao; đề xuất cứu hộ.", "Telemetry confirms the car has stopped, RPM at 0. Temperature still high; proposing roadside assistance."));
    if (!s.rescueDone && s.action?.kind !== "CREATE_RESCUE_REQUEST") next = proposal(next, "CREATE_RESCUE_REQUEST", packet);
  }
  if (s.phase === "cooling") {
    next = {...next, status: "STABILIZING", severity: "HIGH"};
    next = addEntry(next, "cooling", tr("Dữ liệu mô phỏng cho thấy nhiệt độ giảm sau khi xe dừng. Tiếp tục theo dõi.", "Simulated data shows the temperature falling after stopping. Still monitoring."));
    if (packet.coolant <= 98 && packet.coolantTrend === 0) {
      next = {...next, status: "RESOLVED", severity: "LOW"};
      next = addEntry(next, "resolved", tr("Nhiệt độ đã ổn định trong chuỗi mô phỏng. Kết thúc xử lý khẩn cấp; mã lỗi vẫn cần kỹ thuật viên kiểm tra.", "Temperature has stabilised in the simulation. Emergency handling ended; the fault code still needs a technician."));
    }
  }
  return next;
}
export type IncidentCommand =
  | {type: "ACKNOWLEDGE"}
  | {type: "SIMULATE"; phase: SimulationPhase}
  | {type: "CONFIRM" | "DECLINE" | "REOPEN"; actionId: string}
  | {type: "TOOL_SUCCESS"; actionId: string; result: {requestId: string; message: string}}
  | {type: "TOOL_FAILURE"; actionId: string; error: string};
export function transitionIncident(s: SafetyIncident, command: IncidentCommand): SafetyIncident {
  if (command.type === "ACKNOWLEDGE") {
    if (s.driverAcknowledged || s.phase !== "moving") return s;
    return addEntry({...s, driverAcknowledged: true, status: "ACTION_IN_PROGRESS"}, "acknowledge", tr("Tài xế phản hồi đang giảm tốc. Đang chờ telemetry xác nhận, chưa coi đây là kết quả của xe.", "Driver reports slowing down. Waiting for telemetry to confirm; not treated as a vehicle result yet."));
  }
  if (command.type === "SIMULATE") {
    const allowed = (command.phase === "slowing" && s.phase === "moving") ||
      (command.phase === "stopped" && (s.phase === "moving" || s.phase === "slowing")) ||
      (command.phase === "cooling" && s.phase === "stopped" && s.rescueDone);
    if (!allowed) return s;
    // Arriving at a stop invalidates an outstanding navigation confirmation/result.
    return {...s, phase: command.phase, phaseTick: 0, ...(command.phase === "stopped" && s.action?.kind === "NAVIGATE_SAFE_STOP" ? {action: null, status: "CRITICAL" as const} : {})};
  }
  const action = s.action;
  if (!action || action.id !== command.actionId) return s;
  if (command.type === "CONFIRM") {
    if (action.status !== "proposed" && action.status !== "failed") return s;
    return {...s, status: "ACTION_IN_PROGRESS", action: {...action, status: "pending", error: undefined}};
  }
  if (command.type === "DECLINE") {
    if (action.status !== "proposed") return s;
    return addEntry({...s, status: "CRITICAL", action: {...action, status: "declined"}}, `declined-${action.kind}`, tr("Người dùng từ chối hành động. Không gửi yêu cầu; tiếp tục theo dõi chiếc xe.", "The user declined. No request sent; still monitoring the car."));
  }
  if (command.type === "REOPEN") {
    if (action.status !== "declined") return s;
    return {...s, status: "WAITING_CONFIRMATION", action: {...action, status: "proposed"}};
  }
  if (action.status !== "pending") return s;
  if (command.type === "TOOL_FAILURE") return {...s, status: "CRITICAL", action: {...action, status: "failed", error: command.error}};
  if (command.type === "TOOL_SUCCESS") {
    return addEntry({...s, status: "ACTION_IN_PROGRESS", action: {...action, status: "succeeded", result: command.result},
      navigationDone: s.navigationDone || action.kind === "NAVIGATE_SAFE_STOP",
      rescueDone: s.rescueDone || action.kind === "CREATE_RESCUE_REQUEST"}, `success-${action.kind}`, command.result.message);
  }
  return s;
}
export function incidentReport(t: Telemetry, s: SafetyIncident): Analysis {
  const resolved = s.status === "RESOLVED";
  return {id: s.id, vehicleId: s.vehicleId, vehicleName: s.vehicleName, powertrain: t.powertrain, createdAt: t.capturedAt,
    severity: s.severity === "CRITICAL" ? "critical" : "watch", score: resolved ? 80 : s.severity === "CRITICAL" ? 42 : 68,
    cause: "engine", title: resolved ? tr("Nhiệt đã ổn định · cần kiểm tra nguyên nhân", "Temperature stable · cause still needs checking") : s.status === "STABILIZING" ? tr("Nhiệt độ đang giảm", "Temperature falling") : s.severity === "CRITICAL" ? (t.speed > 0 ? tr("Nóng máy vẫn tiếp diễn · cần dừng an toàn", "Still overheating · stop safely") : tr("Xe đã dừng · nhiệt độ vẫn ở mức cao", "Car stopped · temperature still high")) : tr("Phát hiện nguy cơ nóng máy", "Overheating risk detected"),
    summary: resolved ? tr("Xử lý khẩn cấp đã kết thúc trong demo. Mã lỗi P0217 chưa được xác nhận đã khắc phục.", "Emergency handling ended in the demo. P0217 is not confirmed as fixed.") : tr(`Nước làm mát ${t.coolant}°C, tải động cơ ${t.engineLoad}% và quạt chưa hoạt động. Theo dõi phản ứng xe cùng Safety Agent.`, `Coolant ${t.coolant}°C, engine load ${t.engineLoad}% and the fan is off. Follow the car's response with the Safety Agent.`),
    evidence: [tr(`Nước làm mát ${t.coolant}°C · xu hướng ${t.coolantTrend}°C/phút`, `Coolant ${t.coolant}°C · trend ${t.coolantTrend}°C/min`), tr(`Tốc độ ${t.speed} km/h · RPM ${t.rpm} · tải ${t.engineLoad}%`, `Speed ${t.speed} km/h · RPM ${t.rpm} · load ${t.engineLoad}%`), tr(`Quạt OFF · DTC ${t.dtc.join(", ")}`, `Fan OFF · DTC ${t.dtc.join(", ")}`)],
    recommendations: [t.speed > 0 ? tr("Giảm tốc phù hợp và chuẩn bị dừng tại vị trí an toàn.", "Slow down and prepare to stop in a safe place.") : tr("Giữ xe tại vị trí an toàn và theo dõi hướng dẫn hỗ trợ.", "Keep the car in a safe place and follow assistance guidance."), tr("Không mở nắp hệ thống làm mát khi động cơ còn nóng.", "Do not open the cooling system while the engine is hot."), tr("Cần kiểm tra nguyên nhân trước khi tiếp tục hành trình.", "Find the cause before continuing the trip.")],
  };
}
