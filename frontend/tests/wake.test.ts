import assert from "node:assert/strict";
import test from "node:test";
import {commandAfterWake, commandIsQuestion, looksLikeEcho, parseControl, playbackControl} from "../src/lib/agent/wake";

test("hey neuron opens a conversation and keeps the question", () => {
  assert.equal(commandAfterWake("Hey, Neuron — how hot is the engine?"), "how hot is the engine");
  assert.equal(commandAfterWake("hay neuron xe dang sao"), "xe dang sao");
  assert.equal(commandAfterWake("hey new ron water temperature"), "water temperature");
  assert.equal(commandAfterWake("hey neurons"), "");
});

test("ordinary speech and the product name do not wake the agent", () => {
  assert.equal(commandAfterWake("the coolant is warm"), null);
  assert.equal(commandAfterWake("car neuron says stop"), null);
});

test("a one-word fragment waits for the recorded question", () => {
  assert.equal(commandIsQuestion(""), false);
  assert.equal(commandIsQuestion("hot"), false);
  assert.equal(commandIsQuestion("how hot"), true);
  assert.equal(commandIsQuestion("temperature"), true);
});

test("stop is a quiet command only when it is the whole utterance", () => {
  assert.equal(parseControl("stop", {inConversation: true}), "quiet");
  assert.equal(parseControl("Hey neuron, stop", {inConversation: false}), "quiet");
  assert.equal(parseControl("im lặng", {inConversation: true}), "quiet");
  assert.equal(parseControl("kết thúc hội thoại", {inConversation: true}), "end");
  assert.equal(parseControl("bật lại", {inConversation: true}), "resume");
  assert.equal(parseControl("stop the engine", {inConversation: true}), null);
  assert.equal(parseControl("don't stop", {inConversation: true}), null);
  assert.equal(parseControl("why did you stop?", {inConversation: true}), null);
  assert.equal(parseControl("đừng dừng cảnh báo", {inConversation: true}), null);
  assert.equal(parseControl("stop", {inConversation: false}), null);
});

test("a line the speaker is already saying is treated as echo", () => {
  assert.equal(looksLikeEcho("Hey Neuron, the coolant is high", "Hey Neuron, the coolant is high. Ease off."), true);
  assert.equal(looksLikeEcho("why are you warning me", "Hey Neuron, the coolant is high"), false);
});

test("playback accepts only a final wake control and rejects echo and ordinary speech", () => {
  assert.equal(playbackControl("Hey Neuron, stop", "The coolant is high.", true), "quiet");
  assert.equal(playbackControl("Hey Neuron, dừng nói", "Nước làm mát đang nóng.", true), "quiet");
  assert.equal(playbackControl("Hey Neuron, stop", null, false), null);
  assert.equal(playbackControl("stop", null, true), null);
  assert.equal(playbackControl("Hey Neuron, stop the engine", null, true), null);
  assert.equal(playbackControl("Hey Neuron, how hot is it?", null, true), null);
  assert.equal(playbackControl("Hey Neuron, stop", "Try saying Hey Neuron, stop to silence alerts.", true), null);
});
