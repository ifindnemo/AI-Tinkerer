import type {Telemetry} from "../telemetry";
import type {DeviceAnalysis, DeviceSample, DeviceSnapshot, DeviceState, DeviceTrip, DtcStatus, DeviceProfile, SignalName, StreamStatus} from "./types";

// Pure state transitions for the live OBD dashboard (unit-tested; no DOM, no timers).
export const SHOWN_SAMPLES = 60;
export const STALE_AFTER_MS = 20_000;
const MAX_QUEUE = 30;

export const initialDeviceState = (): DeviceState => ({
  status: "connecting", received: false, profile: null, trip: null, samples: [], queue: [],
  dtc: null, analysis: null, analyses: [], lastDataAt: null,
});

const byTime = (a: DeviceSample, b: DeviceSample) => a.capturedAt.localeCompare(b.capturedAt);

/** A snapshot (also re-sent on every reconnect) replaces the whole state. */
export function applySnapshot(state: DeviceState, snapshot: DeviceSnapshot, now: number): DeviceState {
  return {
    ...state,
    status: "live",
    received: true,
    profile: snapshot.profile,
    trip: snapshot.trip,
    samples: [...snapshot.samples].sort(byTime).slice(-SHOWN_SAMPLES),
    queue: [],
    dtc: snapshot.dtc,
    analysis: snapshot.analysis,
    analyses: snapshot.analyses,
    lastDataAt: snapshot.samples.length ? now : state.lastDataAt,
  };
}

/** New samples wait in a queue and are shown one per second, so a 5-sample batch plays out smoothly. */
export function receiveSamples(state: DeviceState, tripId: string, samples: DeviceSample[], now: number): DeviceState {
  // A new trip starts a fresh chart.
  const sameTrip = !state.trip || state.trip.id === tripId;
  const known = new Set([...(sameTrip ? state.samples : []), ...state.queue].map(sample => sample.capturedAt));
  const fresh = samples.filter(sample => !known.has(sample.capturedAt)).sort(byTime);
  const queue = [...(sameTrip ? state.queue : []), ...fresh];
  // Never fall far behind live data: drop the oldest queued samples into the chart at once.
  const overflow = Math.max(0, queue.length - MAX_QUEUE);
  return {
    ...state,
    samples: [...(sameTrip ? state.samples : []), ...queue.slice(0, overflow)].slice(-SHOWN_SAMPLES),
    queue: queue.slice(overflow),
    lastDataAt: fresh.length ? now : state.lastDataAt,
  };
}

export function playNext(state: DeviceState): DeviceState {
  if (!state.queue.length) return state;
  const [next, ...rest] = state.queue;
  return {...state, samples: [...state.samples, next].slice(-SHOWN_SAMPLES), queue: rest};
}

export const receiveProfile = (state: DeviceState, profile: DeviceProfile): DeviceState => ({...state, profile});
export const receiveTrip = (state: DeviceState, trip: DeviceTrip | null): DeviceState => ({...state, trip});
export const receiveDtc = (state: DeviceState, dtc: DtcStatus): DeviceState => ({...state, dtc});
export function receiveAnalysis(state: DeviceState, analysis: DeviceAnalysis): DeviceState {
  if (state.analyses.some(item => item.id === analysis.id)) return state;
  const analyses = [analysis, ...state.analyses].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
  return {...state, analysis: analyses[0], analyses};
}
export const setStatus = (state: DeviceState, status: StreamStatus): DeviceState =>
  state.status === status ? state : {...state, status};

export const isConnected = (state: DeviceState, now: number) =>
  state.status === "live" && state.lastDataAt !== null && now - state.lastDataAt <= STALE_AFTER_MS;

export const latestSample = (state: DeviceState): DeviceSample | null => state.samples.at(-1) ?? null;

/**
 * Newest value of every signal within the last minute of sample time. Slow PIDs (oil every
 * 5 s, fuel and ambient every 30 s) are missing from most samples and must not flicker to "—".
 */
export function latestValues(samples: DeviceSample[], windowMs = 60_000): Partial<Record<SignalName, number>> {
  const values: Partial<Record<SignalName, number>> = {};
  const last = samples.at(-1);
  if (!last) return values;
  const end = Date.parse(last.capturedAt);
  for (let i = samples.length - 1; i >= 0 && end - Date.parse(samples[i].capturedAt) <= windowMs; i--) {
    for (const [name, value] of Object.entries(samples[i].signals) as [SignalName, number][]) {
      if (!(name in values)) values[name] = value;
    }
  }
  return values;
}

/** Least-squares slope of coolant over the last 60 s of sample time, in °C per minute. */
export function coolantTrend(samples: DeviceSample[]): number | null {
  const last = samples.at(-1);
  if (!last) return null;
  const end = Date.parse(last.capturedAt);
  const points = samples
    .filter(sample => sample.signals.coolant !== undefined && end - Date.parse(sample.capturedAt) <= 60_000)
    .map(sample => [(Date.parse(sample.capturedAt) - end) / 60_000, sample.signals.coolant!] as const);
  if (points.length < 3) return null;
  const meanX = points.reduce((sum, [x]) => sum + x, 0) / points.length;
  const meanY = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
  const spread = points.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0);
  if (spread === 0) return 0;
  return Math.round(points.reduce((sum, [x, y]) => sum + (x - meanX) * (y - meanY), 0) / spread * 10) / 10;
}

/**
 * The classic `Telemetry` shape for the 3D viewer. Signals the car does not report stay
 * NaN (shown as "—"), never a plausible default: in particular the fan, which OBD lacks.
 */
export function toTelemetry(state: DeviceState, vehicleId: string, connected: boolean): Telemetry {
  const sample = latestSample(state);
  const s = latestValues(state.samples);
  const value = (name: keyof typeof s) => s[name] ?? Number.NaN;
  const location = sample?.location ?? [...state.samples].reverse().find(item => item.location)?.location;
  return {
    scenario: "normal",
    vehicleId,
    powertrain: "ice",
    capturedAt: sample?.capturedAt ?? "",
    coolant: value("coolant"),
    oil: value("oil"),
    ambient: value("ambient"),
    intake: value("intake"),
    rpm: value("rpm"),
    speed: s.speed ?? 0,
    battery: value("battery"),
    fuel: value("fuel"),
    coolantTrend: coolantTrend(state.samples) ?? 0,
    fan: Number.NaN,
    map: s.map,
    tps: s.tps,
    engineLoad: s.engineLoad,
    dtc: (state.dtc?.codes ?? []).filter(code => code.kind === "stored").map(code => code.code),
    location: {name: location?.fixed ? "Vị trí cố định" : location ? "GPS" : "—", lat: location?.lat ?? Number.NaN, lon: location?.lon ?? Number.NaN},
    connected,
  };
}
