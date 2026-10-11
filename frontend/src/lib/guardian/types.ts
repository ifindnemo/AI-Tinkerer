// Vehicle Guardian: the car (ECU) and the driver (camera) in one decision. Shapes match the
// `guardian` block of POST /api/driver/events (backend/driver/guardian.py).
import type {AttentionState, DriverSeverity} from "../driver/types";

export type VehicleSnapshot = {
  source: "simulated";
  capturedAt: string;
  speedKmh: number;
  coolantC: number;
  engineLoadPct: number | null;
  drivingMinutes: number | null;
};

export type Attention = "attentive" | "low_attention" | "unknown";
export type GuardianAction = "continue" | "reduce_load" | "refocus" | "stop_nearest_safe" | "stay_parked" | "check_camera" | "stop_engine";

export type GuardianDecision = {
  severity: DriverSeverity;
  action: GuardianAction;
  mustStop: boolean;
  attention: Attention;
  vehicleLevel: DriverSeverity;
  driverSeverity: DriverSeverity;
};

export type MaintenanceSummary = {
  vehicleId: string;
  simulated: true;
  records: number;
  coolingRecords: number;
  last: {date: string | null; label: string | null; status: string | null} | null;
};

export type GuardianBlock = {
  vehicle: VehicleSnapshot & {level: DriverSeverity; warnC: number; criticalC: number; moving: boolean};
  driver: {
    attention: Attention;
    state: AttentionState;
    severity: DriverSeverity;
    closedMs: number;
    responded: boolean;
    unanswered: boolean;
    alertSince: string | null;
  };
  action: GuardianAction;
  mustStop: boolean;
  maintenance: MaintenanceSummary | null;
};
