import assert from "node:assert/strict";
import test from "node:test";
import {commandAfterWake, commandIsQuestion} from "../src/lib/agent/wake";

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
