// Real rules-only backend, no paid providers. WebGL is deliberately unavailable in this check.
// BASE_URL=http://127.0.0.1:3399 node scripts/verify-demo-readiness.mjs
import assert from "node:assert/strict";
import {mkdir} from "node:fs/promises";
import {chromium, expect} from "@playwright/test";

const base = process.env.BASE_URL || "http://127.0.0.1:3399";
const output = process.env.SCREENSHOT_DIR || "/tmp/neuron-demo-readiness";
await mkdir(output, {recursive: true});
const browser = await chromium.launch({args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"]});
const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
const drivers = [], cars = [], errors = [];
await context.addInitScript(() => {
  localStorage.setItem("car-neuron.lang", "vi");
  localStorage.setItem("car-neuron.agent-lang", "en");
  localStorage.setItem("car-neuron.agent-mode", "backend");
  // Test the app's existing WebGL failure path, not the performance of software 3D.
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...args) {
    return String(type).includes("webgl") ? null : get.call(this, type, ...args);
  };
});
await context.route("**/*", route => {
  if (new URL(route.request().url()).origin !== new URL(base).origin) return route.abort();
  return route.continue();
});
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
page.on("response", async response => {
  try {
    const path = new URL(response.url()).pathname;
    if (path === "/api/driver/events" && response.ok()) drivers.push({request: response.request().postDataJSON(), reply: await response.json()});
    if (path === "/api/vehicle/telemetry" && response.ok()) cars.push(await response.json());
  } catch { /* a response disposed during navigation is not an assertion input */ }
});
const click = id => page.getByTestId(id).evaluate(node => node.click());
async function ask(text, expected) {
  if (!await page.getByTestId("agent-panel").isVisible()) await click("agent-robot");
  await page.getByTestId("talk-text").fill(text);
  await click("talk-send");
  await expect(page.getByTestId("talk-log").locator('[data-role="neuron"]').last()).toContainText(expected);
  const end = page.getByTestId("talk-end");
  if (await end.isVisible()) await end.evaluate(node => node.click());
}
async function waitCar(start, severity, plan) {
  await expect.poll(() => cars.slice(start).some(reply => reply.latest.assessment.severity === severity && (!plan || reply.latest.plan?.code === plan)), {timeout: 45_000}).toBe(true);
}
try {
  await page.goto(`${base}/garage?presenter=1&reset=1`, {waitUntil: "domcontentloaded"});
  await page.waitForURL(url => !url.searchParams.has("reset"));
  await page.waitForFunction(() => {
    const node = document.querySelector('[data-testid="garage-camera-sim-attentive"]');
    return node && Object.keys(node).some(key => key.startsWith("__reactProps"));
  });
  await click("garage-camera-sim-attentive");
  await expect.poll(() => drivers.some(item => item.request.source === "simulated" && item.reply.state === "attentive")).toBe(true);
  await waitCar(0, "normal");
  await ask("How is the car now?", /normal/i);
  console.log("normal + attentive: real UI → rules backend → normal reply passed");

  let start = cars.length;
  await page.getByLabel("Kịch bản mô phỏng").selectOption("warm");
  await waitCar(start, "warning", "garage_when_convenient");
  await click("alert-quiet");
  await ask("Why are you warning me?", /warm|coolant|temperature|warning/i);
  await ask("Which garage is nearby?", /garage/i);
  console.log("warm + attentive: warning, garage plan, Quiet and text Q&A passed (no garage service configured)");

  start = cars.length;
  await click("garage-camera-sim-drowsy");
  await expect(page.getByTestId("garage-camera-severity")).toHaveAttribute("data-severity", "critical", {timeout: 15_000});
  await expect.poll(() => drivers.some(item => item.reply.state === "drowsy" && item.reply.assessment.severity === "critical"), {timeout: 15_000}).toBe(true);
  await waitCar(start, "critical", "rest_then_decide");
  const drowsy = cars.slice(start).find(reply => reply.latest.plan?.code === "rest_then_decide");
  assert.equal(drowsy.latest.pending_action, null);
  await ask("Can I drive to that garage now?", /stop|rest/i);
  await page.screenshot({path: `${output}/drowsy.png`});
  console.log("warm + drowsy: critical, rest_then_decide, no booking and stop/rest reply passed");

  const driverStart = drivers.length;
  const oldSession = drivers.at(-1).request.sessionId;
  start = cars.length;
  await click("garage-camera-sim-attentive");
  await expect.poll(() => drivers.slice(driverStart).some(item => item.reply.state === "attentive" && item.request.sessionId !== oldSession), {timeout: 8000}).toBe(true);
  await waitCar(start, "warning", "garage_when_convenient");
  await expect(page.getByTestId("board-driver")).toHaveText("Tỉnh táo");
  start = cars.length;
  await page.getByLabel("Kịch bản mô phỏng").selectOption("normal");
  await waitCar(start, "normal");
  await ask("How is the car now?", /normal/i);
  await page.screenshot({path: `${output}/normal-again.png`});
  for (const item of drivers) {
    assert.equal(item.request.context.vehicleId, "bmw-m2");
    assert.doesNotMatch(JSON.stringify(item.request), /data:|blob:|base64|landmarks/i);
  }
  assert.deepEqual(errors, []);
  console.log("demo-readiness ok: attentive → warm → drowsy → new attentive driver → normal; old state replaced; no page errors. WebGL, real microphone and paid providers NOT tested.");
} catch (error) {
  console.error("Flow diagnostics:", JSON.stringify({
    cars: cars.map(reply => ({severity: reply.latest.assessment.severity, plan: reply.latest.plan?.code, engine: reply.latest.engine})),
    drivers: drivers.map(item => ({state: item.reply.state, severity: item.reply.assessment.severity})),
    errors,
  }));
  await page.screenshot({path: `${output}/failure.png`, fullPage: true});
  throw error;
} finally {
  await browser.close();
}
