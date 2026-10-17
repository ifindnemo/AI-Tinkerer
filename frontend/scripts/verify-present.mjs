// Browser check for /present: address, keyboard, timer, demo link, and that nothing spills out of a slide.
// BASE_URL=http://127.0.0.1:3000 node scripts/verify-present.mjs   (SCREENSHOT_DIR=... to keep a picture of each slide)
import assert from "node:assert/strict";
import {mkdir} from "node:fs/promises";
import {chromium, expect} from "@playwright/test";

const base = process.env.BASE_URL || "http://127.0.0.1:3000";
const output = process.env.SCREENSHOT_DIR;
if (output) await mkdir(output, {recursive: true});
const browser = await chromium.launch({args: ["--no-sandbox"]});
const errors = [];

async function open(size, hash = "") {
  const context = await browser.newContext({viewport: size});
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`${base}/present${hash}`, {waitUntil: "domcontentloaded"});
  await page.waitForFunction(() => {
    const node = document.querySelector("section[data-slide]");
    return !!node && Object.keys(node).some(key => key.startsWith("__reactProps"));
  });
  return page;
}
const active = page => page.evaluate(() => document.querySelector("section[data-active]")?.getAttribute("data-slide"));

try {
  // Address, keys, clamping, inert slides, the demo link.
  const page = await open({width: 1366, height: 768}, "#3");
  await expect.poll(() => active(page)).toBe("hood");
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => active(page)).toBe("challenges");
  assert.equal(await page.evaluate(() => location.hash), "#4");
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => active(page)).toBe("wrap");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => active(page)).toBe("built");
  await page.keyboard.press("2");
  await expect.poll(() => active(page)).toBe("demo");
  assert.equal(await page.evaluate(() => [...document.querySelectorAll("section[data-slide]")].filter(node => !node.hasAttribute("data-active")).every(node => node.inert && node.getAttribute("aria-hidden") === "true")), true, "inactive slides are inert");
  const demo = page.getByRole("link", {name: /Open the demo/});
  assert.equal(await demo.getAttribute("href"), "/garage?presenter=1&reset=1");
  assert.equal(await demo.getAttribute("target"), "_blank");
  // Only the tab handoff is tested here; the garage flow has its own harness.
  await page.context().route("**/garage?presenter=1&reset=1", route => route.fulfill({contentType: "text/html", body: "<p>Demo tab fixture</p>"}));
  const popupReady = page.waitForEvent("popup");
  await demo.click();
  const popup = await popupReady;
  await popup.waitForLoadState("domcontentloaded");
  await popup.close();
  await page.bringToFront();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => active(page)).toBe("hood");
  await page.keyboard.press("f");
  await expect(page.locator("[data-fullscreen=true]")).toHaveCount(1);
  await page.keyboard.press("f");
  await expect(page.locator("[data-fullscreen=true]")).toHaveCount(0);
  await page.keyboard.press("t");
  await page.waitForTimeout(2300);
  assert.match(await page.getByRole("timer").innerText(), /0:0[1-3] \/ 7:00/);
  await page.keyboard.press("t");
  await expect(page.getByRole("timer")).toHaveCount(0);
  await page.getByRole("button", {name: /Wrap-up/}).click();
  await expect.poll(() => active(page)).toBe("wrap");
  await page.context().close();

  const reduced = await open({width: 1366, height: 768});
  await reduced.emulateMedia({reducedMotion: "reduce"});
  for (const key of ["1", "3"]) {
    await reduced.keyboard.press(key);
    await expect.poll(() => reduced.evaluate(() => document.getAnimations().filter(animation => animation.effect?.getTiming().iterations === Infinity).length)).toBe(0);
  }
  await reduced.context().close();

  // Nothing spills out of the 1920 × 1080 stage, and the code excerpt fits its panel, at the sizes a talk is given on.
  for (const size of [{width: 1920, height: 1080}, {width: 1366, height: 768}, {width: 1280, height: 720}]) {
    const view = await open(size);
    for (const [index, id] of ["built", "demo", "hood", "challenges", "wrap"].entries()) {
      await view.keyboard.press(String(index + 1));
      await expect.poll(() => active(view)).toBe(id);
      await view.waitForTimeout(3300); // the entrance has played
      const spill = await view.evaluate(() => {
        const slide = document.querySelector("section[data-active]");
        const stage = slide.getBoundingClientRect();
        const out = [];
        for (const node of slide.querySelectorAll("h2, h3, p, span, small, b, li, a, pre, figcaption")) {
          if (node.closest("svg") || node.matches("[aria-hidden=true]")) continue;
          if (node.children.length && node.tagName !== "PRE" && !node.matches("h2, h3, p, li, a")) continue;
          const rect = node.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          if (rect.left < stage.left - 1 || rect.right > stage.right + 1 || rect.top < stage.top - 1 || rect.bottom > stage.bottom + 1) out.push(`${node.tagName}:${(node.textContent || "").slice(0, 30)}`);
        }
        const pre = slide.querySelector("pre");
        if (pre && pre.scrollWidth > pre.clientWidth + 1) out.push("code excerpt is wider than its panel");
        return out;
      });
      assert.deepEqual(spill, [], `${id} at ${size.width}x${size.height}`);
      if (output) await view.screenshot({path: `${output}/${id}-${size.width}.png`});
    }
    await view.context().close();
  }
  assert.deepEqual(errors, []);
  console.log("present ok: address, keys, timer, demo link, no overflow at 1920, 1366 and 1280");
} finally {
  await browser.close();
}
