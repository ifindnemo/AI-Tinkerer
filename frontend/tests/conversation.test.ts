import assert from "node:assert/strict";
import test from "node:test";
import {claimSend, idleConversation, reduceConversation, requestStillValid} from "../src/lib/agent/conversation";

test("the send latch accepts the first of the timer and the button", () => {
  const listening = reduceConversation(idleConversation(), {type: "start"});
  const first = claimSend(listening);
  const second = claimSend(first.state);
  assert.equal(first.send, true);
  assert.equal(second.send, false);
  assert.equal(first.state.phase, "transcribing");
});

test("ending a recording does not claim a send", () => {
  const listening = reduceConversation(idleConversation(), {type: "start"});
  const ended = reduceConversation(listening, {type: "end"});
  assert.equal(claimSend(ended).send, false);
  assert.equal(ended.phase, "idle");
});

test("a text-only answer can follow up and a queued reply is not yet speaking", () => {
  let state = reduceConversation(idleConversation(), {type: "start"});
  state = claimSend(state).state;
  const textOnly = reduceConversation(state, {type: "answer", textOnly: true});
  assert.equal(textOnly.phase, "followup");
  const waiting = reduceConversation(state, {type: "answer", textOnly: false});
  assert.equal(waiting.phase, "thinking");
  assert.equal(reduceConversation(waiting, {type: "audio-start"}).phase, "speaking");
});

test("an old scene or language does not stay valid", () => {
  const captured = {session: "bmw-m2", lang: "vi", generation: 2};
  assert.equal(requestStillValid(captured, captured), true);
  assert.equal(requestStillValid(captured, {...captured, lang: "en"}), false);
  assert.equal(requestStillValid(captured, {...captured, session: "other"}), false);
  assert.equal(requestStillValid(captured, {...captured, generation: 3}), false);
});

test("interrupt and scene changes retire the previous generation", () => {
  const listening = reduceConversation(idleConversation(), {type: "start"});
  const interrupted = reduceConversation(listening, {type: "interrupt"});
  assert.equal(interrupted.generation, listening.generation + 1);
  assert.equal(interrupted.sendLatch, false);
  const scene = reduceConversation(interrupted, {type: "scene"});
  assert.equal(scene.phase, "idle");
});

test("empty transcript and follow-up timeout release a consumed send latch", () => {
  const recording = reduceConversation(idleConversation(), {type: "start"});
  const transcribing = claimSend(recording).state;
  assert.equal(reduceConversation(transcribing, {type: "no-speech"}).phase, "idle");
  const timeout = reduceConversation(recording, {type: "follow-timeout"});
  assert.equal(timeout.phase, "idle");
  assert.equal(timeout.sendLatch, false);
});
