// Offline browser regression. Real MediaRecorder/VAD/Web Audio; only device and provider boundaries are faked.
import assert from 'node:assert/strict';
import {chromium, expect} from '@playwright/test';
const base = process.env.BASE_URL || 'http://127.0.0.1:3299';
const browser = await chromium.launch({args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']});
function audioFixture(seconds) {
const count = Math.round(16000 * seconds);
const wav = Buffer.alloc(44 + count * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22);
wav.writeUInt32LE(16000,24); wav.writeUInt32LE(32000,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34);
wav.write('data',36); wav.writeUInt32LE(count * 2,40);
for(let i=0;i<count;i++) wav.writeInt16LE(Math.round(Math.sin(i * 2*Math.PI*440/16000)*1000),44+i*2);
return wav;
}
const wav = audioFixture(0.25), longWav = audioFixture(2);
const identities = new Set();
async function hydrated(page) {
 await page.waitForFunction(() => {
  const robot=document.querySelector('[data-testid="agent-robot"]');
  return robot && Object.keys(robot).some(key=>key.startsWith('__reactProps'));
 });
}
try {
 for (const lang of ['vi', 'en']) {
  const context = await browser.newContext({viewport: {width: 1366,height:900}});
  await context.addInitScript(({lang}) => {
   localStorage.setItem('car-neuron.lang',lang);
   localStorage.setItem('car-neuron.agent-lang',lang);
   window.__starts = 0;
   window.__wake = {active: false, starts: 0, instance: null};
   window.SpeechRecognition = class {
    constructor() {window.__wake.instance = this; this.active = false;}
    start() {if(this.active) throw new Error('already active'); this.active=true; window.__wake.active=true; window.__wake.starts++; this.onstart?.();}
    stop() {this.active=false; window.__wake.active=false; queueMicrotask(()=>this.onend?.());}
    abort() {this.stop();}
   };
   window.__emitWake = (text, isFinal=true) => {
    const rec=window.__wake.instance;
    if(!rec?.active) throw new Error('Wake recognizer is not running');
    rec.onresult?.({resultIndex:0,results:[{isFinal,0:{transcript:text}}]});
   };
   const startSource = AudioBufferSourceNode.prototype.start;
   AudioBufferSourceNode.prototype.start = function (...args) { window.__starts += 1; return startSource.apply(this, args); };
   window.__mic = {opened:0, stopped:0, gain:null, fail:false, openLog:[]};
   navigator.mediaDevices.getUserMedia = async () => {
    if(window.__mic.fail) throw new DOMException('denied','NotAllowedError');
    if(window.__mic.delay) await new Promise(resolve=>{window.__mic.resolve=resolve;});
    const context = new AudioContext(); await context.resume();
    const osc = context.createOscillator(); const gain = context.createGain(); gain.gain.value=0;
    const target=context.createMediaStreamDestination(); osc.connect(gain); gain.connect(target); osc.start();
    // Wall-clock time and the number of audio buffers started so far, taken at the moment the mic opens.
    window.__mic.gain=gain; window.__mic.opened++; window.__mic.openLog.push({at:Date.now(), starts:window.__starts});
    for(const track of target.stream.getTracks()) {
     const stop=track.stop.bind(track); let stopped=false;
     track.stop=()=>{if(stopped)return; stopped=true;window.__mic.stopped++;stop();osc.stop();void context.close();};
    }
    return target.stream;
   };
  }, {lang});
  let clips=[], seq=0, mode='ok', talkCount=0, sttCount=0, cancelCount=0, finalPartAt=0, partGap=1200, limited=false, releaseReply=null;
  const talkIds=[], unexpected=[];
  const field=(body,key)=>body.match(new RegExp(`name="${key}"\\r\\n\\r\\n([^\\r]*)`))?.[1];
  await context.route('**/api/**', async route => {
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/talk/cancel')) {cancelCount++;return route.fulfill({json:{ok:true}});}
   if(path.endsWith('/transcribe')) {
    sttCount++;
    if(mode==='stt-429' || (mode==='stt-429-once' && !limited && (limited=true))) return route.fulfill({status:429,headers:{'retry-after':'1'},json:{error:'rate limited'}});
    if(mode==='stt-error') return route.fulfill({status:502,json:{error:'offline error'}});
    return route.fulfill({json:{text: mode==='empty' ? '' : lang==='vi' ? 'Xe hiện tại thế nào?' : 'How is the car now?'}});
   }
   if(path.endsWith('/talk')) {
    talkCount++;
    const body=route.request().postData() || '';
    const conv=field(body,'conversationId'), turn=field(body,'turnId');
    assert.ok(conv && turn); talkIds.push(`${conv}:${turn}`);
    if(mode==='slow') await new Promise(resolve=>setTimeout(resolve,2500));
    if(talkIds.length===1) {assert.ok(!identities.has(conv)); identities.add(conv);}
    if(mode==='stale') return route.fulfill({json:{stale:true}});
    if(mode==='malformed') return route.fulfill({contentType:'application/json',body:'{broken'});
    if(mode==='talk-error') return route.fulfill({status:502,json:{error:'offline error'}});
    const reply=(mode==='slow' ? 'LATE_RESPONSE ' : '')+(lang==='vi' ? 'Đây là câu trả lời thử nghiệm. Dữ liệu đang được theo dõi.' : 'This is a test answer. The readings are being monitored.');
    if(mode!=='no-audio' && mode!=='text-only') {
     const capturedMode=mode;
     finalPartAt=Date.now()+partGap;
     for(const index of [0,1]) setTimeout(()=>{
      const id=++seq;
      clips.push({id:`clip_${id}`,seq:id,severity:'normal',text:reply,created_at:new Date().toISOString(),group:`talk:${conv}:${turn}`,part_index:index,part_count:2,broken:capturedMode==='decode-error',long:capturedMode==='early-running' || capturedMode==='wake'});
     },index===0 ? 100 : partGap);
    }
    const fulfill=()=>route.fulfill({json:{text:'question',reply,spoken:mode!=='text-only',stale:false}});
    if(mode.startsWith('early-')) return new Promise(resolve=>{releaseReply=()=>{releaseReply=null;resolve(fulfill());};});
    return fulfill();
   }
   if(path.endsWith('/clips')) {
    const after=Number(new URL(route.request().url()).searchParams.get('after')||0);
    return route.fulfill({json:{enabled:true,lang,latest:seq,clips:clips.filter(c=>c.seq>after)}});
   }
   if(path.endsWith('/audio')) {
    const clip=clips.find(c=>path.includes(c.id));
    return route.fulfill({contentType:'audio/wav',body:clip?.broken ? Buffer.from('invalid') : clip?.long ? longWav : wav});
   }
   // The page may call other routes (voice options, settings). Record them so a surprise request is visible in the result.
   // Voice options and the structured attention events of a simulated scenario are expected; nothing else is.
   if(!/\/api\/voice\/voices|\/api\/driver\/events/.test(path)) unexpected.push(path);
   return route.fulfill({json:{}});
  });
  const page=await context.newPage(); const errors=[], metrics=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{
   if(/same key|unique.*key/i.test(message.text())) errors.push(message.text());
   const prefix='car-neuron talk metrics ';
   if(message.text().startsWith(prefix)) metrics.push(JSON.parse(message.text().slice(prefix.length)));
  });
  await page.goto(`${base}/driver?debug=1`,{waitUntil:'domcontentloaded'});
  await expect(page.getByTestId('agent-robot')).toBeVisible();
  await hydrated(page);
  await page.getByTestId('alert-quiet').click();
  await expect(page.getByTestId('alert-quiet-remaining')).toBeVisible();
  await page.getByTestId('agent-robot').click();
  const speak = async () => {
   await page.evaluate(()=>{window.__mic.gain.gain.value=0.08;});
   await page.waitForTimeout(650);
   await page.evaluate(()=>{window.__mic.gain.gain.value=0;});
  };
  await page.getByTestId('agent-talk-panel').click();
  await expect.poll(()=>page.evaluate(()=>window.__mic.opened)).toBe(1);
  for(let turn=0;turn<5;turn++) {
   await speak();
   await expect.poll(()=>talkCount).toBe(turn+1);
   // The follow-up mic opens only after the final part exists AND both parts have started playing.
   await expect.poll(()=>page.evaluate(()=>window.__mic.opened),{timeout:8000}).toBe(turn+2);
   const opening=await page.evaluate(index=>window.__mic.openLog[index],turn+1);
   assert.ok(opening.at>=finalPartAt,`follow-up mic opened ${finalPartAt-opening.at} ms before the final TTS part existed`);
   assert.ok(opening.starts>=2*(turn+1),`follow-up mic opened with only ${opening.starts} audio buffers started`);
  }
  assert.equal(sttCount,5); assert.equal(new Set(talkIds).size,5);
  await expect.poll(()=>metrics.some(metric=>metric.outcome==='spoken' && typeof metric.replyToAudioMs==='number' && metric.replyToAudioMs>=0)).toBe(true);
  if(lang==='en') {
   const before=sttCount;
   await page.waitForTimeout(8000);
   await page.evaluate(()=>{window.__mic.gain.gain.value=0.08;});
   await page.waitForTimeout(5000);
   assert.equal(sttCount,before,'follow-up speech must continue beyond ten seconds');
   assert.equal(await page.evaluate(()=>window.__mic.opened-window.__mic.stopped),1);
   await page.evaluate(()=>{window.__mic.gain.gain.value=0;});
   await expect.poll(()=>sttCount).toBe(before+1);
   await expect.poll(()=>page.evaluate(()=>window.__mic.opened-window.__mic.stopped),{timeout:8000}).toBe(1);
  }
  await page.getByTestId('talk-end').click();
  await expect.poll(()=>page.evaluate(()=>window.__mic.opened-window.__mic.stopped)).toBe(0);
  // Typed submission while microphone is active must stop the capture immediately.
  await page.getByTestId('agent-talk-panel').click();
  await expect.poll(()=>page.evaluate(()=>window.__mic.opened-window.__mic.stopped)).toBe(1);
  await expect(page.getByTestId('alert-quiet-remaining')).toBeVisible();
  mode='talk-error';
  await page.getByTestId('talk-text').fill('Typed while recording'); await page.getByTestId('talk-send').click();
  await expect.poll(()=>page.evaluate(()=>window.__mic.opened-window.__mic.stopped)).toBe(0);
  await expect(page.getByTestId('talk-status')).toContainText(/Thử lại|Try again/);
  await expect(page.getByTestId('alert-quiet-remaining')).toBeVisible();
  for(const failure of ['empty','stt-error']) {
   mode=failure;
   await page.getByTestId('agent-talk-panel').click();
   await expect.poll(()=>page.evaluate(()=>window.__mic.opened-window.__mic.stopped)).toBe(1);
   await speak();
   await expect.poll(()=>page.evaluate(()=>window.__mic.opened-window.__mic.stopped)).toBe(0);
   await expect(page.getByTestId('talk-status')).toContainText(/Không nghe rõ|could not hear|Thử lại|Try again/);
  }
  for(const failure of ['stale','malformed']) {
   mode=failure;
   await page.getByTestId('talk-text').fill('Another question'); await page.getByTestId('talk-send').click();
   await page.waitForTimeout(400);
   assert.equal(await page.evaluate(()=>window.__mic.opened-window.__mic.stopped),0);
   await expect(page.getByTestId('agent-dock')).not.toHaveAttribute('data-state','thinking');
  }
  mode='ok';
  await page.evaluate(()=>{window.__mic.delay=true;});
  await page.getByTestId('agent-talk-panel').click();
  await expect.poll(()=>page.evaluate(()=>typeof window.__mic.resolve)).toBe('function');
  await page.getByTestId('talk-end').click();
  await page.evaluate(()=>{window.__mic.delay=false;window.__mic.resolve();});
  await expect.poll(()=>page.evaluate(()=>window.__mic.opened-window.__mic.stopped)).toBe(0);
  await page.evaluate(()=>{window.__mic.fail=true;});
  await page.getByTestId('agent-talk-panel').click();
  await expect(page.getByTestId('talk-status')).toContainText(/quyền micro|permission was denied/);
  await page.evaluate(()=>{window.__mic.fail=false;});
  if(lang==='en') {
   mode='no-audio';
   await page.getByTestId('talk-text').fill('No audio test'); await page.getByTestId('talk-send').click();
   await expect.poll(()=>page.evaluate(()=>window.__mic.opened-window.__mic.stopped),{timeout:16000}).toBe(1);
   await page.getByTestId('talk-end').click();
   mode='decode-error';
   await page.getByTestId('talk-text').fill('Broken audio test'); await page.getByTestId('talk-send').click();
   await expect.poll(()=>page.evaluate(()=>window.__mic.opened-window.__mic.stopped),{timeout:16000}).toBe(1);
   await page.getByTestId('talk-end').click();
  }
  const openMics=()=>page.evaluate(()=>window.__mic.opened-window.__mic.stopped);
  const startsNow=()=>page.evaluate(()=>window.__starts);
  const openPanel=async()=>{if(!(await page.getByTestId('agent-panel').isVisible())) await page.getByTestId('agent-robot').click(); await expect(page.getByTestId('agent-panel')).toBeVisible();};
  const typed=async text=>{await page.getByTestId('talk-text').fill(text); await page.getByTestId('talk-send').click();};
  const replyCount=()=>page.getByTestId('talk-log').getByText(lang==='vi' ? 'câu trả lời thử nghiệm' : 'test answer').count();
  // Interrupt while the agent is speaking: part 0 has played, part 1 does not exist yet. The old part 1 must never play.
  mode='ok'; partGap=5000;
  let startsBefore=await startsNow(); let cancelsBefore=cancelCount;
  await typed('Interrupt me');
  await page.waitForFunction(count=>window.__starts>=count,startsBefore+1,{polling:20,timeout:8000});
  assert.equal(await startsNow(),startsBefore+1,'part 0 only is playing');
  await page.getByTestId('agent-talk-panel').click();
  await expect.poll(openMics).toBe(1);
  assert.ok(cancelCount>cancelsBefore,'interrupt must tell the server to cancel the old turn');
  await page.waitForTimeout(partGap+1500); // the old second part is registered after the gap
  partGap=1200;
  assert.equal(await startsNow(),startsBefore+1,'the interrupted turn must not play its second part');
  await page.getByTestId('talk-end').click();
  await expect.poll(openMics).toBe(0);
  // STT rate limit: one retry succeeds; a persistent 429 ends in a recoverable error without a stuck mic.
  mode='stt-429-once'; limited=false;
  let sttBefore=sttCount; let talkBefore=talkCount;
  await page.getByTestId('agent-talk-panel').click();
  await expect.poll(openMics).toBe(1);
  await speak();
  await expect.poll(()=>talkCount,{timeout:15000}).toBe(talkBefore+1);
  assert.equal(sttCount-sttBefore,2,'one 429 then one retry');
  await page.getByTestId('talk-end').click();
  await expect.poll(openMics).toBe(0);
  mode='stt-429';
  sttBefore=sttCount; talkBefore=talkCount;
  await page.getByTestId('agent-talk-panel').click();
  await expect.poll(openMics).toBe(1);
  await speak();
  await expect.poll(openMics,{timeout:15000}).toBe(0);
  await expect(page.getByTestId('talk-status')).toContainText(/Không nghe rõ|could not hear|Thử lại|Try again/);
  assert.equal(talkCount,talkBefore,'a failed transcription must not reach the model');
  assert.ok(sttCount-sttBefore<=2,'at most one retry on 429');
  // A slow reply must be dropped when the scenario or the agent language changes while it is in flight.
  mode='slow';
  for(const change of ['scenario','language']) {
   await openPanel();
   const repliesBefore=await replyCount(); startsBefore=await startsNow(); talkBefore=talkCount;
   await typed(`Slow question ${change}`);
   await expect.poll(()=>talkCount).toBe(talkBefore+1); // request is held by the route for 2.5 s
   // A pointer click outside the dock closes its panel and ends the turn on its own; dispatch the click so only the change is tested.
   const control=page.getByTestId(change==='scenario' ? 'sim-drowsy' : lang==='vi' ? 'agent-lang-en' : 'agent-lang-vi');
   await control.evaluate(element=>element.click());
   await expect(page.getByTestId('talk-status')).toContainText(change==='scenario' ? /Đã đổi tình huống|scenario changed/ : /Đã đổi ngôn ngữ|language changed/);
   await expect(page.getByTestId('talk-divider').last()).toContainText(change==='scenario' ? /Tình huống mới|New scenario/ : /Ngôn ngữ đã đổi|Language changed/);
   await expect(page.getByTestId('talk-log').locator('[data-archived="true"]')).not.toHaveCount(0);
   await page.waitForTimeout(4500); // the held reply and its clips arrive after the change
   assert.ok(await replyCount()<=repliesBefore,`a reply from before the ${change} change must not be shown`); // the log may shrink: the change drops the old turn
   await expect(page.getByTestId('talk-log')).not.toContainText('LATE_RESPONSE');
   assert.equal(await startsNow(),startsBefore,`a reply from before the ${change} change must not be spoken`);
   assert.equal(await openMics(),0);
   await expect(page.getByTestId('agent-dock')).not.toHaveAttribute('data-state','thinking');
  }
  await page.getByTestId(lang==='vi' ? 'agent-lang-vi' : 'agent-lang-en').evaluate(element=>element.click()); // back to the language of this run
  // Reload: a new page load gets conversation ids that never collide with any earlier one.
  mode='ok';
  const seenConversations=new Set(talkIds.map(id=>id.split(':')[0]));
  talkBefore=talkCount;
  await page.reload({waitUntil:'domcontentloaded'});
  await hydrated(page);
  await page.getByTestId('agent-robot').click();
  await typed('After reload');
  await expect.poll(()=>talkCount).toBe(talkBefore+1);
  assert.equal(seenConversations.has(talkIds.at(-1).split(':')[0]),false,'conversation id repeated after reload');
  await page.getByTestId('talk-end').click();
  mode='text-only';
  const metricBefore=metrics.length;
  await typed('Text only metric');
  await expect.poll(()=>metrics.slice(metricBefore).some(metric=>metric.outcome==='text-only' && metric.replyToAudioMs===null)).toBe(true);
  await expect.poll(openMics).toBe(1);
  await page.getByTestId('talk-end').click();
  // TTS starts, or even finishes, while the text response is deliberately held behind a barrier.
  for(const early of ['early-running','early-complete']) {
   mode=early; startsBefore=await startsNow();
   await typed(`Question ${early}`);
   await expect.poll(()=>releaseReply!==null).toBe(true);
   await page.waitForFunction(count=>window.__starts>=count, startsBefore+(early==='early-running' ? 1 : 2), {timeout:10000});
   if(early==='early-complete') await page.waitForTimeout(500);
   assert.equal(await openMics(),0,'mic must wait for the text response too');
   releaseReply();
   await expect(page.getByTestId('talk-log')).toContainText(lang==='vi' ? 'câu trả lời thử nghiệm' : 'test answer');
   if(early==='early-running') await expect(page.getByTestId('agent-dock')).toHaveAttribute('data-state','speaking');
   await expect.poll(openMics,{timeout:10000}).toBe(1);
   await expect(page.getByTestId('talk-log').locator('[aria-busy="true"]')).toHaveCount(0);
   await page.getByTestId('talk-end').click();
   await expect.poll(openMics).toBe(0);
  }
  // Wake must stay off unless enabled, resume during actual playback, and accept only explicit final controls.
  assert.equal(await page.evaluate(()=>window.__wake.active),false);
  await page.getByTestId('talk-wake').click();
  await expect.poll(()=>page.evaluate(()=>window.__wake.active)).toBe(true);
  mode='wake'; partGap=5000; startsBefore=await startsNow(); cancelsBefore=cancelCount;
  await typed('Wake interruption fixture');
  await page.waitForFunction(count=>window.__starts>=count, startsBefore+1, {polling:20,timeout:10000});
  await expect.poll(()=>page.evaluate(()=>window.__wake.active)).toBe(true);
  await expect(page.getByTestId('talk-wake')).toHaveAttribute('aria-pressed','true');
  await page.evaluate(()=>{window.__emitWake('stop',true);window.__emitWake('Hey Neuron, stop',false);});
  await expect(page.getByTestId('agent-dock')).toHaveAttribute('data-state','speaking');
  await page.evaluate(()=>window.__emitWake('Hey Neuron, stop',true));
  await expect(page.getByTestId('talk-status')).toContainText(/im cảnh báo|quiet for 60/);
  await expect.poll(()=>cancelCount>cancelsBefore).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.__wake.active)).toBe(false);
  await expect.poll(openMics).toBe(0);
  await page.waitForTimeout(partGap+500);
  assert.equal(await startsNow(),startsBefore+1,'wake Stop must prevent the old second part');
  await expect(page.getByTestId('talk-wake')).toHaveAttribute('aria-pressed','false');
  partGap=1200;
  assert.ok(cancelCount>0);
  assert.deepEqual(unexpected,[],'requests outside the fixture routes');
  assert.deepEqual(errors,[]);
  console.log(`${lang}: five microphone turns, multipart, scene/language/reload, errors, early audio before HTTP, opt-in wake Stop during playback and mic cleanup passed (providers/recognizer mocked)`);
  await context.close();
 }
} finally {await browser.close();}
