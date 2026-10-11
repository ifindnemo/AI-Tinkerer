// Simulated ECU readings for the Vehicle Guardian demo. Always labelled as simulated: there is no
// car connected to this page. Values are a pure function of time so tests and replays agree.
import type {VehicleSnapshot} from "./types";

export type EcuScenario = "normal" | "warm" | "overheat" | "parked";
export const ECU_SCENARIOS: EcuScenario[] = ["normal", "warm", "overheat", "parked"];
export const DEFAULT_ECU: EcuScenario = "warm";
const START_MINUTES = 128; // the brief's long drive: over two hours at the wheel

const sway = (elapsedMs: number, period: number, amplitude: number) => amplitude * Math.sin((2 * Math.PI * elapsedMs) / period);
const round1 = (value: number) => Math.round(value * 10) / 10;

export function ecuReading(scenario: EcuScenario, elapsedMs: number, t: number): VehicleSnapshot {
  const minutes = START_MINUTES + Math.floor(Math.max(0, elapsedMs) / 60_000);
  const base = {source: "simulated" as const, capturedAt: new Date(t).toISOString(), drivingMinutes: minutes};
  switch (scenario) {
    case "normal":
      return {...base, speedKmh: round1(60 + sway(elapsedMs, 17_000, 3)), coolantC: round1(90 + sway(elapsedMs, 23_000, 0.6)), engineLoadPct: round1(45 + sway(elapsedMs, 13_000, 4))};
    case "warm":
      // Above the product's early-warning threshold (105 °C), well below the 120 °C stop rule.
      return {...base, speedKmh: round1(65 + sway(elapsedMs, 17_000, 2)), coolantC: round1(107 + sway(elapsedMs, 29_000, 0.6)), engineLoadPct: round1(72 + sway(elapsedMs, 13_000, 2))};
    case "overheat":
      return {...base, speedKmh: round1(62 + sway(elapsedMs, 17_000, 2)), coolantC: round1(122 + sway(elapsedMs, 19_000, 0.8)), engineLoadPct: round1(74 + sway(elapsedMs, 13_000, 2))};
    case "parked":
      return {...base, speedKmh: 0, coolantC: round1(88 + sway(elapsedMs, 23_000, 0.4)), engineLoadPct: round1(18 + sway(elapsedMs, 13_000, 1))};
  }
}
