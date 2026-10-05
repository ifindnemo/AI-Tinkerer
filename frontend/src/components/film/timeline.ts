import type {Text} from "@/lib/preferences";

// The intro film is a pure function of time: every scene renders from its local
// second, so the player can pause, seek and screenshot any frame deterministically.

export type SceneId = "intro" | "problem" | "signals" | "batch" | "agent" | "warning" | "action" | "outro";
export type Cue = {at: number; text: Text};
export type Scene = {id: SceneId; duration: number; title: Text; captions: readonly Cue[]};

export const SCENES: readonly Scene[] = [
  {id: "intro", duration: 6, title: {vi: "Mở đầu", en: "Opening"}, captions: [
    {at: 1.4, text: {vi: "Một agent sống bên trong chiếc xe, không phải một chatbot.", en: "An agent that lives inside the car, not a chatbot."}},
  ]},
  {id: "problem", duration: 11, title: {vi: "Vấn đề", en: "The problem"}, captions: [
    {at: 0.4, text: {vi: "Xe đang chạy 60 km/h, tải động cơ ổn định.", en: "The car cruises at 60 km/h on a steady load."}},
    {at: 3.2, text: {vi: "Nước làm mát nóng dần, nhưng quạt không hề quay.", en: "Coolant keeps heating up, yet the fan never turns."}},
    {at: 8.6, text: {vi: "Đèn báo chỉ sáng khi đã chạm ngưỡng 120°C.", en: "The warning light only comes on at 120°C."}},
  ]},
  {id: "signals", duration: 11, title: {vi: "Tín hiệu", en: "Signals"}, captions: [
    {at: 0.4, text: {vi: "Blackbox đọc ECU mỗi giây.", en: "The blackbox reads the ECU every second."}},
    {at: 4.2, text: {vi: "Nhiệt độ, quạt, tải, vòng tua, tốc độ và vị trí, cùng một lúc.", en: "Temperature, fan, load, RPM, speed and location, all at once."}},
    {at: 7.6, text: {vi: "Mỗi giây thành một bản ghi.", en: "Every second becomes one record."}},
  ]},
  {id: "batch", duration: 10, title: {vi: "Gom lô", en: "Batching"}, captions: [
    {at: 0.4, text: {vi: "15 bản ghi được gom thành một lô và gửi qua gateway.", en: "Fifteen records form a batch that goes through the gateway."}},
    {at: 5.8, text: {vi: "Khi kịch bản đổi, lô đầu chỉ cần 5 mẫu để agent phản ứng sớm.", en: "After a scenario change the first batch closes at 5 samples, so the agent reacts sooner."}},
  ]},
  {id: "agent", duration: 13, title: {vi: "Agent suy luận", en: "Agent reasoning"}, captions: [
    {at: 0.4, text: {vi: "Backend kiểm tra luật an toàn cứng trước tiên.", en: "The backend applies its hard safety rule first."}},
    {at: 2.8, text: {vi: "Rồi agent gọi công cụ: thời tiết, lịch sử bảo dưỡng, garage gần xe.", en: "Then the agent calls tools: weather, service history, nearby garages."}},
    {at: 8.6, text: {vi: "Và đối chiếu nhiều tín hiệu cùng lúc, thay vì một ngưỡng duy nhất.", en: "And weighs several signals together instead of a single threshold."}},
  ]},
  {id: "warning", duration: 12, title: {vi: "Cảnh báo sớm", en: "Early warning"}, captions: [
    {at: 0.4, text: {vi: "Agent cảnh báo khi xu hướng đã rõ, quanh 105°C…", en: "The agent warns once the trend is clear, around 105°C…"}},
    {at: 7.4, text: {vi: "…trước khi luật cứng 120°C kịp kích hoạt.", en: "…before the 120°C hard rule fires."}},
  ]},
  {id: "action", duration: 10, title: {vi: "Hành động", en: "Action"}, captions: [
    {at: 0.4, text: {vi: "Kết luận đi kèm bằng chứng, đề xuất và garage gần nhất.", en: "The verdict comes with evidence, advice and the nearest garages."}},
    {at: 5.6, text: {vi: "Người lái là người quyết định bước tiếp theo.", en: "The driver decides what happens next."}},
  ]},
  {id: "outro", duration: 7, title: {vi: "Kết", en: "Closing"}, captions: [
    {at: 0.3, text: {vi: "Mô phỏng nguồn dữ liệu. Mọi thứ phía sau là thật.", en: "A simulated source. Everything after it is real."}},
  ]},
];

export const TOTAL = SCENES.reduce((sum, scene) => sum + scene.duration, 0);
export const SCENE_STARTS = SCENES.reduce<number[]>((starts, scene, i) => [...starts, i ? starts[i - 1] + SCENES[i - 1].duration : 0], []);
// A frame never advances more than this, so a backgrounded tab resumes where it paused.
export const MAX_STEP = 0.1;

export const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));
export const lerp = (from: number, to: number, p: number) => from + (to - from) * p;
export const ease = {
  linear: (p: number) => p,
  out: (p: number) => 1 - (1 - p) ** 3,
  inOut: (p: number) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
  back: (p: number) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2,
};
// Eased 0 → 1 progress of `t` between `from` and `to` seconds.
export function span(t: number, from: number, to: number, fn: (p: number) => number = ease.out) {
  if (to <= from) return t >= from ? 1 : 0;
  return fn(clamp((t - from) / (to - from)));
}
// Fade a scene in and out at its edges.
export const sceneOpacity = (t: number, duration: number, edge = 0.45) => span(t, 0, edge) * (1 - span(t, duration - edge, duration, ease.linear));

export function locate(time: number) {
  const t = clamp(time, 0, TOTAL);
  let index = SCENES.length - 1;
  for (let i = 0; i < SCENES.length; i++) if (t < SCENE_STARTS[i] + SCENES[i].duration) { index = i; break; }
  return {index, scene: SCENES[index], start: SCENE_STARTS[index], local: t - SCENE_STARTS[index]};
}

export function captionAt(scene: Scene, local: number): Cue | null {
  let current: Cue | null = null;
  for (const cue of scene.captions) if (cue.at <= local) current = cue;
  return current;
}

export function advance(time: number, deltaSeconds: number) {
  const next = time + clamp(deltaSeconds, 0, MAX_STEP);
  return next >= TOTAL ? {time: TOTAL, ended: true} : {time: next, ended: false};
}

export const formatTime = (seconds: number) => {
  const s = Math.floor(clamp(seconds, 0, TOTAL));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// `?t=42` opens the film paused at 42 s (used for review and screenshots).
export function startFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get("t");
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? clamp(value, 0, TOTAL) : null;
}
