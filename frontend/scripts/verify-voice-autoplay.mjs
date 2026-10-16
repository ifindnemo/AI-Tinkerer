// BASE_URL=http://localhost:3000 node scripts/verify-voice-autoplay.mjs
// The alert arrives after a user starts a simulation, as it does with delayed backend TTS.
import assert from "node:assert/strict";
import {chromium, expect} from "@playwright/test";

const base = process.env.BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({args: ["--no-sandbox", "--enable-gpu", "--use-gl=angle", "--use-angle=gl", "--autoplay-policy=user-gesture-required"]});
const context = await browser.newContext();
await context.addInitScript(() => localStorage.setItem("car-neuron.agent-mode", "backend"));

// Three seconds of valid WAV audio, long enough to observe the speaking state.
const rate = 8000, samples = rate * 3;
const wav = Buffer.alloc(44 + samples * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 440 / rate) * 1000), 44 + i * 2);

let published = false, audioRequests = 0, listRequests = 0;
await context.route(/\/api\/voice\/clips\?/, route => {
  listRequests++;
  const clip = {id: "clip_99999", seq: 99999, severity: "warning", text: "Cảnh báo. Nhiệt độ nước làm mát cao. Giảm tải và theo dõi.", created_at: new Date().toISOString(), group: "test-alert"};
  const after = Number(new URL(route.request().url()).searchParams.get("after"));
  return route.fulfill({json: {enabled: true, lang: "vi", latest: published ? clip.seq : 0, clips: published && after < clip.seq ? [clip] : []}});
});
await context.route("**/api/voice/clips/clip_99999/audio", route => {
  audioRequests++;
  return route.fulfill({status: 200, contentType: "audio/wav", body: wav});
});

try {
  const page = await context.newPage();
  await page.goto(`${base}/garage`);
  await expect(page.getByTestId("agent-dock")).toBeVisible({timeout: 20_000});
  await expect.poll(() => listRequests, {timeout: 20_000}).toBeGreaterThan(0);
  // This is the one gesture the driver makes to start the fault simulation.
  await page.getByLabel("Kịch bản mô phỏng").click();
  await page.getByLabel("Kịch bản mô phỏng").selectOption("warm");
  published = true;
  await expect(page.getByTestId("agent-dock")).toHaveAttribute("data-state", "speaking", {timeout: 10_000});
  assert.ok(audioRequests > 0, "the new alert audio was fetched automatically");
  await expect(page.getByTestId("agent-voice-status")).not.toContainText("chặn phát tiếng");
  console.log("PASS: simulation gesture unlocks Web Audio; a later alert speaks automatically without Replay");
} finally {
  await browser.close();
}
