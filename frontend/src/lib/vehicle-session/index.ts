import type {Vehicle} from "../vehicles";
import {MockVehicleSessionAdapter} from "./mock-adapter";
import {browserSessionRepository} from "./repository";
import type {SessionRepository, VehicleSessionAdapter} from "./types";

// One composition point. A future backend adapter implements the same contract;
// do not add pretend API routes or expose an unavailable backend option in the UI.
export function createVehicleSessionAdapter(vehicle: Vehicle, repository: SessionRepository = browserSessionRepository()): VehicleSessionAdapter {
  return new MockVehicleSessionAdapter(vehicle,repository);
}
