import {applySnapshot, initialDeviceState, playNext, receiveAnalysis, receiveDtc, receiveProfile, receiveSamples, receiveTrip, setStatus} from "./state";
import type {DeviceAnalysis, DeviceProfile, DeviceSample, DeviceSnapshot, DeviceState, DeviceTrip, DtcStatus} from "./types";

const SERVER_STATE = initialDeviceState();

/** One EventSource per dashboard. EventSource reconnects by itself; each reconnect sends a fresh snapshot. */
export class DeviceStream {
  private state: DeviceState = initialDeviceState();
  private listeners = new Set<() => void>();
  private source: EventSource | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private active = false;

  constructor(private readonly vehicleId: string) {}

  getSnapshot = () => this.state;
  getServerSnapshot = () => SERVER_STATE;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {this.listeners.delete(listener);};
  };

  private set(next: DeviceState) {
    if (next === this.state) return;
    this.state = next;
    this.listeners.forEach(listener => listener());
  }

  private on<T>(event: string, apply: (state: DeviceState, data: T) => DeviceState) {
    this.source?.addEventListener(event, message => {
      try {this.set(apply(this.state, JSON.parse((message as MessageEvent<string>).data) as T));}
      catch {/* a malformed event is skipped; the next snapshot repairs the state */}
    });
  }

  start = () => {
    this.active = true;
    this.connect();
    if (!this.timer) this.timer = setInterval(() => this.set(playNext(this.state)), 1000);
  };

  private connect() {
    if (this.source || !this.active) return;
    this.source = new EventSource(`/api/vehicle/stream/${encodeURIComponent(this.vehicleId)}`);
    this.source.onopen = () => this.set(setStatus(this.state, "live"));
    this.source.onerror = () => {
      this.set(setStatus(this.state, "reconnecting"));
      // EventSource retries network drops itself, but gives up for good after an HTTP error
      // (e.g. 502 while the backend restarts); reopen it ourselves.
      if (this.source?.readyState === EventSource.CLOSED) {
        this.source.close();
        this.source = null;
        this.retry = setTimeout(() => {this.retry = null; this.connect();}, 3000);
      }
    };
    this.on<DeviceSnapshot>("snapshot", (state, data) => applySnapshot(state, data, Date.now()));
    this.on<{trip_id: string; samples: DeviceSample[]}>("samples", (state, data) => receiveSamples(state, data.trip_id, data.samples, Date.now()));
    this.on<DeviceProfile>("profile", receiveProfile);
    this.on<DeviceTrip | null>("trip", receiveTrip);
    this.on<DtcStatus>("dtc", receiveDtc);
    this.on<DeviceAnalysis>("analysis", receiveAnalysis);
  }

  dispose = () => {
    this.active = false;
    this.source?.close();
    this.source = null;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  };
}
