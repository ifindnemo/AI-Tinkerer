// Run against a frontend connected to a rules-only backend with EXTERNAL_TOOLS=off.
// BASE_URL=http://127.0.0.1:3001 node scripts/verify-driver-ui.mjs
import assert from "node:assert/strict";
import {mkdir} from "node:fs/promises";
import {chromium, expect} from "@playwright/test";

const base = process.env.BASE_URL || "http://127.0.0.1:3000";
const output = process.env.SCREENSHOT_DIR || "/tmp/car-neuron-camera-ui";
await mkdir(output, {recursive: true});
// Optional: CAMERA_VIDEO=/path/to/a/frontal-face.y4m exercises recovery from a frozen face video.
const cameraVideo = process.env.CAMERA_VIDEO;
const browser = await chromium.launch({args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", ...(cameraVideo ? [`--use-file-for-fake-video-capture=${cameraVideo}`] : [])]});
const errors = [], external = [], batches = [];
const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
await context.addInitScript(() => {
  window.testOscillators = 0;
  const create = AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator = function () {window.testOscillators++; return create.call(this);};
});
context.on("page", page => {
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {if (/hydrat|server rendered HTML/i.test(message.text())) errors.push(message.text());});
});
await context.route("**/*", route => {
  const request = route.request(), url = new URL(request.url());
  if (url.origin !== new URL(base).origin) {external.push(url.origin); return route.abort();}
  if (url.pathname === "/api/driver/events") batches.push(request.postDataJSON());
  return route.continue();
});

async function noOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal page overflow");
  const state = page.getByTestId("driver-state");
  if (await state.count()) assert.ok(await state.locator("span").last().evaluate(el => el.scrollWidth <= el.clientWidth), "state label is not clipped");
}
async function severity(page, value) {
  await expect(page.getByTestId("driver-severity")).toHaveAttribute("data-severity", value, {timeout: 12_000});
}

try {
  const page = await context.newPage();
  await page.goto(`${base}/driver`);
  await expect(page.getByTestId("start-camera")).toBeVisible();
  await page.screenshot({path: `${output}/desktop-intro.png`, fullPage: true, animations: "disabled"});
  await page.getByTestId("start-simulation").click();
  await expect(page.getByTestId("driver-connection")).toHaveAttribute("data-status", "connected");
  await severity(page, "normal");
  await expect(page.getByTestId("driver-state")).toHaveText("Tập trung");
  await expect.poll(async () => Number(await page.getByTestId("sent-count").textContent())).toBeGreaterThan(0);
  await page.getByTestId("sim-drowsy").click();
  await severity(page, "critical");
  await page.screenshot({path: `${output}/desktop-critical.png`, fullPage: true, animations: "disabled"});
  await expect(page.getByTestId("driver-held")).toBeVisible({timeout: 7000});
  await expect(page.getByTestId("driver-state")).toHaveText("Tập trung");
  await severity(page, "critical");
  await page.getByTestId("sim-attentive").click();
  await severity(page, "normal");
  await expect(page.getByTestId("driver-held")).toHaveCount(0);

  await page.getByTestId("sim-distracted").click();
  await severity(page, "critical");
  // Motion now comes from the simulated ECU speed instead of a manual switch.
  await page.getByTestId("ecu-parked").focus();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("ecu-parked")).toHaveAttribute("aria-pressed", "true");
  await severity(page, "normal");
  await page.getByTestId("sim-no_face").click();
  await expect(page.getByTestId("driver-state")).toHaveText("Không thấy tài xế", {timeout: 5000});
  await severity(page, "normal");
  await expect(page.getByTestId("driver-severity")).toHaveText("Chưa đủ tín hiệu");
  await page.getByTestId("ecu-warm").focus();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("ecu-warm")).toHaveAttribute("aria-pressed", "true");
  await severity(page, "warning");
  await expect(page.getByTestId("board-driver")).toHaveText("Không xác định");
  await noOverflow(page);

  // Vehicle Guardian demo flow: warm engine + closed eyes → stop at the nearest safe place,
  // then the driver confirms with open eyes and the vehicle warning stays.
  await page.getByTestId("sim-attentive").click();
  await expect(page.getByTestId("board-action")).toHaveText("Giảm tải, theo dõi nhiệt độ", {timeout: 8000});
  await expect(page.getByTestId("board-alert")).toHaveText("Cảnh báo kỹ thuật");
  await page.getByTestId("sim-drowsy").click();
  await expect(page.getByTestId("board-action")).toHaveText("Dừng ở vị trí an toàn gần nhất", {timeout: 8000});
  await expect(page.getByTestId("guardian-board")).toHaveAttribute("data-must-stop", "true");
  await expect(page.getByTestId("board-alert")).toHaveText(/Cảnh báo tài xế ngay|Chưa phản hồi/);
  await expect(page.getByTestId("driver-agent")).toContainText("Lịch sử bảo trì (mô phỏng)", {timeout: 8000});
  await expect(page.getByTestId("guardian-ack")).toBeEnabled({timeout: 9000});
  await page.getByTestId("guardian-ack").click();
  await expect(page.getByTestId("board-alert")).toHaveText("Đã phản hồi · vẫn theo dõi");
  await expect(page.getByTestId("board-coolant")).toBeVisible();
  await expect(page.locator('[data-testid="board-coolant"]').locator("..")).toHaveAttribute("data-level", "warning");
  await expect.poll(() => batches.filter(batch => batch.context.acknowledgedAt).length).toBeGreaterThan(0);
  await page.screenshot({path: `${output}/desktop-guardian-ack.png`, fullPage: true, animations: "disabled"});
  await page.getByTestId("ecu-overheat").click();
  await expect(page.getByTestId("board-action")).toHaveText("Tấp vào nơi an toàn, tắt máy", {timeout: 8000});
  await severity(page, "critical");
  await page.getByTestId("ecu-warm").click();

  // A stalled request must time out, while local alerts still escalate and sound.
  const stalled = route => new Promise(resolve => setTimeout(resolve, 7000)).then(() => route.abort().catch(() => {}));
  await page.route("**/api/driver/events", stalled);
  const tonesBefore = await page.evaluate(() => window.testOscillators);
  await page.getByTestId("sim-drowsy").click();
  await severity(page, "critical");
  await expect(page.getByTestId("driver-connection")).toHaveAttribute("data-status", "offline", {timeout: 8000});
  await expect(page.getByTestId("driver-agent")).toContainText("Luật trên thiết bị");
  assert.ok(await page.evaluate(() => window.testOscillators) > tonesBefore, "audio is scheduled without a backend response");
  await page.setViewportSize({width: 390, height: 844});
  await noOverflow(page);
  await expect(page.getByTestId("driver-mobile-alert")).toBeVisible();
  await page.getByTestId("driver-mobile-alert").getByRole("link").click();
  await expect(page.getByTestId("driver-agent")).toBeInViewport();
  await page.screenshot({path: `${output}/mobile-offline.png`, fullPage: true, animations: "disabled"});
  await page.unroute("**/api/driver/events", stalled);
  await expect(page.getByTestId("driver-connection")).toHaveAttribute("data-status", "connected", {timeout: 12_000});

  await page.emulateMedia({reducedMotion: "reduce"});
  await page.getByRole("button", {name: "EN", exact: true}).click();
  await page.getByTestId("sim-no_face").click();
  await expect(page.getByTestId("driver-state")).toHaveText("No driver in view", {timeout: 5000});
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({width, height: 900});
    await noOverflow(page);
  }
  await page.getByRole("button", {name: "Stop", exact: true}).click();
  await expect(page.getByTestId("driver-connection")).toContainText("Ready to begin");
  await page.getByRole("button", {name: "VI", exact: true}).click();

  // Denied permission gives a recovery message and still allows simulation.
  const denied = await context.newPage();
  await denied.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {throw new DOMException("denied", "NotAllowedError");};
  });
  await denied.goto(`${base}/driver`);
  await denied.getByTestId("start-camera").click();
  await expect(denied.getByTestId("driver-error")).toContainText("Quyền dùng camera bị từ chối");
  await denied.getByTestId("start-simulation").click();
  await severity(denied, "normal");
  await denied.close();

  // Load the real local MediaPipe model on Chromium's synthetic no-face camera.
  await page.addInitScript(() => {
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await get(constraints);
      window.testCameraStream = stream;
      return stream;
    };
  });
  await page.reload();
  await page.getByTestId("start-camera").click();
  await expect(page.getByTestId("driver-state")).toHaveText(cameraVideo ? "Tập trung" : "Không thấy tài xế", {timeout: 30_000});
  if (cameraVideo) {
    await severity(page, "normal");
    await page.locator("video").evaluate(video => video.pause());
    await expect(page.getByTestId("driver-state")).toHaveText("Không thấy tài xế", {timeout: 8000});
  }
  await severity(page, "warning");
  await page.getByRole("button", {name: "Hiện video", exact: true}).click();
  await expect(page.getByTestId("driver-lens")).toHaveAttribute("data-video", "off");
  await page.getByRole("button", {name: "Hiệu chỉnh lại", exact: true}).click();
  await expect(page.getByRole("button", {name: "Hiệu chỉnh lại", exact: true})).toBeDisabled();
  await page.getByRole("button", {name: "Dừng", exact: true}).click();
  assert.ok(await page.evaluate(() => window.testCameraStream.getTracks().every(track => track.readyState === "ended")), "stopping releases webcam tracks");

  // The camera is released immediately even if model loading has not finished.
  let releaseModel;
  const gate = new Promise(resolve => {releaseModel = resolve;});
  await page.route("**/mediapipe/face_landmarker.task", async route => {await gate; await route.continue().catch(() => {});});
  const requested = page.waitForRequest("**/mediapipe/face_landmarker.task");
  await page.getByTestId("start-camera").click();
  await requested;
  await page.getByRole("button", {name: "Dừng", exact: true}).click();
  assert.ok(await page.evaluate(() => window.testCameraStream.getTracks().every(track => track.readyState === "ended")), "cancel while loading releases webcam");
  releaseModel();

  assert.ok(batches.length > 0);
  for (const batch of batches) {
    assert.deepEqual(Object.keys(batch).sort(), ["context", "events", "schemaVersion", "sessionId", "source"]);
    for (const key of Object.keys(batch.context)) assert.ok(["vehicleMoving", "vehicleId", "vehicle", "acknowledgedAt", "lang"].includes(key), `context.${key}`);
    if (batch.context.vehicle) assert.deepEqual(Object.keys(batch.context.vehicle).sort(), ["capturedAt", "coolantC", "drivingMinutes", "engineLoadPct", "source", "speedKmh"]);
    for (const event of batch.events) assert.deepEqual(Object.keys(event).sort(), ["absentMs", "capturedAt", "confidence", "eyes", "facePresent", "head", "state"]);
    assert.doesNotMatch(JSON.stringify(batch), /data:|blob:|base64/i);
  }
  assert.deepEqual(external, [], "all assets and model requests stay local");
  assert.deepEqual(errors, [], "no runtime or hydration errors");
  console.log(`PASS: live rules, Vehicle Guardian flow (ECU + camera + confirmation), retained alerts, parked state, timeout/reconnect, mobile/English/reduced motion, camera denial, real model, privacy, camera cleanup; ${batches.length} event batches. Screenshots: ${output}`);
} finally {
  await browser.close();
}
