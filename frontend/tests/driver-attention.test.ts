import assert from "node:assert/strict";
import test from "node:test";
import {AttentionTracker} from "../src/lib/driver/attention";
import {Calibrator} from "../src/lib/driver/calibration";
import {eyeReading, faceConfidence, headPose, type Landmark} from "../src/lib/driver/features";
import type {DriverEvent, DriverFrame} from "../src/lib/driver/types";

const T0 = Date.UTC(2026, 9, 11, 2, 0, 0);
const frame = (ms: number, over: Partial<DriverFrame> = {}): DriverFrame => ({
  t: T0 + ms, facePresent: true, closure: 0.1, yaw: 0, pitch: 0, confidence: 0.9, ...over,
});
/** Feeds frames every `step` ms from `from` to `to`; `at` returns the overrides for that moment. */
function run(tracker: AttentionTracker, from: number, to: number, at: (ms: number) => Partial<DriverFrame> = () => ({}), step = 66): DriverEvent {
  let event!: DriverEvent;
  for (let ms = from; ms <= to; ms += step) event = tracker.update(frame(ms, at(ms)));
  return event;
}

test("a normal blink is not drowsiness", () => {
  const tracker = new AttentionTracker();
  const event = run(tracker, 0, 3000, ms => ({closure: ms >= 1000 && ms < 1250 ? 0.9 : 0.1}));
  assert.equal(event.state, "attentive");
  const peak = run(new AttentionTracker(), 0, 1200, ms => ({closure: ms >= 1000 ? 0.9 : 0.1}));
  assert.ok(peak.eyes.closedMs > 0 && peak.eyes.closedMs < 400);
});

test("eyes closed for 1.5 s is drowsy, and it clears 150 ms after they reopen", () => {
  const tracker = new AttentionTracker();
  assert.equal(run(tracker, 0, 1000).state, "attentive");
  const closing = run(tracker, 1066, 2700, () => ({closure: 0.9}));
  assert.equal(closing.state, "drowsy");
  assert.ok(closing.eyes.closed && closing.eyes.closedMs >= 1500);
  assert.equal(run(tracker, 2766, 2800).state, "drowsy"); // reopened for < 150 ms: still the same closure
  assert.equal(run(tracker, 2866, 3200).state, "attentive");
});

test("a short flicker of reopened eyes does not restart the closure timer", () => {
  const tracker = new AttentionTracker();
  const event = run(tracker, 0, 1800, ms => ({closure: ms >= 400 && ms < 800 ? 0.9 : ms >= 800 && ms < 900 ? 0.1 : 0.9}));
  assert.ok(event.eyes.closedMs >= 1300, `closedMs=${event.eyes.closedMs}`);
});

test("PERCLOS above 0.2 over 30 s is drowsy even without one long closure", () => {
  const tracker = new AttentionTracker();
  // Closed 0.7 s out of every 3 s ≈ 23 %: never a microsleep, but too much overall.
  const event = run(tracker, 0, 30_000, ms => ({closure: ms % 3000 < 700 ? 0.9 : 0.1}));
  assert.ok(event.eyes.perclos !== null && event.eyes.perclos >= 0.2, `perclos=${event.eyes.perclos}`);
  assert.equal(event.state, "drowsy");
  const rested = run(new AttentionTracker(), 0, 30_000, ms => ({closure: ms % 4000 < 200 ? 0.9 : 0.1}));
  assert.ok(rested.eyes.perclos! < 0.1);
  assert.equal(rested.state, "attentive");
});

test("PERCLOS stays unknown until 15 s have been observed", () => {
  assert.equal(run(new AttentionTracker(), 0, 10_000).eyes.perclos, null);
});

test("looking away for 2 s is distraction; a mirror check of 1 s is not", () => {
  const away = run(new AttentionTracker(), 0, 2600, ms => ({yaw: ms >= 400 ? 40 : 0}));
  assert.equal(away.state, "distracted");
  assert.equal(away.head.direction, "left");
  assert.ok(away.head.awayMs >= 2000);
  const glance = new AttentionTracker();
  const peak = run(glance, 0, 1400, ms => ({yaw: ms >= 400 ? -40 : 0}));
  assert.equal(peak.state, "attentive");
  assert.equal(peak.head.direction, "right");
  assert.equal(run(glance, 1466, 2500).state, "attentive");
});

test("looking down is detected from pitch and clears with hysteresis", () => {
  const tracker = new AttentionTracker();
  assert.equal(run(tracker, 0, 2500, () => ({pitch: 30})).head.direction, "down");
  assert.equal(run(tracker, 2566, 2700, () => ({pitch: 17})).head.direction, "down"); // still above the 14° release
  assert.equal(run(tracker, 2766, 3000, () => ({pitch: 5})).head.direction, "forward");
});

test("no face: uncertain at first, no_face after 2 s, and it recovers", () => {
  const tracker = new AttentionTracker();
  run(tracker, 0, 1000);
  assert.equal(run(tracker, 1066, 1600, () => ({facePresent: false})).state, "uncertain");
  const lost = run(tracker, 1666, 3400, () => ({facePresent: false}));
  assert.equal(lost.state, "no_face");
  assert.equal(lost.facePresent, false);
  assert.ok(lost.absentMs >= 2000 && lost.head.direction === null);
  assert.equal(run(tracker, 3466, 3700).state, "attentive");
});

test("low confidence never produces a drowsy or distracted claim", () => {
  const event = run(new AttentionTracker(), 0, 3000, () => ({closure: 0.9, yaw: 40, confidence: 0.3}));
  assert.equal(event.state, "uncertain");
  assert.equal(event.confidence, 0.3);
  assert.equal(event.eyes.closedMs, 0);
  assert.equal(event.head.awayMs, 0);
  assert.equal(event.eyes.perclos, null);
});

test("a suspended camera does not count unobserved time as closure or looking away", () => {
  const tracker = new AttentionTracker();
  run(tracker, 0, 1000, () => ({closure: 0.9, yaw: 40}));
  const resumed = tracker.update(frame(10_000, {closure: 0.9, yaw: 40}));
  assert.equal(resumed.state, "attentive");
  assert.equal(resumed.eyes.closedMs, 0);
  assert.equal(resumed.head.awayMs, 0);
  assert.equal(resumed.eyes.perclos, null);
});

test("unreliable frames cannot contaminate the next reliable observation", () => {
  const tracker = new AttentionTracker();
  run(tracker, 0, 20_000, () => ({closure: 0.9, yaw: 40, confidence: 0.2}));
  const recovered = run(tracker, 20_066, 21_000, () => ({closure: 0.9, yaw: 40}));
  assert.equal(recovered.state, "attentive");
  assert.ok(recovered.eyes.closedMs < 1000);
  assert.ok(recovered.head.awayMs < 1000);
  assert.equal(recovered.eyes.perclos, null);
});

test("calibration moves the straight-ahead pose and the closed threshold", () => {
  const tracker = new AttentionTracker();
  tracker.setBaseline({yaw: 20, pitch: -10, eyesOn: 0.7});
  // Camera mounted off to the side: the driver looks "20° left" of the lens when attentive.
  const ahead = run(tracker, 0, 3000, () => ({yaw: 20, pitch: -10, closure: 0.6}));
  assert.equal(ahead.state, "attentive");
  assert.equal(ahead.head.direction, "forward");
  assert.equal(ahead.eyes.closed, false); // 0.6 is below this face's threshold of 0.7
  assert.equal(run(new AttentionTracker(), 0, 3000, () => ({yaw: 20})).head.direction, "forward"); // 20° < 25° anyway
});

test("events are structured values only, with the documented fields", () => {
  const event = run(new AttentionTracker(), 0, 500);
  assert.deepEqual(Object.keys(event).sort(), ["absentMs", "capturedAt", "confidence", "eyes", "facePresent", "head", "state"]);
  assert.deepEqual(Object.keys(event.eyes).sort(), ["closed", "closedMs", "perclos", "score"]);
  assert.deepEqual(Object.keys(event.head).sort(), ["awayMs", "direction", "pitchDeg", "yawDeg"]);
  assert.match(event.capturedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
});

test("calibrator takes the median of an attentive stretch and fails without a face", () => {
  const calibrator = new Calibrator(2000, 10);
  let status = calibrator.add(frame(0, {yaw: 8, pitch: 4, closure: 0.15}));
  for (let ms = 66; ms <= 2100; ms += 66) status = calibrator.add(frame(ms, {yaw: 8, pitch: 4, closure: 0.15}));
  assert.equal(status.state, "done");
  assert.equal(status.baseline?.yaw, 8);
  assert.equal(status.baseline?.pitch, 4);
  assert.ok(Math.abs(status.baseline!.eyesOn! - 0.5) < 1e-9);
  const empty = new Calibrator(1000, 10);
  let last = empty.add(frame(0, {facePresent: false}));
  for (let ms = 100; ms <= 3200; ms += 100) last = empty.add(frame(ms, {facePresent: false}));
  assert.equal(last.state, "failed");
});

// ---- geometry ----------------------------------------------------------------------------------
function face(over: {yawDeg?: number; pitchDownDeg?: number} = {}): Landmark[] {
  // A rigid face seen from the camera: cheeks 0.3 apart, forehead→chin 0.4 (in x-scale units).
  const yaw = ((over.yawDeg ?? 0) * Math.PI) / 180;
  const pitch = ((over.pitchDownDeg ?? 0) * Math.PI) / 180;
  const lm: Landmark[] = Array.from({length: 478}, () => ({x: 0.5, y: 0.5, z: 0}));
  const half = 0.15;
  lm[234] = {x: 0.5 - half * Math.cos(yaw), y: 0.5, z: -half * Math.sin(yaw)};
  lm[454] = {x: 0.5 + half * Math.cos(yaw), y: 0.5, z: half * Math.sin(yaw)};
  const hh = 0.2;
  lm[10] = {x: 0.5, y: 0.5 - hh * Math.cos(pitch), z: -hh * Math.sin(pitch)};
  lm[152] = {x: 0.5, y: 0.5 + hh * Math.cos(pitch), z: hh * Math.sin(pitch)};
  return lm;
}

test("head pose: frontal is near zero, signs follow the documented convention", () => {
  const frontal = headPose(face(), 1)!;
  assert.ok(Math.abs(frontal.yaw) < 0.5 && Math.abs(frontal.pitch) < 0.5);
  assert.ok(Math.abs(headPose(face({yawDeg: 30}), 1)!.yaw - 30) < 0.5);
  assert.ok(Math.abs(headPose(face({yawDeg: -30}), 1)!.yaw + 30) < 0.5);
  assert.ok(Math.abs(headPose(face({pitchDownDeg: 25}), 1)!.pitch - 25) < 0.5);
  assert.ok(Math.abs(headPose(face({pitchDownDeg: -25}), 1)!.pitch + 25) < 0.5);
  // A 4:3 frame: y is normalised by the height, so the same face needs the aspect correction.
  const wide = face({pitchDownDeg: 25}).map(point => ({...point, y: 0.5 + (point.y - 0.5) * (4 / 3)}));
  assert.ok(Math.abs(headPose(wide, 4 / 3)!.pitch - 25) < 0.5);
});

test("head pose rejects incomplete or degenerate landmarks", () => {
  assert.equal(headPose([], 1), null);
  assert.equal(headPose(Array.from({length: 478}, () => ({x: 0.5, y: 0.5, z: 0})), 1), null);
  assert.equal(headPose(face(), 0), null);
});

test("eye reading averages both eyes and reports disagreement", () => {
  const reading = eyeReading([{categoryName: "eyeBlinkLeft", score: 0.9}, {categoryName: "eyeBlinkRight", score: 0.7}, {categoryName: "jawOpen", score: 0.1}]);
  assert.deepEqual(reading, {score: 0.8, asymmetry: 0.2});
  assert.equal(eyeReading([{categoryName: "eyeBlinkLeft", score: 0.9}]), null);
  assert.equal(eyeReading(undefined), null);
});

test("confidence drops for a small face, a wink, or an extreme head turn", () => {
  const good = faceConfidence({faceWidth: 0.3, asymmetry: 0.05, yaw: 5});
  assert.equal(good, 1);
  assert.ok(faceConfidence({faceWidth: 0.12, asymmetry: 0.05, yaw: 5}) < 0.3);
  assert.ok(faceConfidence({faceWidth: 0.3, asymmetry: 0.6, yaw: 5}) < 0.5);
  assert.equal(faceConfidence({faceWidth: 0.3, asymmetry: 0.05, yaw: 75}), 0);
  assert.equal(faceConfidence({faceWidth: 0.3, asymmetry: null, yaw: null}), 0.6);
});
