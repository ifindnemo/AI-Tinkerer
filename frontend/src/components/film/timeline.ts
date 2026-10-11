import type {Text} from "@/lib/preferences";

// These chapter starts follow the exported HyperFrames MP4, not a second playback clock.
export const TOTAL = 90;
export const CHAPTERS: readonly {id: string; start: number; title: Text; description: Text}[] = [
  {id: "opening", start: 0, title: {vi: "Cảnh báo sớm", en: "Early warning"}, description: {vi: "Trong kịch bản minh họa, nước làm mát nóng dần trước khi đèn báo sáng. Car Neuron đọc các tín hiệu để nhận ra xu hướng.", en: "In this illustrative scenario, coolant heats up before the warning light comes on. Car Neuron reads the signals to recognise the trend."}},
  {id: "blackbox", start: 7.5, title: {vi: "Blackbox", en: "Blackbox"}, description: {vi: "Blackbox kết nối với xe. Mỗi giây một bản ghi: vòng tua, tốc độ, tải, nhiệt độ và các tín hiệu được hỗ trợ.", en: "The blackbox connects to the car. One record per second: RPM, speed, load, temperature and the available signals."}},
  {id: "telemetry", start: 15.831, title: {vi: "Dữ liệu xe", en: "Telemetry"}, description: {vi: "Dashboard cập nhật liên tục, gom 15 mẫu thành một lô. Kịch bản này minh họa quạt ngừng quay và nhiệt độ tăng trong khi tải ổn định.", en: "The dashboard updates continuously and groups 15 samples into a batch. This scenario illustrates a stopped fan and rising temperature at a steady load."}},
  {id: "agent", start: 26.739, title: {vi: "Agent suy luận", en: "Agent reasoning"}, description: {vi: "Kiểm tra luật an toàn, thời tiết và lịch sử bảo dưỡng. Agent đối chiếu nhiều tín hiệu để phân biệt tác động của môi trường, tải động cơ và dấu hiệu lỗi.", en: "Check the safety rule, weather and service history. The agent compares multiple signals to distinguish environment, engine load and signs of a fault."}},
  {id: "advice", start: 44.192, title: {vi: "Đề xuất", en: "Recommendations"}, description: {vi: "Cảnh báo đi kèm bằng chứng, hướng dẫn dừng xe an toàn và garage gần xe. Ngưỡng 105°C / 120°C minh họa kịch bản, không phải ngưỡng áp dụng cho mọi xe.", en: "A warning comes with evidence, advice to stop safely and nearby garages. The 105°C / 120°C thresholds illustrate this scenario; they are not universal vehicle thresholds."}},
  {id: "camera", start: 55.1, title: {vi: "Camera tài xế", en: "Driver camera"}, description: {vi: "Theo dõi mắt và hướng đầu ngay trong trình duyệt. Nhắm mắt kéo dài kích hoạt cảnh báo tại chỗ mà không chờ agent; cảnh báo vẫn được giữ sau khi mắt mở lại.", en: "Track eyes and head direction in the browser. Prolonged eye closure triggers a local alert without waiting for the agent; the alert remains after the eyes reopen."}},
  {id: "privacy", start: 74.3, title: {vi: "Riêng tư", en: "Privacy"}, description: {vi: "Video ở lại trong tab, không ghi hay tải lên. Agent chỉ nhận JSON gồm sự hiện diện khuôn mặt, mắt, hướng đầu, trạng thái chú ý và độ tin cậy. Bản thử nghiệm không điều khiển xe hay gọi cứu hộ.", en: "Video stays in the tab and is not recorded or uploaded. The agent receives only JSON: face presence, eyes, head direction, attention and confidence. The prototype does not control the vehicle or make emergency calls."}},
  {id: "closing", start: 84.98, title: {vi: "Đồng hành", en: "One companion"}, description: {vi: "Car Neuron. Hiểu xe. Hiểu người lái. Đồng hành mỗi chuyến đi.", en: "Car Neuron. Understand the car. Understand the driver. A companion for every journey."}},
];

export const clampTime = (seconds: number) => Number.isFinite(seconds) ? Math.min(TOTAL, Math.max(0, seconds)) : 0;
export function chapterAt(seconds: number) {
  const time = clampTime(seconds);
  let index = 0;
  for (let i = 1; i < CHAPTERS.length && time >= CHAPTERS[i].start; i++) index = i;
  return index;
}
export const formatTime = (seconds: number) => {
  const s = Math.floor(clampTime(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
export function startFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get("t");
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? clampTime(value) : null;
}
