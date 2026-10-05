import type {Vehicle} from "../vehicles";
import {BackendVehicleSessionAdapter} from "../backend/session";
import type {AgentMode} from "../preferences";
import {MockVehicleSessionAdapter} from "./mock-adapter";
import {browserSessionRepository} from "./repository";
import type {SessionRepository, VehicleSessionAdapter} from "./types";

// Backend is the default; the browser-only mock remains a runtime fallback for offline demos.
// The live OBD mode ("device") has its own SSE store and never comes through here.
export function createVehicleSessionAdapter(vehicle: Vehicle, mode: Exclude<AgentMode, "device"> = "backend", repository: SessionRepository = browserSessionRepository()): VehicleSessionAdapter {
  return mode === "mock" ? new MockVehicleSessionAdapter(vehicle,repository) : new BackendVehicleSessionAdapter(vehicle);
}
