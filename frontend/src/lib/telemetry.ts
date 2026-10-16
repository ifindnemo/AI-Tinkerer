import { getVehicle, type Powertrain } from "./vehicles";
import { tr, type Text } from "./preferences";
export type ScenarioId = "normal" | "warm" | "environment" | "engine" | "offline";
export type Telemetry = {
  scenario: ScenarioId;
  vehicleId: string;
  powertrain: Powertrain;
  traction?: {
    batteryTemp: number;
    motorTemp: number;
    soc: number;
    soh: number;
    batteryTrend: number;
  };
  operatingSource?: "excel-range" | "scenario";
  map?: number;
  tps?: number;
  engineLoad?: number;
  consumption?: number;
  fault?: 0 | 1 | 2 | 3;
  capturedAt: string;
  coolant: number;
  oil: number;
  ambient: number;
  intake: number;
  rpm: number;
  speed: number;
  battery: number;
  fuel: number;
  coolantTrend: number;
  fan: number;
  dtc: string[];
  location: { name: string; lat: number; lon: number };
  connected: boolean;
};
export type Analysis = {
  id: string;
  vehicleId: string;
  vehicleName: string;
  powertrain: Powertrain;
  createdAt: string;
  severity: "good" | "watch" | "critical";
  score: number | null;
  source?: "backend";
  cause: "normal" | "environment" | "engine" | "traction" | "unclassified";
  title: string;
  summary: string;
  evidence: string[];
  recommendations: string[];
};
export const scenarios: { id: ScenarioId; label: Text }[] = [
  { id: "normal", label: {vi: "Vận hành bình thường", en: "Normal driving"} },
  { id: "warm", label: {vi: "Nóng nhẹ, đang chạy (kịch bản camera)", en: "Running warm (camera scenario)"} },
  { id: "environment", label: {vi: "Thời tiết nắng nóng", en: "Hot weather"} },
  { id: "engine", label: {vi: "Động cơ quá nhiệt", en: "Engine overheating"} },
  { id: "offline", label: {vi: "Mất kết nối blackbox", en: "Blackbox disconnected"} },
];
export function getMockTelemetry(
  scenario: ScenarioId,
  vehicleId = "bmw-m2",
): Telemetry {
  const vehicle = getVehicle(vehicleId);
  const base: Telemetry = {
    scenario,
    vehicleId: vehicle.id,
    powertrain: vehicle.powertrain,
    capturedAt: new Date().toISOString(),
    coolant: 88,
    oil: 94,
    ambient: 31,
    intake: 34,
    rpm: 820,
    speed: 0,
    battery: 14.2,
    fuel: 68,
    coolantTrend: 0,
    fan: 0,
    dtc: [],
    location: {
      name: "2 Như Nguyệt, Hải Châu, Đà Nẵng",
      lat: 16.0878,
      lon: 108.221,
    },
    connected: true,
  };
  if (vehicle.powertrain === "ev") {
    const ev: Telemetry = {
      ...base,
      coolant: 32,
      oil: 0,
      intake: 0,
      rpm: 0,
      fuel: 0,
      connected: scenario !== "offline",
      traction: {
        batteryTemp: 32,
        motorTemp: 48,
        soc: 68,
        soh: 98,
        batteryTrend: 0.1,
      },
    };
    if (scenario === "environment")
      return {
        ...ev,
        ambient: 39,
        coolant: 39,
        fan: 75,
        traction: {
          ...ev.traction!,
          batteryTemp: 41,
          motorTemp: 58,
          batteryTrend: 0.3,
        },
      };
    if (scenario === "engine")
      return {
        ...ev,
        coolant: 51,
        fan: 98,
        dtc: ["BMS_TEMP_DEMO"],
        traction: {
          ...ev.traction!,
          batteryTemp: 58,
          motorTemp: 98,
          batteryTrend: 3.2,
        },
      };
    return ev;
  }
  if (scenario === "warm")
    return {...base, coolant: 107, oil: 114, fan: 35, speed: 65, rpm: 2500, coolantTrend: 0.2};
  if (scenario === "environment")
    return {
      ...base,
      coolant: 104,
      oil: 111,
      ambient: 39,
      intake: 49,
      fan: 72,
      coolantTrend: 0.4,
    };
  if (scenario === "engine")
    return {
      ...base,
      coolant: 121,
      oil: 132,
      ambient: 31,
      intake: 45,
      fan: 98,
      coolantTrend: 3.8,
      dtc: ["P0217"],
    };
  if (scenario === "offline") return { ...base, connected: false };
  return base;
}
// Demo heuristics, not BMW diagnostic specifications. Replace with the backend agent.
export function analyzeTelemetry(t: Telemetry): Analysis {
  if (!t.connected)
    throw new Error(
      tr("Không nhận được dữ liệu blackbox. Hãy chọn kịch bản có kết nối và thử lại.", "No blackbox data received. Pick a connected scenario and try again."),
    );
  const time = Date.parse(t.capturedAt);
  if (!Number.isFinite(time) || Date.now() - time > 60_000)
    throw new Error(tr("Dữ liệu đã cũ. Hãy đồng bộ blackbox và thử lại.", "The data is stale. Sync the blackbox and try again."));
  const values = [
    t.coolant,
    t.oil,
    t.ambient,
    t.intake,
    t.rpm,
    t.coolantTrend,
    t.fan,
  ];
  if (values.some((v) => !Number.isFinite(v)))
    throw new Error(tr("Dữ liệu cảm biến không hợp lệ.", "Invalid sensor data."));
  const common = {
    id: crypto.randomUUID(),
    vehicleId: t.vehicleId,
    vehicleName: `${getVehicle(t.vehicleId).brand} ${getVehicle(t.vehicleId).name}`,
    powertrain: t.powertrain,
    createdAt: new Date().toISOString(),
  };
  if (t.powertrain === "ev") {
    const pack = t.traction;
    if (!pack || Object.values(pack).some((value) => !Number.isFinite(value)))
      throw new Error(
        tr("Thiếu hoặc sai dữ liệu pin/motor. Không thể đánh giá xe điện.", "Battery/motor data is missing or invalid. Cannot assess the EV."),
      );
    if (pack.batteryTemp >= 50 || pack.motorTemp >= 90 || pack.batteryTrend > 2)
      return {
        ...common,
        severity: "critical",
        score: 40,
        cause: "traction",
        title: tr("Dấu hiệu quá nhiệt pin / motor", "Battery / motor overheating signs"),
        summary: tr(
          "Nhiệt độ hệ truyền động điện vượt ngưỡng mô phỏng và tăng nhanh. Mức nhiệt môi trường chưa giải thích được tình trạng này.",
          "Electric drivetrain temperature exceeds the simulated limit and is rising fast. Ambient temperature does not explain it."),
        evidence: [
          tr(`Pin ${pack.batteryTemp}°C · tăng ${pack.batteryTrend}°C/phút`, `Battery ${pack.batteryTemp}°C · rising ${pack.batteryTrend}°C/min`),
          tr(`Motor ${pack.motorTemp}°C · môi trường ${t.ambient}°C`, `Motor ${pack.motorTemp}°C · ambient ${t.ambient}°C`),
          tr(`Quạt ${t.fan}% · cảnh báo BMS mô phỏng`, `Fan ${t.fan}% · simulated BMS warning`),
        ],
        recommendations: [
          tr("Dừng xe ở vị trí an toàn và kết thúc phiên sạc nếu đang sạc.", "Stop in a safe place and end any charging session."),
          tr("Không tự tháo, chạm hoặc sửa các bộ phận điện cao áp.", "Do not open, touch or repair high-voltage parts."),
          tr("Liên hệ trung tâm dịch vụ để kiểm tra pin và hệ thống làm mát.", "Contact a service centre to inspect the battery and cooling system."),
        ],
      };
    if (t.ambient >= 35 && pack.batteryTemp >= 38)
      return {
        ...common,
        severity: "watch",
        score: 85,
        cause: "environment",
        title: tr("Pin ấm hơn do môi trường", "Battery warmer due to weather"),
        summary: tr(
          "Pin ấm lên cùng thời tiết, nhưng xu hướng nhiệt đang ổn định. Chưa có dấu hiệu tăng nhiệt bất thường trong dữ liệu mô phỏng.",
          "The battery warms with the weather, but the trend is stable. No abnormal heating in the simulated data."),
        evidence: [
          tr(`Ngoài trời ${t.ambient}°C · pin ${pack.batteryTemp}°C`, `Outside ${t.ambient}°C · battery ${pack.batteryTemp}°C`),
          tr(`Xu hướng pin ${pack.batteryTrend}°C/phút · motor ${pack.motorTemp}°C`, `Battery trend ${pack.batteryTrend}°C/min · motor ${pack.motorTemp}°C`),
          tr(`SOC ${pack.soc}% · không ghi nhận cảnh báo BMS`, `SOC ${pack.soc}% · no BMS warning`),
        ],
        recommendations: [
          tr("Đỗ xe nơi thoáng và có bóng râm khi phù hợp.", "Park in a ventilated, shaded spot when possible."),
          tr("Theo dõi nhiệt độ pin trong hành trình và phiên sạc tiếp theo.", "Watch battery temperature on the next drive and charge."),
        ],
      };
    return {
      ...common,
      severity: "good",
      score: 98,
      cause: "normal",
      title: tr("Hệ truyền động điện đang ổn định", "Electric drivetrain is stable"),
      summary: tr(
        "Nhiệt độ pin và motor ổn định trong kịch bản mô phỏng hiện tại. Xe điện được đánh giá bằng cảm biến pin/motor, không sử dụng dầu máy hoặc nhiên liệu.",
        "Battery and motor temperatures are stable in this simulated scenario. EVs are assessed from battery/motor sensors, not oil or fuel."),
      evidence: [
        tr(`Pin ${pack.batteryTemp}°C · motor ${pack.motorTemp}°C`, `Battery ${pack.batteryTemp}°C · motor ${pack.motorTemp}°C`),
        tr(`SOC ${pack.soc}% · SOH mô phỏng ${pack.soh}%`, `SOC ${pack.soc}% · simulated SOH ${pack.soh}%`),
        tr(`Ngoài trời ${t.ambient}°C · không ghi nhận cảnh báo BMS`, `Outside ${t.ambient}°C · no BMS warning`),
      ],
      recommendations: [
        tr("Theo dõi tình trạng pin và bảo dưỡng theo hướng dẫn của hãng.", "Monitor battery health and follow the manufacturer service plan."),
        tr("Kiểm tra dữ liệu trước chuyến đi và khi sạc xe.", "Check the data before trips and while charging."),
      ],
    };
  }
  if (t.coolant >= 115 || t.coolantTrend > 2 || t.dtc.includes("P0217"))
    return {
      ...common,
      severity: "critical",
      score: 42,
      cause: "engine",
      title: tr("Dấu hiệu quá nhiệt động cơ", "Engine overheating signs"),
      summary: tr(
        "Nhiệt độ nước làm mát tăng nhanh, không phù hợp với mức nhiệt môi trường. Cần kiểm tra hệ thống làm mát.",
        "Coolant temperature is rising fast and is not explained by the weather. The cooling system needs checking."),
      evidence: [
        tr(`Nước làm mát ${t.coolant}°C · tăng ${t.coolantTrend}°C/phút`, `Coolant ${t.coolant}°C · rising ${t.coolantTrend}°C/min`),
        tr(`Môi trường ${t.ambient}°C chưa giải thích được mức tăng này`, `Ambient ${t.ambient}°C does not explain this rise`),
        tr(`Quạt làm mát ${t.fan}%${t.dtc.length ? ` · mã lỗi ${t.dtc.join(", ")}` : ""}`, `Cooling fan ${t.fan}%${t.dtc.length ? ` · DTC ${t.dtc.join(", ")}` : ""}`),
      ],
      recommendations: [
        tr("Dừng xe ở vị trí an toàn, tắt động cơ và để xe nguội.", "Stop in a safe place, switch off the engine and let it cool."),
        tr("Không mở nắp bình nước làm mát khi động cơ còn nóng.", "Do not open the coolant cap while the engine is hot."),
        tr("Liên hệ kỹ thuật viên để kiểm tra quạt, bơm nước và rò rỉ.", "Have a technician check the fan, water pump and leaks."),
      ],
    };
  if (t.ambient >= 35 && t.coolant >= 100)
    return {
      ...common,
      severity: "watch",
      score: 86,
      cause: "environment",
      title: tr("Nhiệt độ cao do môi trường", "High temperature due to weather"),
      summary: tr(
        "Thời tiết nóng làm tăng nhiệt khoang máy. Nước làm mát đang ổn định, chưa ghi nhận dấu hiệu quá nhiệt động cơ trong dữ liệu mô phỏng.",
        "Hot weather raises engine bay temperature. Coolant is stable; no engine overheating in the simulated data."),
      evidence: [
        tr(`Nhiệt độ ngoài trời ${t.ambient}°C · thời tiết mô phỏng theo GPS`, `Outside ${t.ambient}°C · GPS-based simulated weather`),
        tr(`Nước làm mát ${t.coolant}°C · chỉ tăng ${t.coolantTrend}°C/phút`, `Coolant ${t.coolant}°C · only rising ${t.coolantTrend}°C/min`),
        tr(`Quạt ${t.fan}% · không ghi nhận mã lỗi OBD`, `Fan ${t.fan}% · no OBD fault codes`),
      ],
      recommendations: [
        tr("Ưu tiên đỗ xe ở nơi có bóng râm, thông thoáng.", "Prefer shaded, ventilated parking."),
        tr("Theo dõi xu hướng nhiệt độ khi tiếp tục hành trình.", "Watch the temperature trend as you continue."),
        tr("Kiểm tra mức nước làm mát khi động cơ đã nguội.", "Check the coolant level once the engine is cold."),
      ],
    };
  return {
    ...common,
    severity: "good",
    score: 98,
    cause: "normal",
    title: tr("Chiếc xe đang ở trạng thái tốt", "Your car is in good shape"),
    summary: tr(
      "Nhiệt độ động cơ ổn định trong bối cảnh môi trường hiện tại. Không ghi nhận bất thường trong các cảm biến mô phỏng.",
      "Engine temperature is stable for the current conditions. No anomalies in the simulated sensors."),
    evidence: [
      tr(`Nước làm mát ${t.coolant}°C · xu hướng ổn định`, `Coolant ${t.coolant}°C · stable trend`),
      tr(`Môi trường ${t.ambient}°C · nhiệt khí nạp ${t.intake}°C`, `Ambient ${t.ambient}°C · intake air ${t.intake}°C`),
      tr(`Điện áp ${t.battery} V · không có mã lỗi OBD`, `Voltage ${t.battery} V · no OBD fault codes`),
    ],
    recommendations: [
      tr("Duy trì lịch bảo dưỡng định kỳ của xe.", "Keep up with scheduled maintenance."),
      tr("Tiếp tục theo dõi dữ liệu trước mỗi hành trình.", "Keep checking the data before each trip."),
    ],
  };
}
export async function fetchTelemetry(
  scenario: ScenarioId,
  signal?: AbortSignal,
  vehicleId = "bmw-m2",
): Promise<Telemetry> {
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, 1000);
    signal?.addEventListener("abort", abort, { once: true });
  });
  return getMockTelemetry(scenario, vehicleId);
}
