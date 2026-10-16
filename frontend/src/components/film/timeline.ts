import type {Text} from "@/lib/preferences";

// These chapter starts follow the exported HyperFrames MP4 (pitch slides 1, 3 and 4; the live demo is presented separately), not a second playback clock.
export const TOTAL = 210;
export const CHAPTERS: readonly {id: string; start: number; title: Text; description: Text}[] = [
  {id: "problem", start: 0, title: {vi: "Vấn đề", en: "The problem"}, description: {vi: "Đèn cảnh báo chỉ biết về chiếc xe, không biết ai đang lái. Trong kịch bản minh họa, nước làm mát nóng dần trong khi tài xế nhắm mắt lâu hơn.", en: "A warning light only knows about the car, not who is driving it. In this illustrative scenario, coolant climbs while the driver's eyes stay closed longer."}},
  {id: "built", start: 6.5, title: {vi: "Car Neuron", en: "What I built"}, description: {vi: "Blackbox gửi dữ liệu mỗi giây, webcam theo dõi tài xế ngay trong trình duyệt, một agent đọc cả hai và nói nên làm gì tiếp. Cùng một lỗi, lời khuyên khác nhau tùy tài xế.", en: "A blackbox streams engine data every second, a webcam watches the driver in the browser, and one agent reads both and says what to do next. Same fault, different advice depending on the driver."}},
  {id: "sensing", start: 30.5, title: {vi: "Cảm biến và riêng tư", en: "Sensing and privacy"}, description: {vi: "Trình duyệt tạo một bản ghi mỗi giây, 15 bản ghi thành một lô. Camera chạy MediaPipe tại chỗ; chỉ một sự kiện JSON nhỏ rời khỏi tab, schema từ chối mọi trường thừa. Dữ liệu xe là mô phỏng.", en: "The browser makes one record per second, and 15 records make a batch. The camera runs MediaPipe locally; only a small JSON event leaves the tab and the schema rejects any extra field. Car data is simulated."}},
  {id: "rules", start: 56.5, title: {vi: "Luật an toàn", en: "Safety rules"}, description: {vi: "Luật thuần túy đặt mức độ và bước bắt buộc, không chờ mô hình: nước làm mát 120 °C là nghiêm trọng. Chính sách Guardian được viết bằng Python và TypeScript, cùng kiểm thử với một bảng ca.", en: "Plain rules set the level and the mandatory step without waiting for a model: coolant at 120 °C is critical. The Guardian policy is written in Python and TypeScript and tested against one table of cases."}},
  {id: "agent", start: 79.4, title: {vi: "Agent và kế hoạch", en: "Agent and plan"}, description: {vi: "Một agent LLM gọi công cụ: thời tiết, lịch sử bảo dưỡng, gara gần đó, đề xuất đặt lịch chờ tài xế xác nhận. Kế hoạch kết hợp mức độ xe với trạng thái tài xế; Blaze đọc câu trả lời bằng ngôn ngữ của tài xế.", en: "An LLM agent calls tools: weather, service history, nearby garages and a booking proposal that waits for the driver. The plan combines car level with driver state; Blaze speaks the answer in the driver's language."}},
  {id: "challenges", start: 120.5, title: {vi: "Thử thách", en: "Challenges"}, description: {vi: "Tốc độ: agent mất 10–20 giây nên luật nói trước. Tiếng ồn: mỗi cảnh báo chỉ được đọc một lần mỗi đợt. Bất đồng: kế hoạch hỏi luật cứng về xe, không hỏi mô hình.", en: "Speed: the agent takes 10–20 seconds, so the rules speak first. Noise: each alert is spoken once per episode. Disagreement: the plan asks the hard rules about the car, not the model."}},
  {id: "small", start: 161.2, title: {vi: "Điều nhỏ và đánh đổi", en: "Small things, trade-offs"}, description: {vi: "Blaze trả về \"quá sớm\" cho đến khi âm thanh sẵn sàng; mỗi ngôn ngữ có agent và giọng riêng; robot cạnh xe 3D làm chậm điều hướng khi không có GPU. Chọn mô hình giọng pro, sửa độ trễ ở chỗ khác.", en: "Blaze answers \"too early\" until audio is ready; each language gets its own agent and voice; a robot beside the 3D car slows navigation without a GPU. The pro voice model was chosen and latency fixed elsewhere."}},
  {id: "next", start: 192.9, title: {vi: "Tiếp theo", en: "Next"}, description: {vi: "Một chiếc xe thật qua cổng OBD, kiểm tra quay đầu trên khuôn mặt thật, một lần gọi LLM sau các công cụ. Để luật canh gác, để mô hình giải thích. Bản thử nghiệm không điều khiển xe hay gọi cứu hộ.", en: "A real car through the OBD gateway, head-turn checks on real faces, and one LLM call after the tools. Let rules guard, let the model explain. The prototype does not control the vehicle or make emergency calls."}},
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
