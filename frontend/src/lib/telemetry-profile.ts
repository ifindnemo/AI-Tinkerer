import profile from "../data/telemetry-profile.json";
import type {Telemetry} from "./telemetry";

export const operatingRanges = profile.channels;
export type OperatingChannel = keyof typeof operatingRanges;

// A shared smooth driving signal creates coherent demo motion. It is not a
// correlation model fitted to the workbook and never replays a workbook row.
export function sampleOperatingRanges(tick: number) {
  const demand = 0.5 + 0.32 * Math.sin(tick * 0.055) + 0.12 * Math.sin(tick * 0.17 + 0.8);
  const at = (channel: OperatingChannel, offset = 0) => {
    const [low, high] = operatingRanges[channel].range;
    const value = low + (high - low) * Math.max(0, Math.min(1, demand + offset));
    return Math.round(value * 100) / 100;
  };
  return {
    rpm: Math.round(at("rpm")),
    map: at("map", 0.025 * Math.sin(tick * 0.13)),
    tps: at("tps", 0.035 * Math.sin(tick * 0.11)),
    consumption: at("consumption"),
    speed: at("speed", 0.04 * Math.sin(tick * 0.07 - 0.6)),
    // Engine load is absent from the workbook. This relationship is authored.
    engineLoad: Math.round((18 + demand * 48) * 10) / 10,
  };
}

export function operatingUnit(t: Telemetry, channel: OperatingChannel) {
  if (channel === "rpm") return "rpm";
  if (channel === "consumption") return "L/h";
  // MAP/TPS/Speed do not document units. Do not label their raw ranges kPa/%/km/h.
  if (t.operatingSource === "excel-range") return "raw";
  return channel === "map" ? "kPa" : channel === "tps" ? "%" : "km/h";
}
