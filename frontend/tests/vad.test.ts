import assert from "node:assert/strict";
import test from "node:test";
import {createVad, listenLimit, vadStep} from "../src/lib/agent/vad";

function run(levels: Array<[number, number]>, startWait = 8_000) {
  let state = createVad();
  let endpoint: string = "none";
  for (const [rms, dt] of levels) {
    const step = vadStep(state, rms, dt, {startWaitMs: startWait, trailMs: 900, maxMs: 20_000});
    state = step.state;
    endpoint = step.endpoint;
    if (endpoint !== "none") break;
  }
  return {state, endpoint};
}

test("silence never becomes a transcript", () => {
  const result = run([[0.005, 8_000]]);
  assert.equal(result.endpoint, "no-speech");
  assert.equal(result.state.heard, false);
});

test("a short gap inside a sentence does not end the turn", () => {
  const result = run([[0.08, 400], [0.01, 400], [0.08, 400]]);
  assert.equal(result.endpoint, "none");
  assert.equal(result.state.heard, true);
});

test("trailing silence after real speech ends the turn once", () => {
  const result = run([[0.08, 400], [0.005, 1_000]]);
  assert.equal(result.endpoint, "silence");
});

test("a click or a horn blip shorter than the minimum is not speech", () => {
  const result = run([[0.2, 80], [0.005, 2_000]], 8_000);
  assert.equal(result.state.heard, false);
});

test("ordinary sustained RMS is detected at real 80 ms ticks", () => {
  for (const level of [0.04, 0.08, 0.15]) {
    const result = run(Array.from({length: 12}, () => [level, 80]));
    assert.equal(result.state.heard, true, `RMS ${level}`);
  }
});

test("separated clicks do not accumulate into speech", () => {
  const result = run(Array.from({length: 20}, (_, index) => [index % 2 ? 0.005 : 0.1, 80]));
  assert.equal(result.state.heard, false);
});

test("speech starting after eight seconds gets its own speaking budget", () => {
  const levels: Array<[number, number]> = [
    ...Array.from({length: 105}, (): [number, number] => [0.005, 80]),
    ...Array.from({length: 75}, (): [number, number] => [0.04, 80]),
  ];
  const result = run(levels, 10_000);
  assert.equal(result.state.heard, true);
  assert.equal(result.endpoint, "none");
  assert.ok(result.state.elapsed > 10_000);
});

test("invalid measurements cannot poison future VAD frames", () => {
  let state = vadStep(createVad(), NaN, NaN).state;
  for (let i = 0; i < 6; i++) state = vadStep(state, 0.04, 80).state;
  assert.equal(state.heard, true);
  assert.ok(Number.isFinite(state.noise));
});

test("follow-up silence expires at 10 s, but speech that starts at 8 s is still open at 13 s", () => {
  assert.equal(listenLimit(0, null, 10_000, 10_000), "no-speech");
  assert.equal(listenLimit(0, null, 8_000, 10_000), "open");
  assert.equal(listenLimit(0, 8_000, 13_000, 10_000), "open");
  assert.equal(listenLimit(0, 8_000, 28_000, 10_000), "max");
});

test("long continuous speech reaches a bounded endpoint", () => {
  const result = run(Array.from({length: 300}, () => [0.08, 80]));
  assert.equal(result.endpoint, "max");
  assert.equal(result.state.heard, true);
});
