import assert from "node:assert/strict";
import test from "node:test";
import {BackendVehicleSessionAdapter} from "../src/lib/backend/session";
import {vehicles} from "../src/lib/vehicles";
import type {BlackboxBatch} from "../src/lib/blackbox/types";

test("superseded batch 409 quietly resumes collecting and never marks the backend offline", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async input => String(input).endsWith("/telemetry")
    ? Response.json({error: "Superseded"}, {status: 409}) : Response.json({status: "ok"});
  const adapter = new BackendVehicleSessionAdapter(vehicles[0]);
  try {
    adapter.start();
    await (adapter as unknown as {submit(batch: BlackboxBatch): Promise<void>}).submit({} as BlackboxBatch);
    assert.equal(adapter.getSnapshot().backend?.phase, "collecting");
    assert.equal(adapter.getSnapshot().backend?.api, "online");
    assert.equal(adapter.getSnapshot().backend?.error, "");
  } finally {
    adapter.dispose();
    globalThis.fetch = original;
  }
});
