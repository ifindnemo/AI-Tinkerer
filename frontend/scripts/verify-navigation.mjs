import assert from "node:assert/strict";
import {chromium, expect} from "@playwright/test";

const base = process.env.BASE_URL || "http://127.0.0.1:3000";
const routes = ["/", "/garage", "/driver", "/film", "/present", "/workflow"];
const labels = {vi: ["Trang chủ", "Garage", "Tài xế", "Phim giới thiệu", "Trình chiếu", "Workflow"], en: ["Home", "Garage", "Driver", "Intro film", "Presentation", "Workflow"]};
const browser = await chromium.launch({args: ["--no-sandbox"]});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {if (/hydration|server rendered HTML/i.test(message.text())) errors.push(message.text());});
  await page.addInitScript(() => localStorage.setItem("car-neuron.agent-mode", "mock"));
  for (const lang of ["vi", "en"]) {
    await page.goto(base);
    await page.getByRole("button", {name: lang.toUpperCase(), exact: true}).click();
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({width, height: 900});
      let reference;
      for (const path of routes) {
        await page.goto(`${base}${path}`);
        await page.evaluate(() => document.fonts.ready);
        const header = page.locator(".site-header-inner"), links = header.locator(".site-nav a");
        await expect(links).toHaveText(labels[lang]);
        assert.deepEqual(await links.evaluateAll(items => items.map(item => item.getAttribute("href"))), routes);
        await expect(header.locator('a[aria-current="page"]')).toHaveAttribute("href", path);
        await expect(header.locator(".brand-name")).toBeVisible();
        assert.equal(await header.locator('[role="group"]').count(), 1, "one language control");
        for (const link of await links.all()) {
          await expect(link).toBeVisible();
          const rect = await link.boundingBox();
          assert.ok(rect.x >= 0 && rect.x + rect.width <= width && rect.height >= 44, "visible, touch-sized navigation link");
        }
        const rect = await header.boundingBox();
        if (reference) for (const key of ["x", "y", "width", "height"]) assert.ok(Math.abs(rect[key] - reference[key]) < 1, `${path}: consistent header ${key}`);
        else reference = rect;
      }
    }
  }
  await page.goto(`${base}/garage`);
  await page.getByRole("button", {name: "VI", exact: true}).click();
  await page.getByRole("button", {name: "Dữ liệu blackbox", exact: true}).click();
  await expect(page.getByRole("button", {name: "Dữ liệu blackbox", exact: true})).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", {name: "OBD", exact: true}).click();
  await expect(page.locator(".live-garage")).toBeVisible();
  await expect(page.locator('.site-nav a[aria-current="page"]')).toHaveAttribute("href", "/garage");
  await page.getByRole("button", {name: "Dữ liệu OBD", exact: true}).click();
  await expect(page.getByRole("button", {name: "Dữ liệu OBD", exact: true})).toHaveAttribute("aria-current", "page");
  for (const path of ["/driver", "/film", "/present", "/workflow", "/garage", "/"]) {
    await page.locator(`.site-nav a[href="${path}"]`).click();
    await expect(page).toHaveURL(`${base}${path}`);
    await expect(page.locator('.site-nav a[aria-current="page"]')).toHaveAttribute("href", path);
  }
  assert.deepEqual(errors, []);
  console.log("PASS: shared navigation across all six pages and both garage modes; VI/EN, 320–1440 px, active links, touch targets, tabs and route transitions.");
} finally {
  await browser.close();
}
