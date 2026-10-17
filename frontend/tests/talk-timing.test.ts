import assert from "node:assert/strict";
import test from "node:test";
import {replyToAudioMs} from "../src/lib/agent/timing";

test("reply-to-audio is finite, non-negative, and absent without both observations", () => {
  assert.equal(replyToAudioMs(100, 350), 250);
  assert.equal(replyToAudioMs(350, 100), 0);
  assert.equal(replyToAudioMs(null, 100), null);
  assert.equal(replyToAudioMs(100, null), null);
  assert.equal(replyToAudioMs(NaN, 100), null);
});
