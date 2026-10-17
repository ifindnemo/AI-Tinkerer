import assert from "node:assert/strict";
import test from "node:test";
import {clearDemoState, demoKeys, withoutReset} from "../src/lib/demo-reset";

function fakeStorage(initial: Record<string, string>) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() {return data.size;},
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => void data.delete(key),
  };
}

test("only the demo's own keys are removed", () => {
  const storage = fakeStorage({
    "car-neuron.driver.v1": "{}", "car-neuron.agent-dock.v1": "{}", "car-neuron.lang": "en", "car-neuron.agent-lang": "en",
    "car-neuron.backend-incident.bmw-m2": "inc_1", "autolink.vehicle-session.v1.bmw-m2": "{}",
    "theme": "dark", "other-app.key": "1",
  });
  const removed = clearDemoState(storage);
  assert.equal(removed.length, 4);
  assert.deepEqual(Array.from(storage.data.keys()).sort(), ["car-neuron.agent-lang", "car-neuron.lang", "other-app.key", "theme"], "the chosen languages survive a reset");
  assert.deepEqual(demoKeys(["car-neuron.x", "x"]), ["car-neuron.x"]);
});

test("a blocked storage never throws", () => {
  const blocked = {get length(): number {throw new Error("blocked");}, key: () => null, removeItem: () => {}};
  assert.deepEqual(clearDemoState(blocked), []);
});

test("the reset parameter is dropped from the address, the rest is kept", () => {
  assert.equal(withoutReset("?presenter=1&reset=1", "/garage", "#car-agent"), "/garage?presenter=1#car-agent");
  assert.equal(withoutReset("?reset=1", "/driver"), "/driver");
  assert.equal(withoutReset("", "/garage"), "/garage");
});
