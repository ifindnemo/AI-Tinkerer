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
 assert.match(await page.getByTestId('backend-incident').innerText(),/Sự cố:/);
 await page.getByTestId('backend-nearby-garages').waitFor({timeout:30000});
 assert(await page.getByTestId('backend-nearby-garages').locator('li').count()>0);
 await page.screenshot({path:'docs/screenshots/backend-agent-live.png',fullPage:true});
 await page.getByLabel('Kịch bản mô phỏng').selectOption('offline');const count=batches.length;await page.waitForTimeout(1300);assert.equal(batches.length,count);assert.equal(await page.getByTestId('backend-agent-phase').getAttribute('data-phase'),'paused');
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(400);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'docs/screenshots/backend-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS live backend batch, normal result, real incident response with nearby garages, offline, mobile and hydration.');
}finally{await browser.close();}
