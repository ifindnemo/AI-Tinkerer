import assert from "node:assert/strict";
import test from "node:test";
import {AttentionTracker} from "../src/lib/driver/attention";
import {toSample} from "../src/lib/driver/camera";
import {isDriverReply, postDriverEvents} from "../src/lib/driver/client";
import {simulatedSample, type SimulationScenario} from "../src/lib/driver/simulation";
import {DRIVER_STORAGE_KEY, HISTORY_LIMIT, decodeDriverStore, defaultDriverStore} from "../src/lib/driver/storage";
import type {DriverBatch, DriverEvent} from "../src/lib/driver/types";

const T0 = Date.UTC(2026, 9, 11, 2, 0, 0);

function simulate(scenario: SimulationScenario, seconds: number) {
  const tracker = new AttentionTracker();
  const events: DriverEvent[] = [];
  for (let ms = 0; ms <= seconds * 1000; ms += 100) events.push(tracker.update(simulatedSample(scenario, ms, T0 + ms).frame));
  return events;
}

test("simulated attentive driver stays attentive", () => {
  const states = new Set(simulate("attentive", 40).map(event => event.state));
  assert.deepEqual([...states], ["attentive"]);
});

test("simulated drowsy driver produces a microsleep longer than 2.5 s", () => {
  const events = simulate("drowsy", 12);
  assert.ok(events.some(event => event.state === "drowsy"));
  assert.ok(Math.max(...events.map(event => event.eyes.closedMs)) >= 2500);
});

test("simulated distraction looks away for more than 4 s, then comes back", () => {
  const events = simulate("distracted", 10);
  assert.ok(Math.max(...events.map(event => event.head.awayMs)) >= 4000);
  assert.ok(events.some(event => event.state === "distracted" && event.head.direction === "left"));
  assert.equal(events.at(-1)!.state, "attentive");
});

test("simulated empty seat becomes no_face", () => {
  assert.equal(simulate("no_face", 3).at(-1)!.state, "no_face");
});

test("toSample converts a model result and reports a missing face", () => {
  const empty = toSample({faceLandmarks: []}, 640, 480, T0);
  assert.equal(empty.frame.facePresent, false);
  assert.equal(empty.box, null);
  const landmarks = Array.from({length: 478}, () => ({x: 0.5, y: 0.45, z: 0}));
  landmarks[234] = {x: 0.36, y: 0.45, z: 0};
  landmarks[454] = {x: 0.64, y: 0.45, z: 0};
  landmarks[10] = {x: 0.5, y: 0.2, z: 0};
  landmarks[152] = {x: 0.5, y: 0.7, z: 0};
  const blendshapes = [{categories: [{categoryName: "eyeBlinkLeft", score: 0.08}, {categoryName: "eyeBlinkRight", score: 0.1}]}];
  const sample = toSample({faceLandmarks: [landmarks], faceBlendshapes: blendshapes}, 640, 480, T0);
  assert.equal(sample.frame.facePresent, true);
  assert.equal(sample.frame.closure, 0.09);
  assert.equal(sample.frame.yaw, 0);
  assert.equal(sample.frame.confidence, 1);
  assert.deepEqual(sample.box, {x: 0.36, y: 0.2, w: 0.28, h: 0.5});
  const noEyes = toSample({faceLandmarks: [landmarks]}, 640, 480, T0);
  assert.equal(noEyes.frame.facePresent, false);
});

test("stored state is decoded defensively", () => {
  assert.deepEqual(decodeDriverStore(null), defaultDriverStore());
  assert.deepEqual(decodeDriverStore("{oops"), defaultDriverStore());
  assert.deepEqual(decodeDriverStore(JSON.stringify({version: 2})), defaultDriverStore());
  const history = Array.from({length: HISTORY_LIMIT + 20}, (_, i) => [T0 + i * 1000, i % 2 ? "drowsy" : "attentive"]);
  const decoded = decodeDriverStore(JSON.stringify({
    version: 1, consent: true, settings: {sound: false, showVideo: "yes"},
    history: [...history, [T0, "sleeping"], ["x", "attentive"]],
  }));
  assert.equal(decoded.consent, true);
  assert.deepEqual(decoded.settings, {sound: false, showVideo: true, ecu: "warm"});
  assert.equal(decoded.history.length, HISTORY_LIMIT);
  assert.equal(DRIVER_STORAGE_KEY, "car-neuron.driver.v1");
});

const reply = {
  accepted: 1, sessionId: "session-abcdef01", state: "drowsy",
  assessment: {severity: "warning", summary: "s", evidence: ["e"], recommendations: ["r"], confidence: 0.9, engine: "rules", fallbackReason: "error", state: "drowsy", at: "2026-10-11T02:00:00Z"},
  privacy: {rawVideoReceived: false},
};

test("client posts JSON only and validates the reply", async () => {
  const batch: DriverBatch = {schemaVersion: 1, sessionId: "session-abcdef01", source: "simulated", context: {vehicleMoving: true}, events: simulate("drowsy", 1).slice(-1)};
  let sent: RequestInit | undefined;
  const ok = (async (url: string, init?: RequestInit) => {
    assert.equal(url, "/api/driver/events");
    sent = init;
    return new Response(JSON.stringify(reply), {status: 200});
  }) as typeof fetch;
  assert.equal((await postDriverEvents(batch, undefined, ok)).assessment.severity, "warning");
  assert.equal(sent?.headers && (sent.headers as Record<string, string>)["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(String(sent?.body)), batch);
  const failing = (async () => new Response(JSON.stringify({error: "Backend chưa xử lý được yêu cầu."}), {status: 502})) as typeof fetch;
  await assert.rejects(postDriverEvents(batch, undefined, failing), /Backend chưa xử lý/);
  const odd = (async () => new Response(JSON.stringify({...reply, privacy: {rawVideoReceived: true}}), {status: 200})) as typeof fetch;
  await assert.rejects(postDriverEvents(batch, undefined, odd), /invalid reply/);
  for (const invalid of [{...reply, sessionId: "another-session"}, {...reply, accepted: 0}]) {
    const unrelated = (async () => new Response(JSON.stringify(invalid))) as typeof fetch;
    await assert.rejects(postDriverEvents(batch, undefined, unrelated), /invalid reply/);
  }
  assert.equal(isDriverReply(reply), true);
});
