import type { Analysis } from "./telemetry";

export type ServiceAssessment = Omit<Analysis, "score">;

export const bookingStorageKey = "autolink.service-bookings.v1";
export const garages = [
  { id: "cooling-lab", name: "Cooling Lab", area: "Khu vực Thảo Điền", specialty: "Hệ thống làm mát · động cơ", description: "Phù hợp kiểm tra quạt, bơm nước và rò rỉ khi có dấu hiệu quá nhiệt.", causes: ["engine", "environment"] },
  { id: "auto-care", name: "Auto Care Studio", area: "Khu vực An Phú", specialty: "Chẩn đoán tổng quát · bảo dưỡng", description: "Phù hợp kiểm tra cảm biến và theo dõi tình trạng vận hành.", causes: ["environment", "normal", "unclassified"] },
  { id: "ev-service", name: "EV Service Lab", area: "Khu vực Bình Thạnh", specialty: "Pin · motor · làm mát xe điện", description: "Phù hợp kiểm tra hệ truyền động điện và hệ thống quản lý nhiệt.", causes: ["traction"] },
] as const;
export const appointmentSlots = ["09:00", "11:00", "14:00", "16:00"];
export type Booking = {
  id: string; vehicleId: string; vehicleName: string; reportId: string;
  cause: Analysis["cause"]; issue: string; severity: Analysis["severity"];
  garageId: string; date: string; time: string; createdAt: string;
  status: "saved" | "cancelled";
};
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function dateBounds(now = new Date()) {
  const first = new Date(now); first.setDate(first.getDate() + 1);
  const last = new Date(now); last.setDate(last.getDate() + 14);
  return { min: localDate(first), max: localDate(last) };
}
export function validateAppointment(garageId: string, date: string, time: string, now = new Date()) {
  const bounds = dateBounds(now);
  if (!garages.some(garage => garage.id === garageId)) throw new Error("Hãy chọn garage.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < bounds.min || date > bounds.max || localDate(new Date(`${date}T12:00:00`)) !== date)
    throw new Error("Chọn ngày hợp lệ từ ngày mai đến 14 ngày tới.");
  if (!appointmentSlots.includes(time)) throw new Error("Hãy chọn khung giờ hợp lệ.");
}
export function decodeBookings(raw: string | null): Booking[] {
  if (!raw) return [];
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data) || data.length > 100 || !data.every(isBooking)) throw new Error("Dữ liệu lịch hẹn đã lưu không hợp lệ.");
  return data;
}
function isBooking(value: unknown): value is Booking {
  if (!value || typeof value !== "object") return false;
  const b = value as Record<string, unknown>;
  const strings = ["id", "vehicleId", "vehicleName", "reportId", "issue", "date", "time", "createdAt"];
  return strings.every(key => typeof b[key] === "string" && (b[key] as string).length > 0)
    && ["saved", "cancelled"].includes(String(b.status))
    && ["normal", "engine", "environment", "traction", "unclassified"].includes(String(b.cause))
    && ["good", "watch", "critical"].includes(String(b.severity))
    && garages.some(garage => garage.id === b.garageId)
    && /^\d{4}-\d{2}-\d{2}$/.test(String(b.date))
    && appointmentSlots.includes(String(b.time));
}
export function createBooking(analysis: ServiceAssessment, garageId: string, date: string, time: string, existing: Booking[], now = new Date()): Booking {
  if (analysis.severity === "good") throw new Error("Không có cảnh báo cần đặt lịch sửa chữa.");
  validateAppointment(garageId, date, time, now);
  if (existing.some(item => item.status === "saved" && item.vehicleId === analysis.vehicleId && item.cause === analysis.cause && new Date(`${item.date}T${item.time}`).getTime() > now.getTime()))
    throw new Error("Xe đã có lịch cho tình trạng này. Kiểm tra hoặc hủy lịch cũ trước khi tạo lịch khác.");
  return {id: crypto.randomUUID(), vehicleId: analysis.vehicleId, vehicleName: analysis.vehicleName, reportId: analysis.id, cause: analysis.cause, issue: analysis.title, severity: analysis.severity, garageId, date, time, createdAt: now.toISOString(), status: "saved"};
}
