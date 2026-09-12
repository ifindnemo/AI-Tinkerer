import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({args: ["--no-sandbox", "--enable-gpu", "--use-gl=angle", "--use-angle=gl"]});
try {
  const page = await browser.newPage({viewport: {width:1440,height:1000}});
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(process.env.BASE_URL || "http://localhost:3001");
  await page.waitForSelector('canvas[data-loaded="true"]', {timeout:60000});
  await page.waitForTimeout(600);
  if (process.env.CAPTURE_THUMBNAIL) await page.locator("canvas").screenshot({path:"public/models/bmw-m2-thumbnail.png"});
  let previous = await page.locator("canvas").screenshot();
  for (const name of ["Trước", "Sau", "Bên hông", "Từ trên", "Góc 3/4"]) {
    const button = page.getByRole("button", {name, exact:true});
    await button.click();
    await page.waitForTimeout(800);
    assert.equal(await button.getAttribute("aria-pressed"), "true");
    const current = await page.locator("canvas").screenshot();
    assert.notDeepEqual(current, previous, `camera ${name} must change rendering`);
    previous = current;
  }
  await page.getByRole("button", {name:"Xem Động cơ",exact:true}).click();
  await page.getByText("Chưa có kết quả Analysis cho dữ liệu hiện tại.", {exact:true}).waitFor();
  await page.getByRole("button", {name:"Đóng",exact:true}).click();
  for (const [scenario, status] of [["normal","good"],["environment","watch"],["engine","critical"]]) {
    await page.getByLabel("Kịch bản mô phỏng").selectOption(scenario);
    assert.equal(await page.locator(".engine-marker.unknown").count(),2);
    await page.getByRole("button", {name:"Analysis",exact:true}).click();
    await page.locator(`.viewer-assessment.${status}`).waitFor({timeout:15000});
    assert.equal(await page.locator(`.engine-marker.${status}`).count(),2);
  }
  await page.getByRole("button", {name:"Xem Làm mát",exact:true}).click();
  await page.getByText("Chưa có cảm biến riêng để kết luận két nước hoặc quạt bị hỏng.", {exact:true}).waitFor();
  assert.match(await page.locator("#sensor-detail").innerText(), /121°C/);
  await page.screenshot({path:"docs/screenshots/3d-insights.png",fullPage:true});
  await page.getByLabel("Kịch bản mô phỏng").selectOption("offline");
  assert.equal(await page.locator(".engine-marker.critical").count(),0);
  assert.match(await page.locator("#sensor-detail").innerText(), /Không có dữ liệu/);
  await page.getByRole("button", {name:"Đóng",exact:true}).click();
  await page.getByRole("button", {name:"Hiện cảm biến",exact:true}).click();
  assert.equal(await page.locator(".engine-marker").count(),0);
  await page.getByRole("button", {name:"Hiện cảm biến",exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await page.getByLabel("Kịch bản mô phỏng").selectOption("normal");
  await page.getByRole("button", {name:"Góc 3/4",exact:true}).click();
  await page.waitForTimeout(500);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const stage = await page.locator(".viewer").boundingBox();
  for (const label of await page.locator(".marker-label").all()) {
    const box = await label.boundingBox();
    assert(box.x >= stage.x && box.x + box.width <= stage.x + stage.width, "mobile labels must remain inside stage");
  }
  await page.screenshot({path:"docs/screenshots/3d-mobile.png",fullPage:true});
  assert.deepEqual(errors,[]);
  console.log("PASS: five real camera views, hotspot details, status transitions, offline reset, marker toggle, mobile, no page errors.");
} finally {await browser.close();}
