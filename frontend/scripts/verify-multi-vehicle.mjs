import { chromium } from "playwright";
import assert from "node:assert/strict";
const base = process.env.BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({ args: ["--no-sandbox", "--enable-gpu", "--use-gl=angle", "--use-angle=gl"] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const external = [], errors = [], models = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin) {
      external.push(url.href);
      return route.abort();
    }
    if (url.pathname.endsWith(".glb")) models.push(url.pathname);
    return route.continue();
  });
  await page.goto(base);
  await page.waitForSelector('canvas[data-loaded="true"]', { timeout: 60000 });
  assert.equal(await page.locator("iframe").count(), 0);
  assert.equal(await page.locator(".vehicle-choice").count(), 1);
  assert.equal(await page.getByRole("button", {name: /Chọn.*(Civic|Prelude|VinFast|CR-V|Kona)/}).count(), 0);
  await page.getByLabel("Tìm xe", {exact: true}).fill("m2");
  assert.equal(await page.locator(".vehicle-choice").count(), 1);
  await page.getByLabel("Tìm xe", {exact: true}).fill("civic");
  assert.equal(await page.locator(".vehicle-choice").count(), 0);
  await page.getByRole("button", {name: "Xóa bộ lọc"}).click();
  await page.screenshot({path: "docs/screenshots/local-garage.png", fullPage: true});
  assert.deepEqual(models, ["/models/bmw-m2.glb"]);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  console.log("Local catalog passed: GLB rendered, no external requests or iframes, removed cars absent, search passed.");
} finally { await browser.close(); }
