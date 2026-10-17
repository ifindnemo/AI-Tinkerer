import assert from "node:assert/strict";
import test from "node:test";
import {POLL_HIDDEN_MS, POLL_HURRY_MS, POLL_IDLE_MS, POLL_LIVE_MS, clipPollDelay, hurryTrigger} from "../src/lib/agent/clip-poll";
import type {Presence} from "../src/lib/agent/presence";

const base = (): Presence => ({agent: null, camera: null, message: null, voice: {enabled: true, blocked: false, speaking: null}, bubble: null, report: null, reportUntil: 0, reportClosed: null, happyUntil: 0, seenId: null});
const message = (id: string, severity: "normal" | "warning" | "critical" = "warning") => ({id, text: id, severity});

test("the page waits longest when hidden, then asks fast while a turn or an alert is on the way", () => {
  const now = 100_000;
  assert.equal(clipPollDelay({hidden: true, live: true, hurryUntil: now + 5000, now}), POLL_HIDDEN_MS);
  assert.equal(clipPollDelay({hidden: false, live: true, hurryUntil: 0, now}), POLL_LIVE_MS);
  assert.equal(clipPollDelay({hidden: false, live: false, hurryUntil: now + 1, now}), POLL_HURRY_MS);
  assert.equal(clipPollDelay({hidden: false, live: false, hurryUntil: now, now}), POLL_IDLE_MS, "the hurry window is over at its end");
  assert.ok(POLL_HURRY_MS < POLL_IDLE_MS);
});

test("an alert about to be spoken starts the quick polling; a calm change does not", () => {
  const idle = base();
  assert.ok(hurryTrigger(idle, {...idle, agent: {phase: "analyzing", severity: "normal"}}), "the car agent started analysing");
  assert.ok(!hurryTrigger({...idle, agent: {phase: "analyzing", severity: "normal"}}, {...idle, agent: {phase: "analyzing", severity: "normal"}}), "still analysing is not new");
  assert.ok(hurryTrigger(idle, {...idle, camera: {active: true, sound: true, severity: "warning", responded: false}}), "the camera raised a warning");
  const warned = {...idle, agent: {phase: "ready" as const, severity: "warning" as const}};
  assert.ok(hurryTrigger(warned, {...warned, agent: {phase: "ready", severity: "critical"}}), "a higher level");
  assert.ok(!hurryTrigger(warned, {...warned, agent: {phase: "ready", severity: "warning"}}), "the same level again");
  assert.ok(!hurryTrigger({...idle, camera: {active: true, sound: true, severity: "critical", responded: false}}, {...idle, camera: {active: true, sound: true, severity: "normal", responded: true}}), "an alert clearing");
  assert.ok(hurryTrigger(idle, {...idle, message: message("a")}), "new words for the bubble");
  assert.ok(!hurryTrigger({...idle, message: message("a")}, {...idle, message: message("a")}), "the same words");
  assert.ok(!hurryTrigger(idle, {...idle, message: message("calm", "normal")}), "a normal message is not an alert");
});
