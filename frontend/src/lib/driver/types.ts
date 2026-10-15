import type {GuardianBlock, VehicleSnapshot} from "../guardian/types";

// Driver-attention module. Everything here describes structured values only: the camera
// frames are analysed in the browser and never leave it.
export type AttentionState = "attentive" | "distracted" | "drowsy" | "no_face" | "uncertain";
// Seen from the driver's seat: "left" means the driver turned toward their own left.
export type HeadDirection = "forward" | "left" | "right" | "up" | "down";
export type DriverSource = "webcam" | "simulated";

/** One analysed camera frame (or one simulated frame). `t` is epoch milliseconds. */
export type DriverFrame = {
  t: number;
  facePresent: boolean;
  closure: number | null; // mean eye-blink blendshape, 0 open … 1 closed
  yaw: number | null; // degrees, positive = nose toward the image's right
  pitch: number | null; // degrees, positive = looking down
  confidence: number; // heuristic 0…1, not calibrated
};

/** The structured event sent to the backend (JSON, camelCase). */
export type DriverEvent = {
  capturedAt: string; // ISO 8601, UTC
  facePresent: boolean;
  absentMs: number;
  eyes: {closed: boolean; closedMs: number; perclos: number | null; score: number | null};
  head: {direction: HeadDirection | null; yawDeg: number | null; pitchDeg: number | null; awayMs: number};
  state: AttentionState;
  confidence: number;
};

export type DriverSeverity = "normal" | "warning" | "critical";

export type DriverAssessment = {
  severity: DriverSeverity;
  summary: string;
  evidence: string[];
  recommendations: string[];
  confidence: number;
  engine: "agent" | "rules";
  fallbackReason: string | null;
  state: AttentionState;
  at: string;
};

export type DriverBatch = {
  schemaVersion: 1;
  sessionId: string;
  source: DriverSource;
  // With `vehicle` the backend combines car and driver (Vehicle Guardian); `vehicleMoving` then follows the speed.
  // `vehicleId` shares the driver's state with that car's blackbox agent (backend/driver/registry.py).
  context: {vehicleMoving: boolean; vehicleId?: string; vehicle?: VehicleSnapshot; acknowledgedAt?: string; lang?: "vi" | "en"};
  events: DriverEvent[];
};

export type DriverReply = {
  accepted: number;
  sessionId: string;
  state: AttentionState;
  assessment: DriverAssessment;
  privacy: {rawVideoReceived: false};
  guardian?: GuardianBlock;
};
