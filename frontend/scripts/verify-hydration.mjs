import { chromium } from "playwright";
import assert from "node:assert/strict";
const base = process.env.BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({args:["--no-sandbox","--enable-gpu","--use-gl=angle","--use-angle=gl"]});
try {
  // Inspect actual server HTML without running hydration or the live stream.
  const serverContext = await browser.newContext({javaScriptEnabled:false});
  const serverPage = await serverContext.newPage();
  await serverPage.goto(base);
  assert.equal(await serverPage.locator('.agent-loading[aria-busy="true"]').count(),1);
  assert.equal(await serverPage.getByRole('button',{name:'Inject Overheating',exact:true}).count(),0);
  await serverContext.close();
  for (const delay of [0, 700]) {
    const context = await browser.newContext({locale: "en-US", timezoneId: "America/Los_Angeles"});
    const page = await context.newPage();
    const problems=[];
    page.on('pageerror',error=>problems.push(error.message));
    page.on('console',message=>{if(/hydrat|server rendered HTML/i.test(message.text()))problems.push(message.text());});
    if(delay)await page.route('**/*',async route=>{
      if(route.request().resourceType()==='script')await new Promise(resolve=>setTimeout(resolve,delay));
      await route.continue();
    });
    for (let round=0;round<2;round++) {
      await page.goto(base);
      const inject=page.getByRole('button',{name:'Inject Overheating',exact:true});
      await inject.waitFor();
      await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('Inject Overheating'))?.disabled);
      assert.equal(await inject.isDisabled(),false);
      await page.getByLabel('Kịch bản mô phỏng').selectOption('offline');
      assert.equal(await inject.isDisabled(),true);
      await page.getByLabel('Kịch bản mô phỏng').selectOption('normal');
      await page.locator('.health-overview.good').waitFor();
      await inject.click();
      await page.getByTestId('incident-status').filter({hasText:'Đã cảnh báo'}).waitFor();
      await page.getByLabel('Kịch bản mô phỏng').selectOption('normal');
    }
    assert.deepEqual(problems,[],`no hydration errors with script delay ${delay}`);
    await context.close();
  }
  console.log('PASS: stable SSR placeholder, four hydrated loads including delayed scripts/different timezone, live/offline button state, and working injection; no console hydration warnings or page errors.');
} finally {await browser.close();}
