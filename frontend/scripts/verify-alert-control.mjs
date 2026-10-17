// Offline checks for quiet, typed talk, microphone VAD and spoken replies.
// Providers are mocked. No Blaze or model call is made.
// BASE_URL=http://127.0.0.1:3199 node scripts/verify-alert-control.mjs
import assert from "node:assert/strict";
import {mkdir} from "node:fs/promises";
import {chromium, expect} from "@playwright/test";

const base = process.env.BASE_URL || "http://127.0.0.1:3199";
const output = process.env.SCREENSHOT_DIR || "/tmp/car-neuron-alert-control";
await mkdir(output, {recursive: true});

function wav(seconds = 0.15) {
  const rate = 8000;
  const count = Math.floor(rate * seconds);
  const body = Buffer.alloc(44 + count * 2);
  body.write("RIFF", 0);
  body.writeUInt32LE(36 + count * 2, 4);
  body.write("WAVE", 8);
  body.write("fmt ", 12);
  body.writeUInt32LE(16, 16);
  body.writeUInt16LE(1, 20);
  body.writeUInt16LE(1, 22);
  body.writeUInt32LE(rate, 24);
  body.writeUInt32LE(rate * 2, 28);
  body.writeUInt16LE(2, 32);
  body.writeUInt16LE(16, 34);
  body.write("data", 36);
  body.writeUInt32LE(count * 2, 40);
  for (let index = 0; index < count; index += 1) body.writeInt16LE(Math.round(Math.sin(index / 8) * 8000), 44 + index * 2);
  return body;
}
const clipAudio = wav();

function field(body, name) {
  const match = String(body ?? "").match(new RegExp(`name="${name}"[^\\r\\n]*\\r?\\n\\r?\\n([^\\r\\n]*)`));
  return match ? match[1] : "";
}

const browser = await chromium.launch({args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"]});
const errors = [];

async function install(context) {
  await context.addInitScript(() => {
    window.__tone = 0;
    window.__audioStarts = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      window.__audioStarts += 1;
      return start.apply(this, args);
    };
    const readMeter = AnalyserNode.prototype.getFloatTimeDomainData;
    AnalyserNode.prototype.getFloatTimeDomainData = function (bins) {
      readMeter.call(this, bins);
      const level = window.__tone || 0;
      if (level <= 0) return;
      for (let index = 0; index < bins.length; index += 1) bins[index] = Math.sin(index / 3) * level;
    };
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext();
      await context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      gain.gain.value = window.__tone;
      window.__micGain = gain;
      const destination = context.createMediaStreamDestination();
      oscillator.frequency.value = 220;
      oscillator.connect(gain).connect(destination);
      oscillator.start();
      window.__mic = window.__mic || {opened: 0, stopped: 0};
      window.__mic.opened += 1;
      for (const track of destination.stream.getTracks()) {
        const stop = track.stop.bind(track);
        let stopped = false;
        track.stop = () => {
          if (stopped) return;
          stopped = true;
          window.__mic.stopped += 1;
          stop();
          oscillator.stop();
          void context.close();
        };
      }
      return destination.stream;
    };
  });
  context.__bag.unexpected = [];
  await context.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    context.__bag.unexpected.push(path);
    return route.fulfill({json: {}});
  });
  // A simulated scenario posts structured attention events (no images). The fixture accepts them.
  await context.route("**/api/driver/events", route => route.fulfill({json: {}}));
  await context.route("**/api/voice/**", route => {
    const request = route.request();
    const url = new URL(request.url());
    const bag = context.__bag;
    bag.requests.push({method: request.method(), path: url.pathname, body: request.postData() ?? ""});
    if (url.pathname.endsWith("/talk/cancel")) return route.fulfill({json: {ok: true}});
    if (url.pathname.endsWith("/transcribe")) {
      const text = bag.emptyStt ? "" : `Question ${bag.transcribe += 1} ${bag.lang}`;
      return route.fulfill({json: {text}});
    }
    if (url.pathname.endsWith("/talk")) {
      const heard = field(request.postData(), "text");
      const conversation = field(request.postData(), "conversationId");
      const turn = field(request.postData(), "turnId");
      const group = `talk:${conversation}:${turn}`;
      bag.conversations.add(conversation);
      bag.talks.push({heard, conversation, turn, lang: field(request.postData(), "lang")});
      const now = new Date().toISOString();
      const first = bag.scene?.first ?? `${heard}. The coolant is above the warning line.`;
      const second = bag.scene?.second ?? "Ease off and watch the temperature before deciding on a garage.";
      const seq = bag.clips.length;
      bag.clips.push(
        {id: `clip_${seq + 1}`, seq: seq + 1, severity: "normal", text: first, created_at: now, group, part_index: 0, part_count: 2},
        {id: `clip_${seq + 2}`, seq: seq + 2, severity: "normal", text: second, created_at: now, group, part_index: 1, part_count: 2},
      );
      return route.fulfill({json: {text: heard, reply: `${first} ${second}`, spoken: true, audioQueued: true, stale: false}});
    }
    if (url.pathname.endsWith("/clips")) {
      const after = Number(url.searchParams.get("after") ?? 0);
      return route.fulfill({json: {enabled: true, lang: bag.lang, latest: bag.clips.at(-1)?.seq ?? 0, clips: bag.clips.filter(clip => clip.seq > after)}});
    }
    if (url.pathname.includes("/audio")) return route.fulfill({status: 200, contentType: "audio/wav", body: clipAudio});
    return route.fulfill({status: 404, json: {error: "not used"}});
  });
  context.on("page", page => {
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (/same key|unique.*key|Encountered two children/i.test(message.text())) errors.push(message.text());
    });
  });
}

// A click before React has attached its handlers is lost, and a dev server hydrates late. Wait for the handler.
async function hydrated(page) {
  await page.getByTestId("agent-robot").waitFor();
  await page.waitForFunction(() => {
    const node = document.querySelector('[data-testid="agent-robot"]');
    return !!node && Object.keys(node).some(key => key.startsWith("__reactProps"));
  });
}

async function typedQuiet(context) {
  const page = await context.newPage();
  await page.goto(`${base}/driver`, {waitUntil: "domcontentloaded"});
  await hydrated(page);
  await expect(page.getByTestId("alert-quiet")).toBeVisible();
  await page.screenshot({path: `${output}/01-quiet-ready.png`, animations: "disabled"});
  await page.getByTestId("alert-quiet").click();
  await expect(page.getByTestId("alert-quiet-remaining")).toBeVisible();
  await page.getByTestId("agent-robot").click();
  await page.getByTestId("talk-text").fill("Why are you warning me?");
  await page.getByTestId("talk-send").click();
  await expect(page.getByTestId("talk-log")).toContainText("coolant", {timeout: 15_000});
  await page.screenshot({path: `${output}/03-answer.png`, animations: "disabled"});
  await page.getByTestId("talk-end").click();
  await expect(page.getByTestId("talk-mic")).toHaveCount(0);
  await page.getByTestId("alert-quiet-resume").click();
  await expect(page.getByTestId("alert-quiet")).toBeVisible();
  await page.close();
}

async function speakOnce(page) {
  await page.evaluate(() => {
    window.__tone = 0.35;
    if (window.__micGain) window.__micGain.gain.value = 0.35;
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    window.__tone = 0;
    if (window.__micGain) window.__micGain.gain.value = 0;
  });
}

async function micConversation(context, lang) {
  context.__bag.lang = lang;
  context.__bag.transcribe = context.__bag.talks.length;
  const page = await context.newPage();
  await page.addInitScript(value => localStorage.setItem("car-neuron.agent-lang", value), lang);
  await page.goto(`${base}/driver`, {waitUntil: "domcontentloaded"});
  await hydrated(page);
  const before = context.__bag.talks.length;
  await page.getByTestId("agent-robot").click();
  await page.getByTestId("agent-talk").click();
  for (let turn = 0; turn < 5; turn += 1) {
    await expect(page.getByTestId("talk-mic")).toBeVisible({timeout: 20_000});
    await speakOnce(page);
    await page.waitForTimeout(1500);
    if (turn === 0 && context.__bag.talks.length === before) {
      const probe = await page.evaluate(() => ({
        tone: window.__tone,
        starts: window.__audioStarts,
        contexts: window.__contexts ?? [],
      }));
      console.log("no talk yet", JSON.stringify({probe, paths: context.__bag.requests.map(item => item.path)}));
    }
    await expect.poll(() => context.__bag.talks.length, {timeout: 20_000}).toBe(before + turn + 1);
    await expect.poll(() => page.evaluate(() => window.__audioStarts), {timeout: 20_000}).toBeGreaterThanOrEqual((turn + 1) * 2);
  }
  const mine = context.__bag.talks.slice(before);
  assert.equal(new Set(mine.map(item => item.conversation)).size, 1);
  assert.equal(new Set(mine.map(item => item.turn)).size, 5);
  assert.ok(mine.every(item => item.lang === lang));
  await page.getByTestId("talk-end-live").click();
  await expect(page.getByTestId("talk-mic")).toHaveCount(0, {timeout: 10_000});
  const mic = await page.evaluate(() => window.__mic);
  assert.ok(mic.opened >= 6, `the microphone opened for each listening window (${mic.opened})`);
  assert.equal(mic.opened, mic.stopped, "every microphone track is stopped after End");
  await page.screenshot({path: `${output}/mic-${lang}.png`, animations: "disabled"});
  await page.close();
  return {mic};
}

// The three demo scenes (docs/demo-runbook.md): the same fault with an alert driver, the same fault with a drowsy driver in a moving car, and a normal car.
const SCENES = [
  {name: "D1 fault + attentive", ecu: "warm", driver: "attentive", ask: "Why are you warning me?", first: "The coolant is above the warning line.", second: "Ease off and watch the temperature."},
  {name: "D2 fault + drowsy", ecu: "warm", driver: "drowsy", ask: "Can I keep driving to the garage?", first: "Stop at the nearest safe place and rest.", second: "Do not keep driving to the garage."},
  {name: "D3 normal + attentive", ecu: "normal", driver: "attentive", ask: "How is the car now?", first: "The car is normal right now.", second: "The coolant is 90 C and steady."},
];

async function scenes(context) {
  context.__bag.lang = "en";
  const page = await context.newPage();
  await page.goto(`${base}/driver`, {waitUntil: "domcontentloaded"});
  await hydrated(page);
  const conversations = [];
  for (const scene of SCENES) {
    context.__bag.scene = scene; // UI fixtures only; backend rules/guard are exercised in test_talk_scene_context.py.
    await page.getByTestId(`ecu-${scene.ecu}`).click();
    await page.getByTestId(`sim-${scene.driver}`).click();
    if (!(await page.getByTestId("agent-panel").isVisible())) await page.getByTestId("agent-robot").click(); // a click outside the dock closes its panel
    // Old turns remain readable behind a visible boundary; request IDs still retire the context.
    if (conversations.length) await expect(page.getByTestId("talk-status")).toContainText(/Đã kết thúc hội thoại|Conversation ended|Đã đổi tình huống|scenario changed/);
    if (conversations.length) {
      await expect(page.getByTestId("talk-divider").last()).toBeVisible();
      await expect(page.getByTestId("talk-log").locator('[data-archived="true"]')).not.toHaveCount(0);
      await expect(page.getByTestId("talk-log")).toContainText(SCENES[conversations.length - 1].ask);
    } else await expect(page.getByTestId("talk-log")).toHaveCount(0);
    const before = context.__bag.talks.length;
    const starts = await page.evaluate(() => window.__audioStarts);
    await page.getByTestId("talk-text").fill(scene.ask);
    await page.getByTestId("talk-send").click();
    await expect.poll(() => context.__bag.talks.length, {timeout: 15_000}).toBe(before + 1);
    const talk = context.__bag.talks.at(-1);
    assert.equal(talk.heard, scene.ask, `${scene.name}: the question reaches the mocked talk endpoint unchanged`);
    conversations.push(talk.conversation);
    await expect(page.getByTestId("talk-log")).toContainText(scene.first, {timeout: 15_000});
    await expect(page.getByTestId("talk-log")).toContainText(scene.second);
    await expect.poll(() => page.evaluate(() => window.__audioStarts), {timeout: 15_000}).toBeGreaterThanOrEqual(starts + 2);
    await page.screenshot({path: `${output}/scene-${scene.name.slice(0, 2)}.png`, animations: "disabled"});
  }
  assert.equal(new Set(conversations).size, SCENES.length, "each scene sends a new conversation ID; backend history isolation has a separate integration test");
  context.__bag.scene = null;
  await page.close();
}

const rectsOverlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// The robot's Quiet and Ask controls on laptop and projector sizes: reachable, 28 px or larger, inside the window and off the camera card's buttons.
async function garageControls(context) {
  for (const size of [{width: 1366, height: 768}, {width: 1280, height: 720}, {width: 1536, height: 864}]) {
    for (const route of ["/garage?presenter=1", "/driver"]) {
      const page = await context.newPage();
      await page.setViewportSize(size);
      await page.goto(`${base}${route}`, {waitUntil: "domcontentloaded"});
      await hydrated(page);
      await page.waitForTimeout(1500); // the robot settles into its corner
      const label = `${route} ${size.width}x${size.height}`;
      const quiet = await page.getByTestId("alert-quiet").boundingBox();
      const ask = await page.getByTestId("agent-talk").boundingBox();
      for (const [name, box] of [["Quiet", quiet], ["Ask", ask]]) {
        assert.ok(box, `${label}: ${name} is on the page`);
        assert.ok(box.width >= 28 && box.height >= 28, `${label}: ${name} is at least 28 px (${box.width}x${box.height})`);
        assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width && box.y + box.height <= size.height, `${label}: ${name} is inside the window`);
      }
      for (const id of ["garage-camera-start", "garage-camera-test-horn", "garage-camera-sound-toggle", "garage-camera-sim-drowsy", "garage-camera-sim-attentive"]) {
        const target = page.getByTestId(id);
        if (!(await target.count())) continue;
        const box = await target.first().boundingBox();
        if (!box) continue;
        assert.equal(rectsOverlap(quiet, box), false, `${label}: Quiet covers ${id}`);
        assert.equal(rectsOverlap(ask, box), false, `${label}: Ask covers ${id}`);
      }
      const pause = page.getByTestId("demo-pause");
      if (await pause.count()) {
        const box = await pause.boundingBox();
        assert.equal(rectsOverlap(quiet, box), false, `${label}: Pause covers Quiet`);
        assert.equal(rectsOverlap(ask, box), false, `${label}: Pause covers Ask`);
      }
      await page.screenshot({path: `${output}/corner-${route.slice(1, 7)}-${size.width}.png`, animations: "disabled"});
      await page.close();
    }
  }
}

try {
  const context = await browser.newContext({viewport: {width: 1366, height: 768}});
  context.__bag = {requests: [], talks: [], clips: [], conversations: new Set(), transcribe: 0, emptyStt: false, lang: "vi"};
  await install(context);
  await typedQuiet(context);
  await micConversation(context, "vi");
  await micConversation(context, "en");
  await scenes(context);
  await garageControls(context);
  assert.ok(context.__bag.conversations.size >= 3, "typed and each language keep their own conversation");
  const other = await browser.newContext({viewport: {width: 1366, height: 768}});
  other.__bag = {requests: [], talks: [], clips: [], conversations: new Set(), transcribe: 0, emptyStt: false, lang: "vi"};
  await install(other);
  const page = await other.newPage();
  await page.goto(`${base}/driver`, {waitUntil: "domcontentloaded"});
  await hydrated(page);
  await expect(page.getByTestId("agent-talk")).toBeVisible();
  await page.getByTestId("agent-talk").click();
  await expect(page.getByTestId("talk-mic")).toBeVisible({timeout: 20_000});
  await speakOnce(page);
  await expect.poll(() => other.__bag.talks.length, {timeout: 20_000}).toBe(1);
  assert.equal([...context.__bag.conversations].includes(other.__bag.talks[0].conversation), false);
  await page.close();
  assert.deepEqual(errors, []);
  // Garage pages talk to routes this fixture does not provide, so only the /driver contexts are held to the fixture list.
  assert.deepEqual([...new Set(other.__bag.unexpected)], [], "requests outside the fixture routes");
  console.log(`alert-control ok ${output} vi-turns=5 en-turns=5 scenes=${SCENES.length} corner-checks=6 mic-tracks-stopped`);
} finally {
  await browser.close();
}
