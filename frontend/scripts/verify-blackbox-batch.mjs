import {chromium} from "playwright";
import {readFile} from "node:fs/promises";
import assert from "node:assert/strict";
const browser=await chromium.launch({args:["--no-sandbox","--enable-gpu","--use-gl=angle","--use-angle=gl"]});
try{
 const page=await browser.newPage();const errors=[],posts=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(/hydrat|server rendered HTML/i.test(m.text()))errors.push(m.text());});
 page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
 await page.goto(process.env.BASE_URL||'http://localhost:3000');
 await page.getByText('Cập nhật mỗi 1 giây',{exact:true}).waitFor();
 const download=page.getByRole('button',{name:'JSON 15 mẫu',exact:true});
 assert.equal(await download.isDisabled(),true);
 const before=await page.getByTestId('live-rpm').innerText();await page.waitForTimeout(1150);
 assert.notEqual(await page.getByTestId('live-rpm').innerText(),before);
 await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('JSON 15 mẫu'))?.disabled,{},{timeout:20000});
 const firstDownload=page.waitForEvent('download');await download.click();
 const payload=JSON.parse(await readFile(await (await firstDownload).path(),'utf8'));
 assert.equal(payload.recordCount,15);assert.equal(payload.records.length,15);assert.equal(payload.sampleIntervalMs,1000);assert.equal(payload.source,'simulated');
 for(let i=1;i<15;i++){
  const interval=Date.parse(payload.records[i].capturedAt)-Date.parse(payload.records[i-1].capturedAt);
  assert(interval>800 && interval<1400,`one-second real browser timer, got ${interval}`);
 }
 assert.equal(payload.vehicleId,'bmw-m2');
 for(const record of payload.records){assert(!('analysis' in record));assert(!('incident' in record));assert(!('agent' in record));assert(!('scenario' in record));}
 await page.getByLabel('Kịch bản mô phỏng').selectOption('offline');
 await page.waitForTimeout(1300);assert.equal(await page.getByTestId('batch-buffer').innerText(),'Đang gom 0/15');
 await page.getByLabel('Kịch bản mô phỏng').selectOption('normal');
 await page.waitForTimeout(2200);
 const text=await page.getByTestId('batch-buffer').innerText();assert.match(text,/Đang gom [23]\/15/);
 assert.deepEqual(posts,[],'no backend request is made');assert.deepEqual(errors,[]);
 console.log('PASS: live one-second updates, 15-record downloadable batch, sensor-only payload, offline reset and no POST requests.');
}finally{await browser.close();}
