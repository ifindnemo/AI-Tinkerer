// Prototype state kept in this browser only: consent, settings and a compact attention history.
import {DEFAULT_ECU, ECU_SCENARIOS, type EcuScenario} from "../guardian/ecu";
import type {AttentionState} from "./types";

export const DRIVER_STORAGE_KEY = "car-neuron.driver.v1";
export const HISTORY_LIMIT = 180; // one entry per second: the last three minutes
const STATES: AttentionState[] = ["attentive", "distracted", "drowsy", "no_face", "uncertain"];

// The car's motion now comes from the (simulated) ECU speed, not from a manual switch.
export type DriverSettings = {sound: boolean; showVideo: boolean; ecu: EcuScenario};
export type DriverStore = {
  version: 1;
  consent: boolean;
  settings: DriverSettings;
  history: [number, AttentionState][]; // [epoch ms, state]
};

export const defaultDriverStore = (): DriverStore => ({
  version: 1,
  consent: false,
  settings: {sound: true, showVideo: true, ecu: DEFAULT_ECU},
  history: [],
});

/** Never throws: anything unreadable falls back to the defaults, field by field. */
export function decodeDriverStore(raw: string | null): DriverStore {
  const fallback = defaultDriverStore();
  if (!raw) return fallback;
  let value: Partial<DriverStore>;
  try {
    value = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (!value || value.version !== 1) return fallback;
  const settings = (value.settings ?? {}) as Partial<DriverSettings>;
  const bool = (input: unknown, otherwise: boolean) => (typeof input === "boolean" ? input : otherwise);
  return {
    version: 1,
    consent: value.consent === true,
    settings: {
      sound: bool(settings.sound, fallback.settings.sound),
      showVideo: bool(settings.showVideo, fallback.settings.showVideo),
      ecu: ECU_SCENARIOS.includes(settings.ecu as EcuScenario) ? settings.ecu as EcuScenario : fallback.settings.ecu,
    },
    history: Array.isArray(value.history)
      ? value.history
          .filter((item): item is [number, AttentionState] => Array.isArray(item) && Number.isFinite(item[0]) && STATES.includes(item[1]))
          .slice(-HISTORY_LIMIT)
      : [],
  };
}

export function loadDriverStore(): DriverStore {
  try {
    return decodeDriverStore(localStorage.getItem(DRIVER_STORAGE_KEY));
  } catch {
    return defaultDriverStore();
  }
}

export function saveDriverStore(store: DriverStore): boolean {
  try {
    localStorage.setItem(DRIVER_STORAGE_KEY, JSON.stringify({...store, history: store.history.slice(-HISTORY_LIMIT)}));
    return true;
  } catch {
    return false;
  }
}
