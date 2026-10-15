import test from "node:test";
import assert from "node:assert/strict";
import {agentLangStore, langStore, resolveAgentLang, trAgent, tr, voiceGain, voiceVolumeStore, VOICE_VOLUMES} from "../src/lib/preferences";
import {LocalGuardian, decide} from "../src/lib/guardian/policy";
import type {DriverAssessment, DriverEvent} from "../src/lib/driver/types";
import type {VehicleSnapshot} from "../src/lib/guardian/types";

const reset = () => {langStore.set("vi"); agentLangStore.set("auto"); voiceVolumeStore.set("100");};

test("the agent's language follows the interface until it is pinned", () => {
  reset();
  assert.equal(resolveAgentLang(), "vi");
  langStore.set("en");
  assert.equal(resolveAgentLang(), "en", "auto follows the interface");
  agentLangStore.set("vi");
  assert.equal(resolveAgentLang(), "vi", "a pinned language wins over an English interface");
  assert.equal(tr("xin chào", "hello"), "hello", "interface text still follows the interface");
  assert.equal(trAgent("xin chào", "hello"), "xin chào", "agent text follows the agent language");
  langStore.set("vi");
  agentLangStore.set("en");
  assert.equal(trAgent("xin chào", "hello"), "hello");
  assert.equal(tr("xin chào", "hello"), "xin chào");
  reset();
});

test("the voice volume has fixed steps and maps to a 0 to 1 gain", () => {
  reset();
  assert.deepEqual([...VOICE_VOLUMES], ["20", "40", "60", "80", "100"]);
  assert.equal(voiceGain(), 1);
  voiceVolumeStore.set("40");
  assert.equal(voiceGain(), 0.4);
  reset();
});

const event = (state: "drowsy" | "attentive", closedMs = 0): DriverEvent => ({
  capturedAt: "2026-10-15T09:00:00.000Z", facePresent: true, absentMs: 0, state, confidence: 0.9,
  eyes: {closed: state === "drowsy", closedMs, perclos: 0.1, score: 0.9},
  head: {direction: "forward", yawDeg: 0, pitchDeg: 0, awayMs: 0},
} as DriverEvent);
const assessment = (state: "drowsy" | "attentive"): DriverAssessment => ({
  severity: state === "drowsy" ? "critical" : "normal", state, summary: "x", evidence: [], recommendations: [], confidence: 0.9, engine: "rules", fallbackReason: "local", at: "2026-10-15T09:00:00.000Z",
} as DriverAssessment);
const vehicle = (coolantC: number): VehicleSnapshot => ({source: "simulated", capturedAt: "2026-10-15T09:00:00.000Z", speedKmh: 65, coolantC} as VehicleSnapshot);

test("the on-device Guardian text is written in the agent's language and the decision does not change", () => {
  reset();
  const run = () => new LocalGuardian().update(event("drowsy", 2600), assessment("drowsy"), vehicle(122), null);
  const vi = run();
  agentLangStore.set("en");
  const en = run();
  assert.deepEqual(en.decision, vi.decision);
  assert.equal(en.decision.action, "stop_engine");
  assert.match(en.assessment.recommendations[0], /switch off the engine/i);
  assert.match(vi.assessment.recommendations[0], /tắt động cơ/);
  assert.equal(en.assessment.severity, vi.assessment.severity);
  assert.equal(decide({speedKmh: 65, coolantC: 122, warnC: 105, driverState: "attentive", driverSeverity: "normal", responded: false, unanswered: false}).mustStop, true);
  reset();
});
