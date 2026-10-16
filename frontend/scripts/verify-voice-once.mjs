// BASE_URL=http://127.0.0.1:3000 node scripts/verify-voice-once.mjs   (backend mode with Blaze; ~3 minutes)
// Each car alert is spoken once per episode: over a long overheating run, no alert is spoken again later.
// The parts of one announcement are created within seconds of each other; a repeat would come a batch later.
import assert from "node:assert/strict";
import {chromium} from "@playwright/test";

const base = process.env.BASE_URL || "http://127.0.0.1:3000";
const session = "bmw-m2";
const clipsNow = async () => (await (await fetch(`${base}/api/voice/clips?session=${session}&lang=vi&after=0`)).json());
const before = (await clipsNow()).latest;

const browser = await chromium.launch({args: ["--no-sandbox", "--enable-gpu", "--use-gl=angle", "--use-angle=gl"]});
try {
  const context = await browser.newContext({viewport: {width: 1440, height: 900}});
  await context.addInitScript(() => {try {localStorage.setItem("car-neuron.agent-mode", "backend"); localStorage.setItem("car-neuron.lang", "vi");} catch { /* blocked storage */ }});
  const page = await context.newPage();
  await page.goto(`${base}/garage?presenter=1&reset=1`);
  // Choosing before the page has hydrated is lost (the scenario stays "normal"): choose until it holds.
  const scenario = page.getByLabel("Kịch bản mô phỏng");
  for (let tries = 0; tries < 10 && (await scenario.inputValue()) !== "engine"; tries++) { await page.waitForTimeout(1000); await scenario.selectOption("engine"); }
  await page.waitForTimeout(1500);
  if ((await scenario.inputValue()) !== "engine") await scenario.selectOption("engine");
  await page.waitForTimeout(180_000);
} finally {
  await browser.close();
}

const data = await clipsNow();
assert.ok(data.enabled, "no Vietnamese voice is configured on the backend");
const fresh = data.clips.filter(clip => clip.seq > before && !String(clip.group).startsWith("driver:"));
const groups = new Map();
for (const clip of fresh) groups.set(clip.group, [...(groups.get(clip.group) ?? []), Date.parse(clip.created_at)]);
for (const [group, times] of groups) {
  const spread = (Math.max(...times) - Math.min(...times)) / 1000;
  assert.ok(spread < 30, `${group} was spoken again ${spread.toFixed(0)} s later`);
}
console.log(`PASS: ${groups.size} car alert(s) in 3 minutes, each spoken once (${fresh.length} clip parts)${groups.size ? "" : " — already spoken this episode; restart the backend for a fresh run"}`);
