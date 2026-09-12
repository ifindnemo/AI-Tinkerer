import { getMockTelemetry, type ScenarioId, type Telemetry } from "./telemetry";

import {sampleOperatingRanges, sampleStableOperatingRanges} from "./telemetry-profile";

// Synthesized per-vehicle samples, not rows replayed from the example workbook.
export function liveSample(scenario: ScenarioId, vehicleId: string, tick: number, now = new Date()): Telemetry {
  const base = getMockTelemetry(scenario, vehicleId);
  const wave = Math.sin(tick * 0.55);
  const calm = Math.sin(tick * 0.08);
  const round = (n: number) => Math.round(n * 10) / 10;
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
