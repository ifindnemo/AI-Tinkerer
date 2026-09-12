import test, { after } from "node:test";
import { vehicles } from "../src/lib/vehicles";
// Synthetic profiles exercise future powertrains without shipping unavailable assets.
const catalogLength = vehicles.length;
vehicles.push(
  { ...vehicles[0], id: "test-ev", brand: "Test", name: "EV", powertrain: "ev" },
  { ...vehicles[0], id: "test-hybrid", brand: "Test", name: "Hybrid", powertrain: "hybrid" },
);
after(() => { vehicles.splice(catalogLength); });
import assert from "node:assert/strict";
import {
  analyzeTelemetry,
  getMockTelemetry,
  fetchTelemetry,
} from "../src/lib/telemetry";
test("normal readings produce a good assessment", () => {
  const r = analyzeTelemetry(getMockTelemetry("normal"));
  assert.equal(r.cause, "normal");
  assert.equal(r.severity, "good");
});
test("hot weather with stable coolant is environmental", () => {
  const r = analyzeTelemetry(getMockTelemetry("environment"));
  assert.equal(r.cause, "environment");
  assert.equal(r.severity, "watch");
});
test("dangerous engine temperature takes priority even in hot weather", () => {
  const r = analyzeTelemetry({ ...getMockTelemetry("engine"), ambient: 42 });
  assert.equal(r.cause, "engine");
  assert.equal(r.severity, "critical");
});
test("rapid temperature rise cannot be attributed solely to weather", () => {
  assert.equal(
    analyzeTelemetry({ ...getMockTelemetry("environment"), coolantTrend: 3 })
      .cause,
    "engine",
  );
});
test("offline and stale data cannot generate a healthy report", () => {
  assert.throws(() => analyzeTelemetry(getMockTelemetry("offline")));
  assert.throws(() =>
    analyzeTelemetry({
      ...getMockTelemetry("normal"),
      capturedAt: "2020-01-01T00:00:00Z",
    }),
  );
});
test("invalid sensor data is rejected", () => {
  assert.throws(() =>
    analyzeTelemetry({ ...getMockTelemetry("normal"), coolant: NaN }),
  );
});
test("cancelled requests reject without returning stale scenario data", async () => {
  const c = new AbortController();
  const request = fetchTelemetry("normal", c.signal);
  c.abort();
  await assert.rejects(request, { name: "AbortError" });
});

test("EV mock uses the selected vehicle and BMS temperatures", () => {
  const t = getMockTelemetry("normal", "test-ev");
  assert.equal(t.vehicleId, "test-ev");
  assert.equal(t.powertrain, "ev");
  assert.equal(t.traction?.batteryTemp, 32);
  const report = analyzeTelemetry(t);
  assert.equal(report.vehicleId, t.vehicleId);
  assert.equal(report.vehicleName, "Test EV");
  assert.equal(report.severity, "good");
});
test("EV environmental heat is distinct from traction overheating", () => {
  assert.equal(
    analyzeTelemetry(getMockTelemetry("environment", "test-ev")).cause,
    "environment",
  );
  const report = analyzeTelemetry({
    ...getMockTelemetry("engine", "test-ev"),
    ambient: 43,
  });
  assert.equal(report.cause, "traction");
  assert.equal(report.severity, "critical");
});
test("EV missing BMS data and offline data never produce healthy results", () => {
  assert.throws(() =>
    analyzeTelemetry({
      ...getMockTelemetry("normal", "test-ev"),
      traction: undefined,
    }),
  );
  assert.throws(() =>
    analyzeTelemetry(getMockTelemetry("offline", "test-ev")),
  );
});
test("hybrid and combustion reports preserve their vehicle identity", () => {
  const h = analyzeTelemetry(getMockTelemetry("normal", "test-hybrid"));
  assert.equal(h.powertrain, "hybrid");
  assert.equal(h.vehicleName, "Test Hybrid");
  const c = analyzeTelemetry(getMockTelemetry("engine", "bmw-m2"));
  assert.equal(c.vehicleId, "bmw-m2");
  assert.equal(c.cause, "engine");
});

test("unavailable vehicle IDs cannot silently report another car", () => {
  assert.throws(() => getMockTelemetry("normal", "removed-car"), /Unknown vehicle/);
});
