import assert from "node:assert/strict";
import test from "node:test";
import {BACKEND_RESET_PATH, clearDemoState, demoKeys, resetBackendState, withoutReset} from "../src/lib/demo-reset";

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

test("the backend reset posts to the same-origin proxy and reports success", async () => {
  const seen: {url: string; method: string; body: string}[] = [];
  const request = async (url: string, init: {method: string; body: string}) => {
    seen.push({url, method: init.method, body: init.body});
    return {ok: true};
  };
  assert.equal(await resetBackendState(request), true);
  assert.equal(await resetBackendState(request, 2000, "car"), true);
  assert.deepEqual(seen, [
    {url: BACKEND_RESET_PATH, method: "POST", body: '{"scope":"demo"}'},
    {url: BACKEND_RESET_PATH, method: "POST", body: '{"scope":"car"}'},
  ]);
  assert.equal(BACKEND_RESET_PATH, "/api/vehicle/demo/reset");
});

test("a failing, refusing or hanging backend never blocks the browser reset", async () => {
  assert.equal(await resetBackendState(async () => ({ok: false})), false);
  assert.equal(await resetBackendState(async () => { throw new Error("offline"); }), false);
  const started = Date.now();
  const hanging = await resetBackendState((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error("aborted")));
  }), 50);
  assert.equal(hanging, false);
  assert.ok(Date.now() - started < 1000, "gave up after the timeout");
});
