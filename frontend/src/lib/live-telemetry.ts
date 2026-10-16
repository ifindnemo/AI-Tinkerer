import { getMockTelemetry, type ScenarioId, type Telemetry } from "./telemetry";

import {sampleOperatingRanges, sampleStableOperatingRanges} from "./telemetry-profile";

const round = (n: number) => Math.round(n * 10) / 10;

// Gradual overheating for the connected agent demo: coolant climbs 95 → 105 → 115°C
// with the fan off and a flat load, then crosses the backend 120°C hard rule.
// Seconds are compressed for the demo; these are authored values, not BMW limits.
export const OVERHEAT_RAMP: readonly (readonly [tick: number, coolant: number])[] = [[0, 95], [15, 105], [30, 115], [42, 122]];
export const OVERHEAT_DTC_AT = 118;

export function overheatCoolant(tick: number) {
  const last = OVERHEAT_RAMP[OVERHEAT_RAMP.length - 1];
  if (tick >= last[0]) return {coolant: last[1] + Math.sin(tick * 0.4) * 0.3, trendPerMinute: 0};
  const index = OVERHEAT_RAMP.findIndex(([at]) => at > tick);
  const [t0, c0] = OVERHEAT_RAMP[index - 1];
  const [t1, c1] = OVERHEAT_RAMP[index];
  const slope = (c1 - c0) / (t1 - t0);
  return {coolant: c0 + (tick - t0) * slope, trendPerMinute: slope * 60};
}

// First second at which the ramp reaches `coolant` (landing chart and intro film).
export function overheatSecondAt(coolant: number) {
  for (let s = 0; s <= OVERHEAT_RAMP[OVERHEAT_RAMP.length - 1][0]; s += 0.05) if (overheatCoolant(s).coolant >= coolant) return Math.round(s * 100) / 100;
  return Infinity;
}

// "Running warm" for the camera demo: a car cruising at about 65 km/h whose coolant has crossed the
// early-warning line (105 °C) and stays there, below the 120 °C mandatory stop. Authored values.
export const WARM_COOLANT_C = 106.5;
function warmSample(base: Telemetry, tick: number, now: Date): Telemetry {
  const climb = Math.min(1, Math.max(0, tick) / 10); // 96 → 106.5 °C in ten seconds, then it holds
  const coolant = 96 + (WARM_COOLANT_C - 96) * climb + (tick >= 10 ? Math.sin(tick * 0.4) * 0.4 : 0);
  const drive = Math.sin(tick * 0.3);
  const moved = Math.min(tick, 600);
  return {
    ...base, operatingSource: "scenario", capturedAt: now.toISOString(),
    coolant: round(coolant), coolantTrend: tick < 10 ? round((WARM_COOLANT_C - 96) / 10 * 60) : 0, oil: round(coolant + 7),
    intake: round(40 + Math.sin(tick * 0.1)),
    speed: round(65 + drive * 1.5), rpm: Math.round(2500 + drive * 40),
    engineLoad: round(72 + Math.sin(tick * 0.4) * 1), map: round(62 + drive * 0.8),
    tps: round(28 + drive * 0.5), consumption: round(8.5 + drive * 0.1),
    battery: round(14.1 + Math.sin(tick * 0.25) * 0.05),
    fan: 35, fault: 0, dtc: [],
    location: {...base.location, lat: Math.round((base.location.lat - moved * 0.0001) * 1e5) / 1e5, lon: Math.round((base.location.lon + moved * 0.00002) * 1e5) / 1e5},
  };
}

function overheatSample(base: Telemetry, tick: number, now: Date): Telemetry {
  const {coolant, trendPerMinute} = overheatCoolant(Math.max(0, tick));
  const drive = Math.sin(tick * 0.3);
  const moved = Math.min(tick, 600);
  return {
    ...base, operatingSource: "scenario", capturedAt: now.toISOString(),
    coolant: round(coolant), coolantTrend: round(trendPerMinute), oil: round(coolant + 7),
    intake: round(38 + Math.min(tick, 42) * 0.1),
    // Cruising at a steady load: heat rises without a matching rise in demand.
    speed: round(60 + drive * 1.5), rpm: Math.round(2200 + drive * 40),
    engineLoad: round(36 + Math.sin(tick * 0.4) * 0.8), map: round(46 + drive * 0.8),
    tps: round(17 + drive * 0.5), consumption: round(6.4 + drive * 0.1),
    battery: round(14.1 + Math.sin(tick * 0.25) * 0.05),
    fan: 0, fault: 1, dtc: coolant >= OVERHEAT_DTC_AT ? ["P0217"] : [],
    location: {...base.location, lat: Math.round((base.location.lat - moved * 0.0001) * 1e5) / 1e5, lon: Math.round((base.location.lon + moved * 0.00002) * 1e5) / 1e5},
  };
}

// Synthesized per-vehicle samples, not rows replayed from the example workbook.
export function liveSample(scenario: ScenarioId, vehicleId: string, tick: number, now = new Date()): Telemetry {
  const base = getMockTelemetry(scenario, vehicleId);
  if (scenario === "engine" && base.powertrain !== "ev") return overheatSample(base, tick, now);
  if (scenario === "warm" && base.powertrain !== "ev") return warmSample(base, tick, now);
  const wave = Math.sin(tick * 0.55);
  const calm = Math.sin(tick * 0.08);
  const running = scenario !== "offline";
  const stable = scenario === "normal";
  const fromExcel = base.powertrain !== "ev" && running && scenario === "environment";
  return {
    ...base, operatingSource: "scenario", capturedAt: now.toISOString(),
    rpm: running ? stable ? Math.round(900 + calm * 6) : Math.round(820 + (wave + 1) * 280) : 0,
    speed: 0,
    coolant: stable ? round(base.coolant + calm * 0.1) : round(base.coolant + Math.min(tick, 600) * base.coolantTrend / 60),
    oil: stable ? round(base.oil + calm * 0.2) : round(base.oil + Math.min(tick, 600) * base.coolantTrend / 80),
    coolantTrend: tick < 600 ? base.coolantTrend : 0,
    battery: round(14.1 + (stable ? calm * 0.02 : Math.sin(tick * 0.3) * 0.15)),
    map: round(34 + (stable ? calm * 0.1 : wave * 2)), tps: round(7 + (stable ? calm * 0.1 : (wave + 1) * 3)),
    engineLoad: round(stable ? 42 + calm * 0.2 : 18 + (wave + 1) * 5), consumption: round(stable ? 6 + calm * 0.03 : 0.9 + (wave + 1) * 0.2),
    ...(stable && base.powertrain !== "ev" ? {...sampleStableOperatingRanges(tick), operatingSource: "excel-range" as const} : {}),
    ...(fromExcel ? {...sampleOperatingRanges(tick), operatingSource: "excel-range" as const} : {}),
    ...(base.powertrain === "ev" ? {rpm: 0} : {}),
    fault: scenario === "engine" ? 1 : 0,
    ...(base.traction ? {traction: {...base.traction, batteryTemp: round(base.traction.batteryTemp + (stable ? calm * 0.1 : wave * 0.4)), motorTemp: round(base.traction.motorTemp + (stable ? calm * 0.1 : wave * 0.6))}} : {}),
  };
}
