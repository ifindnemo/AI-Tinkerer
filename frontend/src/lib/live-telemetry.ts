import { getMockTelemetry, type ScenarioId, type Telemetry } from "./telemetry";

import {sampleOperatingRanges} from "./telemetry-profile";

// Synthesized per-vehicle samples, not rows replayed from the example workbook.
export function liveSample(scenario: ScenarioId, vehicleId: string, tick: number, now = new Date()): Telemetry {
  const base = getMockTelemetry(scenario, vehicleId);
  const wave = Math.sin(tick * 0.55);
  const round = (n: number) => Math.round(n * 10) / 10;
  const running = scenario !== "offline";
  const fromExcel = base.powertrain !== "ev" && running && scenario !== "engine";
  return {
    ...base, operatingSource: "scenario", capturedAt: now.toISOString(),
    rpm: running ? Math.round(820 + (wave + 1) * 280) : 0,
    speed: 0,
    coolant: round(base.coolant + Math.min(tick, 600) * base.coolantTrend / 60),
    oil: round(base.oil + Math.min(tick, 600) * base.coolantTrend / 80),
    coolantTrend: tick < 600 ? base.coolantTrend : 0,
    battery: round(14.1 + Math.sin(tick * 0.3) * 0.15),
    map: round(34 + wave * 2), tps: round(7 + (wave + 1) * 3),
    engineLoad: round(18 + (wave + 1) * 5), consumption: round(0.9 + (wave + 1) * 0.2),
    ...(fromExcel ? {...sampleOperatingRanges(tick), operatingSource: "excel-range" as const} : {}),
    ...(base.powertrain === "ev" ? {rpm: 0} : {}),
    fault: scenario === "engine" ? 1 : 0,
    ...(base.traction ? {traction: {...base.traction, batteryTemp: round(base.traction.batteryTemp + wave * 0.4), motorTemp: round(base.traction.motorTemp + wave * 0.6)}} : {}),
  };
}
