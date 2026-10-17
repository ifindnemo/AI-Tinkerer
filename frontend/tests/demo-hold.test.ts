import assert from "node:assert/strict";
import test from "node:test";
import {demoHold} from "../src/lib/demo-hold";

test("paused time is not added back when the demo resumes", () => {
  demoHold.reset();
  const start = demoHold.now(1_000);
  demoHold.pause(1_500);
  assert.equal(demoHold.now(9_000), demoHold.now(1_500));
  demoHold.resume(31_500);
  assert.equal(demoHold.now(32_000) - start, 1_000);
  demoHold.reset();
});

test("a scene change is counted without pausing the clock", () => {
  demoHold.reset();
  demoHold.bumpScene();
  assert.equal(demoHold.scene(), 1);
  assert.equal(demoHold.isPaused(), false);
  demoHold.reset();
});
