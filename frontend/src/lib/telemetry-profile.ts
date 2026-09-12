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

// Normal driving stays close to a steady operating point. Values still sit
// inside the filtered workbook ranges, but only move by a few tenths.
export function sampleStableOperatingRanges(tick: number) {
  const calm = Math.sin(tick * 0.08);
  const at = (channel: OperatingChannel, amplitude: number) => {
    const [low, high] = operatingRanges[channel].range;
    const midpoint = low + (high - low) * 0.5;
    return Math.round((midpoint + (high - low) * amplitude * calm) * 100) / 100;
  };
  return {
    rpm: Math.round(at("rpm", 0.003)),
    map: at("map", 0.002),
    tps: at("tps", 0.002),
    consumption: at("consumption", 0.003),
    speed: at("speed", 0.003),
    engineLoad: Math.round((42 + calm * 0.2) * 10) / 10,
  };
}

export function operatingUnit(t: Telemetry, channel: OperatingChannel) {
  if (channel === "rpm") return "rpm";
  if (channel === "consumption") return "L/h";
  // MAP/TPS/Speed do not document units. Do not label their raw ranges kPa/%/km/h.
  if (t.operatingSource === "excel-range") return "raw";
  return channel === "map" ? "kPa" : channel === "tps" ? "%" : "km/h";
}
