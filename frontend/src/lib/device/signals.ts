import type {Text} from "../preferences";
import type {SignalName} from "./types";

// Display metadata, in the order the backend lists signals (backend/telemetry/signals.py).
export const SIGNALS: {name: SignalName; pid: string; label: Text; unit: string; digits: number}[] = [
  {name: "rpm", pid: "010C", label: {vi: "Vòng tua", en: "Engine speed"}, unit: "rpm", digits: 0},
  {name: "speed", pid: "010D", label: {vi: "Tốc độ", en: "Speed"}, unit: "km/h", digits: 0},
  {name: "engineLoad", pid: "0104", label: {vi: "Tải động cơ", en: "Engine load"}, unit: "%", digits: 1},
  {name: "coolant", pid: "0105", label: {vi: "Nước làm mát", en: "Coolant"}, unit: "°C", digits: 1},
  {name: "intake", pid: "010F", label: {vi: "Nhiệt độ khí nạp", en: "Intake air"}, unit: "°C", digits: 0},
  {name: "map", pid: "010B", label: {vi: "Áp suất đường nạp (MAP)", en: "Manifold pressure (MAP)"}, unit: "kPa", digits: 0},
  {name: "maf", pid: "0110", label: {vi: "Lưu lượng khí nạp (MAF)", en: "Mass air flow (MAF)"}, unit: "g/s", digits: 1},
  {name: "tps", pid: "0111", label: {vi: "Vị trí bướm ga", en: "Throttle position"}, unit: "%", digits: 1},
  {name: "stft1", pid: "0106", label: {vi: "Fuel trim ngắn hạn B1", en: "Short-term fuel trim B1"}, unit: "%", digits: 1},
  {name: "ltft1", pid: "0107", label: {vi: "Fuel trim dài hạn B1", en: "Long-term fuel trim B1"}, unit: "%", digits: 1},
  {name: "battery", pid: "0142", label: {vi: "Điện áp hệ thống", en: "System voltage"}, unit: "V", digits: 2},
  {name: "oil", pid: "015C", label: {vi: "Nhiệt độ dầu", en: "Oil temperature"}, unit: "°C", digits: 0},
  {name: "fuel", pid: "012F", label: {vi: "Mức nhiên liệu", en: "Fuel level"}, unit: "%", digits: 0},
  {name: "ambient", pid: "0146", label: {vi: "Nhiệt độ ngoài trời (cảm biến xe)", en: "Outside air (car sensor)"}, unit: "°C", digits: 0},
];
export const SIGNAL = Object.fromEntries(SIGNALS.map(signal => [signal.name, signal])) as Record<SignalName, (typeof SIGNALS)[number]>;

export const formatSignal = (name: SignalName, value: number | undefined) =>
  value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(SIGNAL[name].digits);
