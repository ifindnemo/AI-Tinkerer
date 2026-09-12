import type {Vehicle} from "../vehicles";
import {BackendVehicleSessionAdapter} from "../backend/session";
import {MockVehicleSessionAdapter} from "./mock-adapter";
import {browserSessionRepository} from "./repository";
import type {SessionRepository, VehicleSessionAdapter} from "./types";

// Backend is default; explicit local mock mode remains available for isolated demos.
export function createVehicleSessionAdapter(vehicle: Vehicle, repository: SessionRepository = browserSessionRepository()): VehicleSessionAdapter {
  return process.env.NEXT_PUBLIC_AGENT_MODE === "mock" ? new MockVehicleSessionAdapter(vehicle,repository) : new BackendVehicleSessionAdapter(vehicle);
}
