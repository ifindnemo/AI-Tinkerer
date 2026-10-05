import type {AgentReply, Severity} from "../backend/contract";

// Payloads of GET /api/vehicles/{id}/stream (backend/telemetry/stream.py, queries.py).
export type SignalName =
  | "rpm" | "speed" | "engineLoad" | "coolant" | "intake" | "map" | "maf" | "tps"
  | "stft1" | "ltft1" | "battery" | "oil" | "fuel" | "ambient";

export type DeviceSample = {
  capturedAt: string;
  signals: Partial<Record<SignalName, number>>;
  location?: {lat: number; lon: number; fixed?: boolean};
};

export type DeviceProfile = {
  vehicle_id: string;
  known: boolean;
  vin: string | null;
  make: string | null;
  model_year_guess: number | null;
  display_name: string | null;
  protocol: string | null;
  supported_pids: string[];
  supported_signals: SignalName[];
  missing_signals: SignalName[];
  devices: {id: string; label: string; last_seen_at: string | null}[];
  updated_at: string | null;
};

export type DeviceTrip = {
  id: string;
  vehicle_id: string;
  source: string;
  simulated: boolean;
  started_at: string;
  ended_at: string;
  status: string;
  sample_count: number;
  distance_km: number;
  max_coolant: number | null;
  event_count: number;
  mil: boolean;
};

export type DtcInfo = {
  code: string;
  known: boolean;
  system: string | null;
  urgency: "critical" | "warning" | "info";
  urgency_label: string;
  title: string;
  meaning: string;
  causes: string[];
  checks: string[];
  advice: string;
};

export type DtcCode = {
  code: string;
  kind: "stored" | "pending";
  first_seen_at: string;
  last_seen_at: string;
  freeze_frame: Partial<Record<SignalName, number>> | null;
  info: DtcInfo;
};

export type DtcStatus = {
  trip_id: string | null;
  read_at: string | null;
  mil: boolean;
  codes: DtcCode[];
  earlier: DtcCode[];
};

export type Finding = {rule: string; message: string; floor: Severity | null};

export type DeviceAnalysis = {
  id: string;
  vehicle_id: string;
  trip_id: string;
  at: string;
  trigger: string;
  engine: "agent" | "rules";
  fallback_reason: string | null;
  model_severity: Severity | null;
  severity: Severity;
  findings: Finding[];
  record_count: number;
  simulated: boolean;
  created_at: string;
  reply: AgentReply;
};

export type DeviceSnapshot = {
  vehicle_id: string;
  profile: DeviceProfile;
  trip: DeviceTrip | null;
  samples: DeviceSample[];
  dtc: DtcStatus;
  analysis: DeviceAnalysis | null;
  analyses: DeviceAnalysis[];
};

export type StreamStatus = "connecting" | "live" | "reconnecting";

export type DeviceState = {
  status: StreamStatus;
  received: boolean; // a snapshot has arrived
  profile: DeviceProfile | null;
  trip: DeviceTrip | null;
  samples: DeviceSample[]; // shown on screen, oldest first
  queue: DeviceSample[]; // received, waiting to be played out at 1 Hz
  dtc: DtcStatus | null;
  analysis: DeviceAnalysis | null;
  analyses: DeviceAnalysis[];
  lastDataAt: number | null; // browser time of the last sample event
};
