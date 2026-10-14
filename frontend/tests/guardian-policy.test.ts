import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {DriverSafety} from "../src/lib/driver/safety";
import type {DriverEvent} from "../src/lib/driver/types";
import {ECU_SCENARIOS, ecuReading} from "../src/lib/guardian/ecu";
import {LocalGuardian, canConfirm, decide, muteStillHolds, shouldSound, type DecideInput} from "../src/lib/guardian/policy";

// The same table drives backend/tests/test_guardian.py: browser and server cannot drift apart.
const cases: {name: string; input: DecideInput; expect: ReturnType<typeof decide>}[] =
  JSON.parse(readFileSync(new URL("../../backend/driver/guardian_cases.json", import.meta.url), "utf8"));

for (const item of cases) {
  test(`shared policy case: ${item.name}`, () => assert.deepEqual(decide(item.input), item.expect));
}

const T0 = Date.UTC(2026, 9, 11, 2, 0, 0);
function event(second: number, over: Partial<DriverEvent> = {}): DriverEvent {
  return {
    capturedAt: new Date(T0 + second * 1000).toISOString(),
    facePresent: true, absentMs: 0, confidence: 0.9, state: "attentive",
    eyes: {closed: false, closedMs: 0, perclos: null, score: 0.1},
    head: {direction: "forward", yawDeg: 0, pitchDeg: 0, awayMs: 0}, ...over,
  };
}
const drowsy = (second: number, closedMs: number) => event(second, {state: "drowsy", eyes: {closed: true, closedMs, perclos: null, score: 0.9}});
const warm = (second: number) => ecuReading("warm", second * 1000, T0 + second * 1000);

function run(events: DriverEvent[], ackAt: string | null = null) {
  const safety = new DriverSafety(), guardian = new LocalGuardian();
  return events.map(item => guardian.update(item, safety.update(item, true), warm(Date.parse(item.capturedAt) / 1000 - T0 / 1000), ackAt));
}

test("simulated ECU scenarios sit on the right side of the thresholds", () => {
  for (let ms = 0; ms < 120_000; ms += 1000) {
    assert.ok(ecuReading("normal", ms, T0).coolantC < 105);
    const hot = ecuReading("warm", ms, T0);
    assert.ok(hot.coolantC >= 105 && hot.coolantC < 120 && hot.speedKmh >= 5);
    assert.ok(ecuReading("overheat", ms, T0).coolantC >= 120);
    assert.equal(ecuReading("parked", ms, T0).speedKmh, 0);
  }
  assert.equal(ecuReading("warm", 0, T0).source, "simulated");
  assert.equal(ecuReading("warm", 0, T0).drivingMinutes, 128);
  assert.deepEqual(ECU_SCENARIOS, ["normal", "warm", "overheat", "parked"]);
});

test("demo flow on the device: blink is quiet, closure stops the trip, confirmation keeps the vehicle warning", () => {
  const blink = run([event(0), event(1, {eyes: {closed: true, closedMs: 200, perclos: null, score: 0.8}})]).at(-1)!;
  assert.equal(blink.decision.action, "reduce_load");
  assert.equal(blink.block.driver.attention, "attentive");

  const closed = run([event(0), drowsy(1, 1600), drowsy(2, 2600)]).at(-1)!;
  assert.equal(closed.decision.action, "stop_nearest_safe");
  assert.equal(closed.decision.severity, "critical");
  assert.equal(closed.block.driver.closedMs, 2600);
  assert.match(closed.assessment.recommendations[0], /vị trí an toàn gần nhất/);

  const confirmed = run([event(0), drowsy(1, 2600), event(3)], event(3).capturedAt).at(-1)!;
  assert.equal(confirmed.block.driver.responded, true);
  assert.equal(confirmed.decision.vehicleLevel, "warning");
  assert.equal(confirmed.decision.severity, "warning");
  assert.equal(confirmed.decision.action, "stop_nearest_safe");
});

test("a new closure after the confirmation voids it", () => {
  const relapse = run([drowsy(0, 1600), event(2), drowsy(3, 1600)], event(2).capturedAt).at(-1)!;
  assert.equal(relapse.block.driver.responded, false);
});

test("an unanswered alert escalates after ten seconds", () => {
  const events = [drowsy(0, 1600), ...Array.from({length: 10}, (_, i) => event(i + 1))];
  const results = run(events);
  assert.equal(results[5].decision.driverSeverity, "warning");
  assert.equal(results.at(-1)!.block.driver.unanswered, true);
  assert.equal(results.at(-1)!.decision.severity, "critical");
});

test("severe overheat is critical with the driver attentive and needs no backend", () => {
  const safety = new DriverSafety(), guardian = new LocalGuardian();
  const result = guardian.update(event(0), safety.update(event(0), true), ecuReading("overheat", 0, T0), null);
  assert.equal(result.decision.action, "stop_engine");
  assert.equal(result.assessment.severity, "critical");
  assert.equal(result.assessment.fallbackReason, "local");
});

test("only open eyes facing forward can confirm", () => {
  assert.equal(canConfirm(event(0)), true);
  assert.equal(canConfirm(event(0, {eyes: {closed: true, closedMs: 100, perclos: null, score: 0.7}})), false);
  assert.equal(canConfirm(event(0, {head: {direction: "left", yawDeg: 30, pitchDeg: 0, awayMs: 100}})), false);
  assert.equal(canConfirm(event(0, {confidence: 0.3})), false);
  assert.equal(canConfirm(null), false);
});

test("the horn sounds at a 1.6 s closure even when the warm engine already holds a warning", () => {
  const results = run([event(0), drowsy(1, 1600)]);
  assert.equal(results[0].decision.severity, "warning");
  assert.equal(results[1].decision.severity, "warning");
  assert.equal(shouldSound(results[0].decision, results[1].decision), true);
  assert.equal(shouldSound(null, results[0].decision), false, "a warm engine alone stays visual");
  const overheat = new LocalGuardian().update(event(0), new DriverSafety().update(event(0), true), ecuReading("overheat", 0, T0), null);
  assert.equal(shouldSound(results[0].decision, overheat.decision), true);
  assert.equal(shouldSound(overheat.decision, overheat.decision), false);
});

test("a manual horn mute covers its own alert and lifts when the alert rises, a mandatory stop begins or the alert ends", () => {
  const mute = {driverSeverity: "warning" as const, vehicleCritical: false};
  assert.equal(muteStillHolds(mute, "warning", false), true);
  assert.equal(muteStillHolds(mute, "critical", false), false, "a higher driver level must sound again");
  assert.equal(muteStillHolds(mute, "warning", true), false, "a mandatory engine stop must sound again");
  assert.equal(muteStillHolds(mute, "normal", false), false, "the next alert must sound again");
  assert.equal(muteStillHolds({driverSeverity: "normal", vehicleCritical: true}, "normal", true), true, "muted during a stop, quiet while it lasts");
  assert.equal(muteStillHolds(null, "critical", true), false);
});
