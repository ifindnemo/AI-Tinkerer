// The agent's language and voice settings on /garage (backend mode, rules-only backend is enough).
// BASE_URL=http://127.0.0.1:3000 node scripts/verify-agent-language.mjs
// Checks: the settings card, Vietnamese by default, English end to end (blackbox batch, driver events, the words on the
// page, the voice poll), pinning a language against the interface language, and that nothing safety-related changes.
import assert from "node:assert/strict";
import {mkdir} from "node:fs/promises";
import {chromium, expect} from "@playwright/test";

const base = process.env.BASE_URL || "http://127.0.0.1:3000";
const output = process.env.SCREENSHOT_DIR || "/tmp/car-neuron-agent-language";
const VIETNAMESE = /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i;
await mkdir(output, {recursive: true});
const browser = await chromium.launch({args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"]});
const errors = [], batches = [], driver = [], voice = [];
const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
await context.addInitScript(() => {try {localStorage.setItem("car-neuron.agent-mode", "backend");} catch { /* opaque frames */ }});
context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
await context.route("**/*", route => {
  const request = route.request(), url = new URL(request.url());
  if (url.origin !== new URL(base).origin) return route.abort();
  if (url.pathname.endsWith(".glb")) return route.abort(); // software rendering: the 3D model only stalls the page
  if (url.pathname === "/api/vehicle/telemetry" && request.method() === "POST") batches.push(request.postDataJSON());
  if (url.pathname === "/api/driver/events") driver.push(request.postDataJSON());
  if (url.pathname === "/api/voice/clips") voice.push(url.search);
  return route.continue();
});

try {
  const page = await context.newPage();
  await page.goto(`${base}/garage?presenter=1&reset=1`);
  await expect(page.getByTestId("garage-camera")).toBeVisible({timeout: 60_000});
  const settings = page.getByTestId("agent-settings");
  await expect(settings).toBeVisible();

  // 1. Vietnamese by default: the setting is "follow the interface" and the poll asks for Vietnamese.
  await expect(page.getByTestId("agent-lang-auto")).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => voice.some(search => search.includes("lang=vi"))).toBe(true);
  await expect(page.getByTestId("agent-voice-status")).toContainText("tiếng Việt");
  await expect(page.getByTestId("agent-voice-toggle")).toHaveAttribute("aria-pressed", "true");

  // 2. English: the setting, the voice poll, the words on the page.
  await page.getByTestId("agent-lang-en").click();
  await expect(page.getByTestId("agent-lang-en")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("agent-voice-status")).toContainText("tiếng Anh");
  await expect.poll(() => voice.some(search => search.includes("lang=en"))).toBe(true);
  await page.getByLabel("Kịch bản mô phỏng").selectOption("warm");
  await page.waitForTimeout(9_000);
  await page.getByTestId("garage-camera-sim-drowsy").click();
  await expect(page.getByTestId("garage-agent")).toBeVisible({timeout: 30_000});
  // The agent's words (first its on-device text, then the backend's) are English, and so are the six facts' values.
  await expect.poll(async () => (await page.getByTestId("garage-agent").innerText()), {timeout: 30_000}).toMatch(/driver|engine|stop/i);
  // Only the agent's own words (summary, steps, evidence), not the card's interface labels, which follow the interface.
  const words = await page.getByTestId("garage-agent").locator("p, ol li, ul li").allInnerTexts();
  assert.ok(words.length >= 2, "the agent card has a summary and steps");
  for (const text of words) assert.ok(!VIETNAMESE.test(text), `the agent's words are not English: ${text}`);
  await page.screenshot({path: `${output}/english.png`});

  // 3. What the browser sent says English; severity and steps are not part of the choice.
  await expect.poll(() => driver.length, {timeout: 20_000}).toBeGreaterThan(0);
  assert.ok(driver.every(batch => batch.context.lang === "en"), "every driver batch after the switch carries lang=en");
  await expect.poll(() => batches.some(batch => batch.lang === "en"), {timeout: 45_000}).toBe(true);
  assert.ok(batches.filter(batch => batch.lang === "en").every(batch => batch.records.length >= 5), "an English batch is an ordinary batch");
  await expect(page.getByTestId("action-banner")).toBeVisible();
  // The recommendation row is an interface label (the interface is Vietnamese here): the decision is the same.
  await expect(page.getByTestId("board-action")).toContainText("Dừng ở vị trí an toàn gần nhất");

  // 4. The interface stays Vietnamese: the setting pins the agent only. The robot panel's mute is the same switch.
  await expect(page.getByTestId("agent-voice-status")).toContainText("tiếng Anh");
  await page.getByTestId("agent-voice-toggle").click();
  await expect(page.getByTestId("agent-voice-toggle")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("agent-voice-volume")).toBeDisabled();
  await page.getByTestId("agent-voice-toggle").click();
  await page.getByTestId("agent-voice-volume").fill("60");
  await expect(page.getByTestId("agent-voice-volume")).toHaveValue("60");

  // 5. The choice survives a reload, and "auto" returns to following the interface.
  await page.reload();
  await expect(page.getByTestId("agent-lang-en")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("agent-lang-auto").click();
  await expect(page.getByTestId("agent-voice-status")).toContainText("tiếng Việt");
  assert.deepEqual(errors, [], `page errors: ${errors.join(" | ")}`);
  console.log(`PASS: agent language and voice settings; ${driver.length} driver batches, ${batches.length} blackbox batches; screenshots in ${output}`);
} finally {
  await browser.close();
}
