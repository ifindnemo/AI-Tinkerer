import type {ReactNode} from "react";
import {CalendarPlus, CloudSun, Gavel, ListChecks, MapPin, ShieldAlert, Wrench} from "lucide-react";
import type {Severity} from "@/lib/backend/contract";
import type {ToolStep} from "@/lib/backend/tool-insights";

export type T = (vi: string, en: string) => string;
export const severityLabel = (s: Severity, t: T) => s === "critical" ? t("Nguy hiểm", "Critical") : s === "warning" ? t("Cảnh báo", "Warning") : t("Bình thường", "Normal");
export const dateOf = (value: string | undefined, locale: string) => {
  if (!value) return "—";
  const d = new Date(`${value}T00:00:00`);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString(locale) : value;
};
export const slotText = (slot: string | undefined, locale: string) => {
  const d = slot ? new Date(slot) : null;
  return d && Number.isFinite(d.getTime()) ? d.toLocaleString(locale, {weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"}) : "—";
};

export type StepView = {icon: ReactNode; title: string; detail: string; ok: boolean; warn?: boolean};

/** One line of "what the agent did" for a tool call, used by the agent panel and the robot's popup. */
export function stepView(s: ToolStep, t: T, lang: string): StepView {
  const locale = lang === "en" ? "en-GB" : "vi-VN";
  const unavailable = t("Chưa lấy được dữ liệu", "Data unavailable");
  switch (s.kind) {
    case "guardrail": return {icon: <ShieldAlert size={13} />, title: t("Luật an toàn cứng (backend)", "Hard safety rule (backend)"), detail: s.triggered ? `${t("Kích hoạt · tối thiểu", "Triggered · minimum")} ${severityLabel(s.minimum, t).toLowerCase()}${s.reasons.length ? ` · ${s.reasons.join(" ")}` : ""}` : t("Không kích hoạt", "Not triggered"), ok: true, warn: s.triggered};
    case "weather": return {icon: <CloudSun size={13} />, title: t("Thời tiết tại vị trí xe", "Weather at the car"), detail: s.ok ? `${s.temperature}°C · Open-Meteo` : unavailable, ok: s.ok};
    case "history": return {icon: <Wrench size={13} />, title: t("Lịch sử bảo dưỡng", "Service history"), detail: s.ok ? t(`${s.total ?? 0} lần ghi nhận · gần nhất ${dateOf(s.lastDate, locale)}`, `${s.total ?? 0} records · latest ${dateOf(s.lastDate, locale)}`) : unavailable, ok: s.ok};
    case "garages": return {icon: <MapPin size={13} />, title: t("Tìm garage gần xe", "Nearby garage search"), detail: s.ok ? t(`${s.count ?? 0} địa điểm${s.radiusKm ? ` trong ${s.radiusKm} km` : ""}`, `${s.count ?? 0} places${s.radiusKm ? ` within ${s.radiusKm} km` : ""}`) : unavailable, ok: s.ok};
    case "booking": return {icon: <CalendarPlus size={13} />, title: t("Đề xuất đặt lịch", "Appointment proposal"), detail: s.ok ? `${s.garage ?? ""} · ${slotText(s.slot, locale)} · ${t("chờ bạn xác nhận", "waiting for your confirmation")}` : unavailable, ok: s.ok};
    case "other": return {icon: <ListChecks size={13} />, title: s.name, detail: s.ok ? "OK" : unavailable, ok: s.ok};
    case "verdict": return {icon: <Gavel size={13} />, title: t("Kết luận của agent", "Agent verdict"), detail: `${severityLabel(s.severity, t)} · ${t("độ tin cậy", "confidence")} ${Math.round(s.confidence * 100)}%`, ok: true, warn: s.severity !== "normal"};
  }
}
