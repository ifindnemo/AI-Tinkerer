// BASE_URL=http://127.0.0.1:3000 node scripts/verify-film.mjs
import assert from "node:assert/strict";
import {chromium, expect} from "@playwright/test";
import {mkdir} from "node:fs/promises";

const base = process.env.BASE_URL || "http://127.0.0.1:3000";
const browser = await chromium.launch({args: ["--no-sandbox"]});
const output = "/tmp/car-neuron-film-browser";
await mkdir(output, {recursive: true});
const errors = [];
try {
  const context = await browser.newContext({viewport: {width: 1440, height: 1080}});
  context.on("page", page => {
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => {if (/hydration|server rendered HTML/i.test(m.text())) errors.push(m.text());});
  });
  const page = await context.newPage();
  const waitVideo = async () => {
    await page.waitForFunction(() => {
      const v = document.querySelector("video");
      return v?.readyState >= 2 && !v.seeking && !v.error;
    });
  };
  await page.goto(`${base}/film`);
  await waitVideo();
  assert.deepEqual(await page.locator("video").evaluate(v => ({duration: v.duration, paused: v.paused, muted: v.muted, controls: v.controls, inline: v.playsInline})),
    {duration: 90, paused: true, muted: false, controls: true, inline: true});
  await expect(page.locator('.site-nav a[aria-current="page"]')).toHaveAttribute("href", "/film");
  await page.locator("h1").click();
  await page.keyboard.press("Space");
  await page.waitForFunction(() => document.querySelector("video").currentTime > .3);
  await page.keyboard.press("Space");
  assert.equal(await page.locator("video").evaluate(v => v.paused), true);
  for (const [name, time] of [["Camera tài xế", 55.1], ["Riêng tư", 74.3]]) {
    const button = page.getByRole("button", {name: new RegExp(name)});
    await button.click();
    await waitVideo();
    assert(Math.abs(await page.locator("video").evaluate(v => v.currentTime) - time) < .05);
    await expect(button).toHaveAttribute("aria-current", "step");
  }
  await page.goto(`${base}/film?t=71.7`);
  await waitVideo();
  assert.equal(await page.locator("video").evaluate(v => v.paused), true);
  assert(Math.abs(await page.locator("video").evaluate(v => v.currentTime) - 71.7) < .05);
  await page.screenshot({path: `${output}/camera-critical.png`});
  await page.getByRole("button", {name: "EN", exact: true}).click();
  await expect.poll(() => page.locator("video").evaluate(v => Array.from(v.textTracks).find(t => t.language === "en")?.mode)).toBe("showing");
  await expect.poll(() => page.locator("video").evaluate(v => Array.from(v.textTracks).find(t => t.language === "en")?.cues?.length)).toBeGreaterThan(0);
  await page.getByRole("button", {name: "VI", exact: true}).click();
  assert.equal(await page.locator("video").evaluate(v => Array.from(v.textTracks).find(t => t.language === "en").mode), "disabled");
  assert(Math.abs(await page.locator("video").evaluate(v => v.currentTime) - 71.7) < .05, "language switch must preserve the playhead");
  const downloadWait = page.waitForEvent("download");
  await page.getByRole("link", {name: "Tải video MP4"}).click();
  const download = await downloadWait;
  assert.equal(download.suggestedFilename(), "Car-Neuron-90s.mp4");
  await download.cancel();
  const range = await context.request.get(`${base}/film/car-neuron-90s.mp4`, {headers: {Range: "bytes=0-1023"}});
  assert.equal(range.status(), 206);
  assert.equal((await range.body()).length, 1024);
  await page.getByRole("button", {name: "Toàn màn hình", exact: true}).click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await page.evaluate(() => document.exitFullscreen());
  await page.getByRole("button", {name: "Chỉ xem video"}).click();
  await expect(page.locator(".site-header")).toHaveCount(0);
  await page.getByRole("button", {name: "Hiện lại giao diện"}).click();
  await expect(page.locator(".site-header")).toBeVisible();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({width, height: 900});
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no page overflow at ${width}px`);
    assert((await page.locator("video").boundingBox()).width <= width);
    const chapters = page.getByRole("list", {name: "Các phần của phim"});
    for (const button of await chapters.getByRole("button").all()) assert((await button.boundingBox()).height >= 44);
    if (width === 390) {await page.waitForTimeout(900); await page.screenshot({path: `${output}/mobile.png`, fullPage: true});}
  }
  await page.emulateMedia({reducedMotion: "reduce"});
  await page.goto(`${base}/film?autoplay=1`);
  await waitVideo();
  assert.equal(await page.locator("video").evaluate(v => v.paused), true);
  await page.emulateMedia({reducedMotion: "no-preference"});
  await page.goto(`${base}/film?autoplay=1`);
  await waitVideo();
  await page.waitForFunction(() => !document.querySelector("video").paused);
  assert.equal(await page.locator("video").evaluate(v => v.muted), true);
  await page.goto(`${base}/film?clean&t=80.5`);
  await waitVideo();
  await expect(page.locator(".site-header")).toHaveCount(0);
  await expect(page.getByRole("button", {name: "Hiện lại giao diện"})).toBeVisible();
  // Verify the failed-media fallback, then an actual reload of the real MP4.
  let blocked = true;
  await page.route("**/film/car-neuron-90s.mp4", route => blocked ? route.abort() : route.continue());
  await page.goto(`${base}/film`);
  await expect(page.getByRole("alert").filter({has: page.getByRole("button", {name: "Tải lại video"})})).toBeVisible();
  blocked = false;
  await page.getByRole("button", {name: "Tải lại video"}).click();
  await waitVideo();
  await expect(page.getByRole("button", {name: "Tải lại video"})).toHaveCount(0);
  // The fast-start MP4 can finish metadata loading before delayed hydration scripts.
  await page.unroute("**/film/car-neuron-90s.mp4");
  await page.route("**/_next/static/**/*.js", async route => {await new Promise(resolve => setTimeout(resolve, 400)); await route.continue();});
  await page.goto(`${base}/film?t=80.5`);
  await waitVideo();
  await expect.poll(() => page.locator("video").evaluate(v => v.currentTime)).toBe(80.5);
  assert.equal(await page.locator("video").evaluate(v => v.paused), true);
  await page.waitForTimeout(900);
  await page.screenshot({path: `${output}/privacy-desktop.png`, fullPage: true});
  assert.deepEqual(errors, []);
  console.log("PASS: actual 90s MP4, sound/play/pause/seek, camera/privacy chapters, captions, download/range requests, fullscreen, 320–1440px, clean mode, reduced motion and media error recovery.");
} finally {
  await browser.close();
}
