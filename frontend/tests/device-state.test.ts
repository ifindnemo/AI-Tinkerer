import assert from "node:assert/strict";
import test from "node:test";
import {applySnapshot, coolantTrend, initialDeviceState, isConnected, latestValues, playNext, receiveAnalysis, receiveSamples, toTelemetry} from "../src/lib/device/state";
import {thermalLevel} from "../src/lib/thermal-status";
import type {DeviceAnalysis, DeviceSample, DeviceSnapshot} from "../src/lib/device/types";

const at = (second: number) => new Date(Date.UTC(2026, 9, 11, 1, 0, second)).toISOString();
const sample = (second: number, coolant = 90): DeviceSample => ({capturedAt: at(second), signals: {coolant, rpm: 800, speed: 0}});
const trip = (id: string) => ({id, vehicle_id: "car", source: "fake-elm", simulated: true, started_at: at(0), ended_at: at(0), status: "open", sample_count: 0, distance_km: 0, max_coolant: null, event_count: 0, mil: false});
const snapshot = (samples: DeviceSample[]): DeviceSnapshot => ({
  vehicle_id: "car", profile: null as never, trip: trip("t1"), samples,
  dtc: {trip_id: "t1", read_at: null, mil: false, codes: [], earlier: []}, analysis: null, analyses: [],
});

test("a snapshot replaces the state, including after a reconnect", () => {
  let state = receiveSamples(applySnapshot(initialDeviceState(), snapshot([sample(0)]), 1000), "t1", [sample(1)], 1000);
  state = applySnapshot(state, snapshot([sample(5), sample(4)]), 2000);
  assert.deepEqual(state.samples.map(s => s.capturedAt), [at(4), at(5)]);
  assert.equal(state.queue.length, 0);
  assert.equal(state.status, "live");
});

test("batches play out one sample per tick and duplicates are ignored", () => {
  let state = applySnapshot(initialDeviceState(), snapshot([sample(0)]), 0);
  state = receiveSamples(state, "t1", [sample(1), sample(2), sample(3)], 0);
  state = receiveSamples(state, "t1", [sample(2), sample(3)], 0);
  assert.equal(state.queue.length, 3);
  state = playNext(state);
  assert.deepEqual(state.samples.map(s => s.capturedAt), [at(0), at(1)]);
  state = playNext(playNext(playNext(state)));
  assert.equal(state.samples.length, 4);
  assert.equal(playNext(state), state);
});

test("a new trip starts a fresh chart", () => {
  let state = applySnapshot(initialDeviceState(), snapshot([sample(0), sample(1)]), 0);
  state = receiveSamples(state, "t2", [sample(100)], 0);
  assert.equal(state.samples.length, 0);
  assert.deepEqual(state.queue.map(s => s.capturedAt), [at(100)]);
});

test("connection depends on recent data in browser time", () => {
  const state = receiveSamples(applySnapshot(initialDeviceState(), snapshot([]), 0), "t1", [sample(1)], 10_000);
  assert.equal(isConnected(state, 15_000), true);
  assert.equal(isConnected(state, 40_000), false);
  assert.equal(isConnected(initialDeviceState(), 0), false);
});

test("coolant trend is a least-squares slope per minute", () => {
  const rising = Array.from({length: 31}, (_, s) => sample(s, 92 + s * 0.2));
  assert.equal(coolantTrend(rising), 12);
  assert.equal(coolantTrend([sample(0)]), null);
});

test("missing signals stay unknown for the viewer; the fan never looks like 0 %", () => {
  const state = applySnapshot(initialDeviceState(), snapshot([sample(0, 116), sample(1, 116), sample(2, 116)]), 0);
  const telemetry = toTelemetry(state, "car", true);
  assert.ok(Number.isNaN(telemetry.oil) && Number.isNaN(telemetry.fan));
  assert.equal(thermalLevel(telemetry, "engine"), "unknown");
  assert.equal(thermalLevel(telemetry, "cooling"), "danger");
});

test("analyses are de-duplicated and the newest is shown", () => {
  const analysis = (id: string, second: number) => ({id, at: at(second)}) as DeviceAnalysis;
  let state = receiveAnalysis(initialDeviceState(), analysis("a1", 10));
  state = receiveAnalysis(state, analysis("a0", 5));
  state = receiveAnalysis(state, analysis("a1", 10));
  assert.equal(state.analysis?.id, "a1");
  assert.deepEqual(state.analyses.map(a => a.id), ["a1", "a0"]);
});

test("slow signals keep their last value for a minute instead of flickering", () => {
  const samples: DeviceSample[] = [
    {capturedAt: at(0), signals: {coolant: 90, fuel: 62, oil: 96}},
    {capturedAt: at(1), signals: {coolant: 90.2}},
    {capturedAt: at(5), signals: {coolant: 90.4, oil: 97}},
    {capturedAt: at(6), signals: {coolant: 90.5}},
  ];
  assert.deepEqual(latestValues(samples), {coolant: 90.5, oil: 97, fuel: 62});
  const later = [...samples, {capturedAt: at(90), signals: {coolant: 91}}];
  assert.deepEqual(latestValues(later), {coolant: 91});
  const telemetry = toTelemetry(applySnapshot(initialDeviceState(), snapshot(samples), 0), "car", true);
  assert.equal(telemetry.oil, 97);
  assert.equal(telemetry.fuel, 62);
});
