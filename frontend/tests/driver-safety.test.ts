import assert from "node:assert/strict";
import test from "node:test";
import {DriverSafety} from "../src/lib/driver/safety";
import type {DriverEvent} from "../src/lib/driver/types";

function event(second: number, over: Partial<DriverEvent> = {}): DriverEvent {
  return {
    capturedAt: new Date(Date.UTC(2026, 9, 11) + second * 1000).toISOString(),
    facePresent: true, absentMs: 0, confidence: 0.9, state: "attentive",
    eyes: {closed: false, closedMs: 0, perclos: null, score: 0.1},
    head: {direction: "forward", yawDeg: 0, pitchDeg: 0, awayMs: 0}, ...over,
  };
}

test("local rules escalate immediately and hold a prolonged closure for 60 seconds", () => {
  const safety = new DriverSafety();
  assert.equal(safety.update(event(0), true).severity, "normal");
  assert.equal(safety.update(event(1, {state: "drowsy", eyes: {closed: true, closedMs: 1600, perclos: null, score: 0.9}}), true).severity, "warning");
  const critical = safety.update(event(2, {state: "drowsy", eyes: {closed: true, closedMs: 2600, perclos: null, score: 0.9}}), true);
  assert.equal(critical.severity, "critical");
  assert.equal(critical.fallbackReason, "local");
  assert.ok(critical.recommendations.length > 0);
  assert.equal(safety.update(event(62), true).severity, "critical");
  assert.equal(safety.update(event(63), true).severity, "normal");
});

test("local warning lasts 20 seconds after the last reliable drowsy reading", () => {
  const safety = new DriverSafety();
  safety.update(event(0, {state: "drowsy"}), true);
  assert.equal(safety.update(event(20), true).severity, "warning");
  assert.equal(safety.update(event(21), true).severity, "normal");
});

test("unreliable observations never turn invalid closure timers into drowsiness", () => {
  for (const over of [{confidence: 0.2}, {facePresent: false}, {state: "uncertain" as const}]) {
    const result = new DriverSafety().update(event(0, {...over, eyes: {closed: true, closedMs: 8000, perclos: 0.9, score: 0.9}}), true);
    assert.equal(result.severity, "normal");
  }
});

test("distraction and a missing face only alert while moving", () => {
  const safety = new DriverSafety();
  const away = event(0, {state: "distracted", head: {direction: "left", yawDeg: 40, pitchDeg: 0, awayMs: 4500}});
  assert.equal(safety.update(away, true).severity, "critical");
  assert.equal(safety.update(away, false).severity, "normal");
  const missing = event(1, {state: "no_face", facePresent: false, confidence: 0});
  assert.equal(safety.update(missing, true).severity, "warning");
  assert.equal(safety.update(missing, false).severity, "normal");
});
