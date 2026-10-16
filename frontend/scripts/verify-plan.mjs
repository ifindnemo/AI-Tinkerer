// BASE_URL=http://127.0.0.1:3000 node scripts/verify-plan.mjs        (backend mode; ~5 minutes)
// The plan comes from the car and the driver together: the same "running warm" car gets
// "garage when convenient" with no camera alert, and "rest first" (no appointment proposal) with a drowsy driver.
import assert from "node:assert/strict";
import {chromium} from "@playwright/test";

const base = process.env.BASE_URL || "http://127.0.0.1:3000";
const browser = await chromium.launch({args: ["--no-sandbox", "--enable-gpu", "--use-gl=angle", "--use-angle=gl"]});

async function run(drowsy) {
  const context = await browser.newContext({viewport: {width: 1440, height: 900}});
  await context.addInitScript(() => {try {localStorage.setItem("car-neuron.agent-mode", "backend"); localStorage.setItem("car-neuron.lang", "vi");} catch { /* blocked storage */ }});
  const page = await context.newPage();
  const replies = [];
  page.on("response", async response => {
    if (!response.url().endsWith("/api/vehicle/telemetry")) return;
    try { replies.push((await response.json()).latest); } catch { /* not JSON */ }
  });
  await page.goto(`${base}/garage?presenter=1&reset=1`);
  // Choosing before the page has hydrated is lost (the scenario stays "normal"): choose until it holds.
  const scenario = page.getByLabel("Kịch bản mô phỏng");
  for (let tries = 0; tries < 10 && (await scenario.inputValue()) !== "warm"; tries++) { await page.waitForTimeout(1000); await scenario.selectOption("warm"); }
  await page.waitForTimeout(1500);
  if ((await scenario.inputValue()) !== "warm") await scenario.selectOption("warm");
  if (drowsy) await page.getByTestId("garage-camera-sim-drowsy").click();
  // The first warning or critical reply carries the plan; with the camera, the first one that already saw the
  // drowsy driver (the camera alert can land a batch after the car's first warning).
  const wanted = item => item?.plan && (!drowsy || item.plan.driver === "drowsy");
  for (let waited = 0; waited < 150_000 && !replies.some(wanted); waited += 2000) await page.waitForTimeout(2000);
  const reply = replies.find(wanted);
  assert.ok(reply, `${drowsy ? "drowsy" : "no camera"}: no warning reply with a plan within 150 s`);
  const plan = reply.plan;
  if (drowsy) {
    assert.ok(["rest_then_decide", "stop_rest_and_get_help"].includes(plan.code), `drowsy driver got plan ${plan.code}`);
    assert.equal(plan.booking, false);
    assert.equal(reply.pending_action ?? null, null, "no appointment is proposed to a drowsy driver");
    await page.getByTestId("agent-report-plan").first().waitFor({state: "visible", timeout: 10_000});
  } else {
    assert.ok(["garage_when_convenient", "stop_and_get_help"].includes(plan.code), `no camera alert got plan ${plan.code}`);
  }
  await context.close();
  return `${plan.code} (${reply.assessment.severity})`;
}

try {
  // A camera alert from an earlier run stays "live" for 60 s on the backend (driver/registry.py): let it expire.
  await new Promise(resolve => setTimeout(resolve, 65_000));
  const alert = await run(false);
  const drowsy = await run(true);
  console.log(`PASS: same car, different plan: no camera alert → ${alert}; drowsy driver → ${drowsy}`);
} finally {
  await browser.close();
}
