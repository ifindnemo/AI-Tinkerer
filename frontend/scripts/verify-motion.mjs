// BASE_URL=http://127.0.0.1:3000 node scripts/verify-motion.mjs
import assert from "node:assert/strict";
import {chromium, expect} from "@playwright/test";

const base = process.env.BASE_URL || "http://127.0.0.1:3000";
const browser = await chromium.launch({args: ["--no-sandbox"]});
const errors = [];
const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
context.on("page", page => {
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {if (/hydration|server rendered HTML/i.test(message.text())) errors.push(message.text());});
});
// Test visual states without calling external services or persisting demo incidents.
await context.addInitScript(origin => {
  if (location.origin === origin) localStorage.setItem("car-neuron.agent-mode", "backend");
}, new URL(base).origin);
await context.route("**/api/vehicle/health", route => route.fulfill({json: {status: "ok"}}));
// This check covers UI timing, not 3D rendering; avoid software-WebGL load skewing one-second timers.
await context.route("**/*.glb", route => route.abort());
await context.route("**/api/driver/events", route => route.abort());
await context.route("**/api/vehicle/telemetry", async route => {
  const b = route.request().postDataJSON();
  await new Promise(resolve => setTimeout(resolve, 650));
  const assessment = {severity: "normal", diagnosis: "Motion verification: stable readings.", suspected_faults: [], evidence: ["Stable coolant"], confidence: 0.8, missing_data: [], recommendations: ["Continue monitoring"]};
  await route.fulfill({json: {
    batchId: b.batchId, vehicleId: b.vehicleId, accepted: b.recordCount, completedAt: new Date().toISOString(), incident: null,
    latest: {status: "normal", vehicle_id: b.vehicleId, batch_id: b.batchId, accepted_records: b.recordCount, assessment, hard_safety_guardrail: {triggered: false, minimum_severity: "normal", reasons: []}, tool_trace: [], memory: null, sanitization: {removed_fields: [], removed_values: 0}},
  }});
});
try {
  const page = await context.newPage();
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  const hero = page.getByRole("img", {name: "Minh họa: chiếc xe đang nóng dần"});
  await expect.poll(() => hero.evaluate(el => getComputedStyle(el).opacity)).toBe("1");
  assert.notEqual(await hero.evaluate(el => getComputedStyle(el).animationName), "none");
  // Data-flow packets follow each illustration tick; sensor updates do not restart the panel entrance.
  await hero.locator('svg[viewBox="0 0 100 100"] path').last().evaluate(el => {window.motionPacket = el;});
  await expect.poll(() => page.evaluate(() => !window.motionPacket.isConnected)).toBe(true);
  assert.equal(await hero.evaluate(el => el.getAnimations().filter(a => a.playState === "running").length), 0);
  for (const width of [1440, 768, 320]) {
    await page.setViewportSize({width, height: 900});
    await page.goto(base);
    await expect.poll(() => hero.evaluate(el => getComputedStyle(el).opacity)).toBe("1");
    const coolant = await hero.getByText("Nước làm mát", {exact: true}).locator("../..").boundingBox();
    const fan = await hero.getByText("Quạt làm mát", {exact: true}).locator("../..").boundingBox();
    assert.ok(coolant.x + coolant.width <= fan.x || fan.x + fan.width <= coolant.x || coolant.y + coolant.height <= fan.y || fan.y + fan.height <= coolant.y, "sensor chips do not overlap");
    for (const reveal of await page.locator("[data-reveal]").all()) {
      await reveal.scrollIntoViewIfNeeded();
      await expect(reveal).toHaveAttribute("data-visible", "true");
      await expect.poll(() => reveal.evaluate(el => getComputedStyle(el).opacity)).toBe("1");
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal overflow");
  }
  console.log("PASS: hero timing, data-flow ticks, scroll reveals and sensor layout at 320–1440 px.");
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto(`${base}/garage`);
  const agent = page.locator(".backend-agent");
  await expect(agent).toHaveAttribute("data-phase", "collecting");
  await expect.poll(() => agent.locator(".agent-sample-segments .filled").count()).toBeGreaterThan(0);
  await expect(agent).toHaveAttribute("data-phase", "sending", {timeout: 22_000});
  await expect(agent.locator('[aria-current="step"]')).toContainText("Agent");
  await expect(agent).toHaveAttribute("data-phase", "ready");
  await expect(agent.locator('[aria-current="step"]')).toContainText("Đề xuất");
  const diagnosis = agent.locator(".agent-diagnosis");
  await diagnosis.evaluate(el => {window.motionDiagnosis = el;});
  await page.waitForTimeout(1100);
  assert.ok(await page.evaluate(() => window.motionDiagnosis.isConnected), "sensor ticks do not remount the assessment");
  console.log("PASS: collection → analysis → advice; one-second updates preserve assessment DOM.");

  await page.goto(`${base}/driver`);
  await page.getByTestId("start-simulation").click();
  await page.getByTestId("sim-drowsy").click();
  await expect(page.getByTestId("driver-severity")).toHaveAttribute("data-severity", "critical", {timeout: 12_000});
  const alert = page.getByTestId("driver-agent");
  assert.equal(await alert.evaluate(el => getComputedStyle(el).animationName), "none");
  assert.ok(await alert.locator("ol li").evaluateAll(items => items.every(el => getComputedStyle(el).opacity === "1" && getComputedStyle(el).animationName === "none")), "critical advice is visible immediately");

  await page.emulateMedia({reducedMotion: "reduce"});
  await page.goto(base);
  await expect(page.locator("[data-reveal]").first()).toHaveAttribute("data-visible", "true");
  assert.ok(await page.locator("[data-reveal]").evaluateAll(items => items.every(el => getComputedStyle(el).opacity === "1")), "offscreen content remains visible with reduced motion");
  const reducedHero = page.getByRole("img", {name: "Minh họa: chiếc xe đang nóng dần"});
  assert.equal(await reducedHero.evaluate(el => getComputedStyle(el).animationDelay), "0s");
  const initial = await reducedHero.innerText();
  await page.waitForTimeout(1300);
  assert.equal(await reducedHero.innerText(), initial, "illustration is static under reduced motion");
  await page.emulateMedia({reducedMotion: "no-preference"});
  await expect.poll(() => reducedHero.innerText()).not.toBe(initial);
  await page.emulateMedia({reducedMotion: "reduce"});
  const stopped = await reducedHero.innerText();
  await page.waitForTimeout(1300);
  assert.equal(await reducedHero.innerText(), stopped, "changing motion preference stops the illustration");

  const noJS = await browser.newContext({javaScriptEnabled: false, reducedMotion: "reduce"});
  const staticPage = await noJS.newPage();
  await staticPage.goto(base);
  assert.ok(await staticPage.locator("[data-reveal]").evaluateAll(items => items.every(el => getComputedStyle(el).opacity === "1")), "SSR content is readable without JavaScript");
  await noJS.close();
  assert.deepEqual(errors, []);
  console.log("PASS: motion, scroll reveals, 320–1440 px, batch stages, stable assessment DOM, immediate critical advice, live reduced-motion preference and no-JS content.");
} finally {
  await browser.close();
}
