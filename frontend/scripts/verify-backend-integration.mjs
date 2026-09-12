import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({args:['--no-sandbox','--enable-gpu','--use-gl=angle','--use-angle=gl']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1080}});const errors=[],batches=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(/hydration|server rendered HTML/i.test(m.text()))errors.push(m.text());});
 page.on('request',r=>{if(r.url().endsWith('/api/vehicle/telemetry'))batches.push(r.postDataJSON());});
 await page.goto('http://localhost:3000');
 await page.getByTestId('backend-response').waitFor({timeout:65000});
 assert.equal(batches[0].records.length,15);assert.equal(batches[0].records[0].units.speed,'raw');
 const id=await page.getByTestId('backend-response').getAttribute('data-batch-id');await page.waitForTimeout(1800);
 assert.equal(await page.getByTestId('backend-response').getAttribute('data-batch-id'),id);
 await page.screenshot({path:'docs/screenshots/backend-normal.png',fullPage:true});
 await page.getByRole('button',{name:'Inject Overheating',exact:true}).click();
 await page.waitForFunction(previous=>document.querySelector('[data-testid="backend-response"]')?.getAttribute('data-batch-id')!==previous,id,{timeout:145000});
 await page.getByTestId('backend-incident').waitFor({timeout:145000});
 const incident=await page.getByTestId('backend-incident').getAttribute('data-incident-id');
 assert.match(await page.getByTestId('backend-incident').innerText(),/Sự cố:/);
 await page.screenshot({path:'docs/screenshots/backend-agent-live.png',fullPage:true});
 // Simulate only action endpoints: never book on the user's real database in a browser test.
 let prepared=0,confirmed=0,pending=null;
 await page.route('**/api/vehicle/incidents/**',async route=>{
  const req=route.request();const path=new URL(req.url()).pathname;
  if(path.endsWith('/action')){
   const body=req.postDataJSON();prepared++;
   pending={id:'act_browser_test',incident_id:incident,action_type:body.action,payload:{scheduled_for:body.scheduled_for,garage_id:body.garage_id,slot:body.slot},status:'pending_confirmation'};
   return route.fulfill({json:{status:'pending_confirmation',requires_confirmation:true,pending_action:pending}});
  }
  if(path.endsWith('/confirm')){confirmed++;assert.equal(req.postDataJSON().pending_action_id,pending.id);await new Promise(r=>setTimeout(r,300));return route.fulfill({json:{status:'executed',action_type:pending.action_type,result:{id:'rem_browser_test',scheduled_for:pending.payload.scheduled_for}}});}
  return route.continue();
 });
 const planner=page.getByRole('region',{name:'Đặt lịch qua backend'});
 await planner.getByRole('button',{name:'Nhắc tôi sau',exact:true}).click();
 await planner.locator('input[type="datetime-local"]').fill('2030-12-15T09:30');
 await planner.getByRole('button',{name:'Xem lại & xác nhận',exact:true}).click();
 await planner.getByText('Kiểm tra trước khi xác nhận').waitFor();assert.equal(prepared,1);assert.equal(confirmed,0);
 const confirm=planner.getByRole('button',{name:'Xác nhận lưu trên hệ thống',exact:true});assert(await confirm.isDisabled());
 await planner.getByRole('checkbox').check();await confirm.click();await planner.getByText('Đã lưu nhắc nhở trên backend',{exact:true}).waitFor();assert.equal(confirmed,1);
 await page.getByLabel('Kịch bản mô phỏng').selectOption('offline');const count=batches.length;await page.waitForTimeout(1300);assert.equal(batches.length,count);assert.equal(await page.getByTestId('backend-agent-phase').getAttribute('data-phase'),'paused');
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(400);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'docs/screenshots/backend-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS live backend batch, normal result, real incident response, consent-gated action UI (intercepted), offline, mobile and hydration.');
}finally{await browser.close();}
