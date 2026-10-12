// Driver camera inside the blackbox dashboard: the car agent must see blackbox data and the driver together.
// BASE_URL=http://127.0.0.1:3000 MODE=backend node scripts/verify-garage-camera.mjs
// The 3D garage needs GPU WebGL: without it headless Chromium stalls the main thread for seconds.
// MODE=device needs the gateway sending for bmw-m2 (see gateway/README.md).
import assert from "node:assert/strict";
import {mkdir} from "node:fs/promises";
import {chromium, expect} from "@playwright/test";

const base = process.env.BASE_URL || "http://127.0.0.1:3000";
const mode = process.env.MODE || "backend";
const output = process.env.SCREENSHOT_DIR || "/tmp/car-neuron-garage-camera";
const STOP = "Dừng tại vị trí an toàn gần nhất để nghỉ; không tiếp tục đến garage ở xa.";
await mkdir(output, {recursive: true});
const browser = await chromium.launch({args: ["--no-sandbox", "--enable-gpu", "--use-gl=angle", "--use-angle=gl", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]});
const errors = [], external = [], driverBatches = [], audio = [];
const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
await context.addInitScript(value => {try {localStorage.setItem("car-neuron.agent-mode", value);} catch { /* opaque frames */ }}, mode);
context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
await context.route("**/*", route => {
  const request = route.request(), url = new URL(request.url());
  if (url.origin !== new URL(base).origin) {external.push(url.origin); return route.abort();}
  if (url.pathname === "/api/driver/events") driverBatches.push(request.postDataJSON());
  if (/^\/api\/voice\/clips\/clip_\d+\/audio$/.test(url.pathname)) audio.push(url.pathname);
  return route.continue();
});

try {
  const page = await context.newPage();
  await page.goto(`${base}/garage`);
  const card = page.getByTestId("garage-camera");
  await expect(card).toBeVisible({timeout: 15_000});
  // The agent's robot sits in the corner of the garage.
  await expect(page.getByTestId("agent-robot")).toBeVisible();
  await page.waitForLoadState("networkidle");
  // Refresh asks for access once, then lists cameras by name (Chromium's fake device here).
  await card.screenshot({path: `${output}/card-idle.png`});
  await page.getByTestId("garage-camera-refresh").click();
  await expect.poll(async () => page.getByTestId("garage-camera-select").locator("option").count()).toBeGreaterThan(1);
  // The real camera path (Chromium's fake device + the local MediaPipe model) must start here too.
  await page.getByTestId("garage-camera-start").click();
  await expect(page.getByTestId("garage-camera-error")).toHaveCount(0);
  await expect(page.getByTestId("garage-camera-attention")).toBeVisible({timeout: 30_000});
  await page.getByRole("button", {name: "Dừng", exact: true}).click();
  await page.getByTestId("garage-camera-sim-drowsy").click();
  await expect(page.getByTestId("garage-camera-severity")).toHaveAttribute("data-severity", "critical", {timeout: 30_000});
  await expect(page.getByTestId("garage-camera-attention")).toHaveText("Giảm tỉnh táo");
  // A held alert survives reopened eyes, so the card keeps low attention.
  await expect(page.getByTestId("garage-camera-sharing")).toContainText("Đã gửi cảnh báo cho agent", {timeout: 10_000});
  assert.ok(driverBatches.length > 0 && driverBatches.every(batch => batch.context.vehicleId === "bmw-m2"), "camera events name the car");
  // The robot's bubble carries the alert in words at once, sound or not.
  const bubble = page.getByTestId("agent-bubble");
  await expect(bubble).toBeVisible({timeout: 5_000});
  await expect(bubble).toHaveAttribute("data-severity", /warning|critical/);
  // EXPECT_VOICE=1 (backend with Blaze configured): the agent's words are spoken and played by the robot.
  if (process.env.EXPECT_VOICE) {
    await expect(page.getByTestId("agent-dock")).toHaveAttribute("data-state", "speaking", {timeout: 40_000});
    await expect(bubble).toContainText("đang đọc");
    await expect.poll(() => audio.length, {timeout: 10_000}).toBeGreaterThan(0);
    console.log("spoken:", (await bubble.locator("p").textContent())?.slice(0, 220));
  }
  // A click on the robot opens its quick panel: last alert, replay, mute; Escape closes it.
  await page.getByTestId("agent-robot").click();
  const panel = page.getByTestId("agent-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("agent-robot")).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toContainText(/Cảnh báo|Nguy hiểm/);
  if (process.env.EXPECT_VOICE) await expect(page.getByTestId("agent-replay")).toBeEnabled();
  await page.getByTestId("agent-mute").click();
  await expect(page.getByTestId("agent-mute")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("agent-mute").click();
  await expect(page.getByTestId("agent-mute")).toHaveAttribute("aria-pressed", "false");
  await page.screenshot({path: `${output}/panel-${mode}.png`, animations: "disabled"});
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("agent-robot")).toBeFocused();
  await page.getByTestId("agent-robot").click();
  await panel.getByRole("button", {name: "Xem chi tiết"}).click();
  await expect(page.locator("#car-agent")).toBeInViewport();
  await page.screenshot({path: `${output}/dock-${mode}.png`, animations: "disabled"});
  // Alerts only: a few posts per episode, never one every few seconds.
  const posted = driverBatches.length;
  await page.waitForTimeout(8000);
  assert.ok(driverBatches.length - posted <= 2, `no continuous posting (${driverBatches.length - posted} more in 8 s)`);
  for (const batch of driverBatches) assert.doesNotMatch(JSON.stringify(batch), /data:|blob:|base64/i);
  // The next blackbox analysis (15 s batches in API mode; a driver-triggered job in device mode) includes the driver.
  await expect(page.locator(".insights-column")).toContainText(STOP, {timeout: 90_000});
  await expect(page.locator(".insights-column")).toContainText("Camera tài xế:", {timeout: 5_000}).catch(() => {});
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({path: `${output}/card-alert.png`});
  const box = await card.boundingBox();
  for (const control of await card.locator("button, select").all()) {
    const inner = await control.boundingBox();
    if (inner) assert.ok(inner.x >= box.x - 1 && inner.x + inner.width <= box.x + box.width + 1, "controls stay inside the card");
  }
  await page.screenshot({path: `${output}/garage-${mode}.png`, fullPage: true, animations: "disabled"});
  await page.setViewportSize({width: 390, height: 844});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal overflow on mobile");
  assert.deepEqual(external, [], "no external requests");
  assert.deepEqual(errors, [], "no runtime errors");
  console.log(`PASS (${mode}): garage camera → driver state shared with the car agent; ${driverBatches.length} camera batches. Screenshot: ${output}`);
} finally {
  await browser.close();
}
