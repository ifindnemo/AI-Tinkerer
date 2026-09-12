import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
});
const errors = [];
console.log("Browser started");
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
page.setDefaultTimeout(30000);
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.env.BASE_URL || "http://localhost:3000", { waitUntil: "networkidle" });
await page.waitForSelector('canvas[data-loaded="true"]', { timeout: 60000 });
await page.waitForTimeout(1000);
await page.screenshot({ path: "docs/screenshots/desktop.png", fullPage: true });
assert.equal(await page.locator("canvas").count(), 1);
await page
  .getByRole("button", { name: "Màu Zandvoort Blue", exact: true })
  .click();
assert.equal(
  await page
    .getByRole("button", { name: "Màu Zandvoort Blue", exact: true })
    .getAttribute("aria-pressed"),
  "true",
);
await page.getByRole("button", { name: "Tự xoay xe", exact: true }).click();
assert.equal(
  await page
    .getByRole("button", { name: "Tự xoay xe", exact: true })
    .getAttribute("aria-pressed"),
  "true",
);
await page
  .getByRole("button", { name: "Đặt lại góc nhìn", exact: true })
  .evaluate((el) => el.click());
console.log("Model and controls passed");
await page
  .getByRole("button", { name: "Màu Alpine White", exact: true })
  .click();
await page.getByRole("button", { name: "Analysis", exact: true }).click();
await page
  .getByRole("heading", { name: "Chiếc xe đang ở trạng thái tốt", exact: true })
  .waitFor();
const downloadPromise = page.waitForEvent("download");
await page
  .getByRole("button", { name: "Xuất báo cáo JSON", exact: true })
  .click();
const download = await downloadPromise;
assert.ok(download.suggestedFilename().endsWith(".json"));
console.log("Normal analysis and export passed");
for (const [id, title] of [
  ["environment", "Nhiệt độ cao do môi trường"],
  ["engine", "Dấu hiệu quá nhiệt động cơ"],
]) {
  await page.getByLabel("Kịch bản mô phỏng").selectOption(id);
  await page.getByRole("button", { name: "Analysis", exact: true }).click();
  await page.getByRole("heading", { name: title, exact: true }).waitFor();
  if (id === "engine")
    await page.screenshot({
      path: "docs/screenshots/engine-analysis.png",
      fullPage: true,
    });
}
await page.getByLabel("Kịch bản mô phỏng").selectOption("offline");
await page.getByRole("button", { name: "Analysis", exact: true }).click();
await page.getByText("Chưa thể phân tích", { exact: true }).waitFor();
assert.equal(await page.locator(".analysis-result").count(), 0);
await page.getByRole("button", { name: /Lịch sử phân tích/ }).click();
assert.equal(await page.locator(".history-row").count(), 3);
await page
  .getByRole("button", { name: "Dữ liệu blackbox", exact: true })
  .click();
assert.equal(await page.locator(".data-panel tbody tr").count(), 11);
await page.getByRole("button", { name: "Tổng quan", exact: true }).click();
await page.getByLabel("Kịch bản mô phỏng").selectOption("normal");
await page.getByRole("button", { name: "Analysis", exact: true }).click();
await page.getByLabel("Kịch bản mô phỏng").selectOption("environment");
await page.waitForTimeout(3000);
assert.equal(await page.locator(".analysis-result").count(), 0);
await page
  .getByRole("button", { name: "Tùy chỉnh mô phỏng", exact: true })
  .click();
await page.getByLabel("Giao diện", { exact: true }).selectOption("midnight");
await page.getByRole("button", { name: "Hoàn tất", exact: false }).click();
await page.screenshot({
  path: "docs/screenshots/midnight.png",
  fullPage: true,
});
await page
  .getByRole("button", { name: "Tùy chỉnh mô phỏng", exact: true })
  .click();
await page.getByLabel("Giao diện", { exact: true }).selectOption("studio");
await page.keyboard.press("Escape");
await page.getByLabel("Kịch bản mô phỏng").selectOption("normal");
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(1000);
assert.equal(
  await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  ),
  true,
  "mobile must not overflow",
);
await page.screenshot({ path: "docs/screenshots/mobile.png", fullPage: true });
await page.getByRole("button", { name: "Analysis", exact: true }).click();
await page
  .getByRole("heading", { name: "Chiếc xe đang ở trạng thái tốt", exact: true })
  .waitFor();
assert.equal(
  await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  ),
  true,
  "mobile analysis must not overflow",
);
assert.deepEqual(errors, []);
console.log(
  "PASS: model, paint, rotation/reset, four analysis scenarios, export, history, telemetry, cancellation, themes, dialog, mobile layout. No page errors.",
);
await browser.close();
