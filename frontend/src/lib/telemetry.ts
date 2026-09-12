import { getVehicle, type Powertrain } from "./vehicles";
export type ScenarioId = "normal" | "environment" | "engine" | "offline";
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
export const scenarios: { id: ScenarioId; label: string }[] = [
  { id: "normal", label: "Vận hành bình thường" },
  { id: "environment", label: "Thời tiết nắng nóng" },
  { id: "engine", label: "Động cơ quá nhiệt" },
  { id: "offline", label: "Mất kết nối blackbox" },
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
    coolant: 94,
    oil: 101,
    ambient: 31,
    intake: 38,
    rpm: 820,
    speed: 0,
    battery: 14.2,
    fuel: 68,
    coolantTrend: 0.2,
    fan: 35,
    dtc: [],
    location: {
      name: "Thảo Điền, TP. Hồ Chí Minh",
      lat: 10.8023,
      lon: 106.7328,
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
      "Không nhận được dữ liệu blackbox. Hãy chọn kịch bản có kết nối và thử lại.",
    );
  const time = Date.parse(t.capturedAt);
  if (!Number.isFinite(time) || Date.now() - time > 60_000)
    throw new Error("Dữ liệu đã cũ. Hãy đồng bộ blackbox và thử lại.");
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
    throw new Error("Dữ liệu cảm biến không hợp lệ.");
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
        "Thiếu hoặc sai dữ liệu pin/motor. Không thể đánh giá xe điện.",
      );
    if (pack.batteryTemp >= 50 || pack.motorTemp >= 90 || pack.batteryTrend > 2)
      return {
        ...common,
        severity: "critical",
        score: 40,
        cause: "traction",
        title: "Dấu hiệu quá nhiệt pin / motor",
        summary:
          "Nhiệt độ hệ truyền động điện vượt ngưỡng mô phỏng và tăng nhanh. Mức nhiệt môi trường chưa giải thích được tình trạng này.",
        evidence: [
          `Pin ${pack.batteryTemp}°C · tăng ${pack.batteryTrend}°C/phút`,
          `Motor ${pack.motorTemp}°C · môi trường ${t.ambient}°C`,
          `Quạt ${t.fan}% · cảnh báo BMS mô phỏng`,
        ],
        recommendations: [
          "Dừng xe ở vị trí an toàn và kết thúc phiên sạc nếu đang sạc.",
          "Không tự tháo, chạm hoặc sửa các bộ phận điện cao áp.",
          "Liên hệ trung tâm dịch vụ để kiểm tra pin và hệ thống làm mát.",
        ],
      };
    if (t.ambient >= 35 && pack.batteryTemp >= 38)
      return {
        ...common,
        severity: "watch",
        score: 85,
        cause: "environment",
        title: "Pin ấm hơn do môi trường",
        summary:
          "Pin ấm lên cùng thời tiết, nhưng xu hướng nhiệt đang ổn định. Chưa có dấu hiệu tăng nhiệt bất thường trong dữ liệu mô phỏng.",
        evidence: [
          `Ngoài trời ${t.ambient}°C · pin ${pack.batteryTemp}°C`,
          `Xu hướng pin ${pack.batteryTrend}°C/phút · motor ${pack.motorTemp}°C`,
          `SOC ${pack.soc}% · không ghi nhận cảnh báo BMS`,
        ],
        recommendations: [
          "Đỗ xe nơi thoáng và có bóng râm khi phù hợp.",
          "Theo dõi nhiệt độ pin trong hành trình và phiên sạc tiếp theo.",
        ],
      };
    return {
      ...common,
      severity: "good",
      score: 98,
      cause: "normal",
      title: "Hệ truyền động điện đang ổn định",
      summary:
        "Nhiệt độ pin và motor ổn định trong kịch bản mô phỏng hiện tại. Xe điện được đánh giá bằng cảm biến pin/motor, không sử dụng dầu máy hoặc nhiên liệu.",
      evidence: [
        `Pin ${pack.batteryTemp}°C · motor ${pack.motorTemp}°C`,
        `SOC ${pack.soc}% · SOH mô phỏng ${pack.soh}%`,
        `Ngoài trời ${t.ambient}°C · không ghi nhận cảnh báo BMS`,
      ],
      recommendations: [
        "Theo dõi tình trạng pin và bảo dưỡng theo hướng dẫn của hãng.",
        "Kiểm tra dữ liệu trước chuyến đi và khi sạc xe.",
      ],
    };
  }
  if (t.coolant >= 115 || t.coolantTrend > 2 || t.dtc.includes("P0217"))
    return {
      ...common,
      severity: "critical",
      score: 42,
      cause: "engine",
      title: "Dấu hiệu quá nhiệt động cơ",
      summary:
        "Nhiệt độ nước làm mát tăng nhanh, không phù hợp với mức nhiệt môi trường. Cần kiểm tra hệ thống làm mát.",
      evidence: [
        `Nước làm mát ${t.coolant}°C · tăng ${t.coolantTrend}°C/phút`,
        `Môi trường ${t.ambient}°C chưa giải thích được mức tăng này`,
        `Quạt làm mát ${t.fan}%${t.dtc.length ? ` · mã lỗi ${t.dtc.join(", ")}` : ""}`,
      ],
      recommendations: [
        "Dừng xe ở vị trí an toàn, tắt động cơ và để xe nguội.",
        "Không mở nắp bình nước làm mát khi động cơ còn nóng.",
        "Liên hệ kỹ thuật viên để kiểm tra quạt, bơm nước và rò rỉ.",
      ],
    };
  if (t.ambient >= 35 && t.coolant >= 100)
    return {
      ...common,
      severity: "watch",
      score: 86,
      cause: "environment",
      title: "Nhiệt độ cao do môi trường",
      summary:
        "Thời tiết nóng làm tăng nhiệt khoang máy. Nước làm mát đang ổn định, chưa ghi nhận dấu hiệu quá nhiệt động cơ trong dữ liệu mô phỏng.",
      evidence: [
        `Nhiệt độ ngoài trời ${t.ambient}°C · thời tiết mô phỏng theo GPS`,
        `Nước làm mát ${t.coolant}°C · chỉ tăng ${t.coolantTrend}°C/phút`,
        `Quạt ${t.fan}% · không ghi nhận mã lỗi OBD`,
      ],
      recommendations: [
        "Ưu tiên đỗ xe ở nơi có bóng râm, thông thoáng.",
        "Theo dõi xu hướng nhiệt độ khi tiếp tục hành trình.",
        "Kiểm tra mức nước làm mát khi động cơ đã nguội.",
      ],
    };
  return {
    ...common,
    severity: "good",
    score: 98,
    cause: "normal",
    title: "Chiếc xe đang ở trạng thái tốt",
    summary:
      "Nhiệt độ động cơ ổn định trong bối cảnh môi trường hiện tại. Không ghi nhận bất thường trong các cảm biến mô phỏng.",
    evidence: [
      `Nước làm mát ${t.coolant}°C · xu hướng ổn định`,
      `Môi trường ${t.ambient}°C · nhiệt khí nạp ${t.intake}°C`,
      `Điện áp ${t.battery} V · không có mã lỗi OBD`,
    ],
    recommendations: [
      "Duy trì lịch bảo dưỡng định kỳ của xe.",
      "Tiếp tục theo dõi dữ liệu trước mỗi hành trình.",
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
