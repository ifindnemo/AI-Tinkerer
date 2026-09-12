import type {AgentCycle} from "../periodic-agent/mock";
import type {BlackboxTransfer} from "../blackbox/types";
import type { SafetyIncident, IncidentCommand } from "../safety-agent";
import type { Analysis, ScenarioId, Telemetry } from "../telemetry";
export type SessionSnapshot = {
  backend?: import("../backend/contract").BackendState;
  scenario: ScenarioId; telemetry: Telemetry; samples: Telemetry[];
  result: Analysis | null; history: Analysis[]; incident: SafetyIncident | null;
  blackbox: BlackboxTransfer;
  agentCycle: AgentCycle;
  failNext: boolean; restoring: boolean; recoveryNotice: string; storageError: string;
};
export type StoredSession = {
  version: 1; vehicleId: string; savedAt: string; scenario: ScenarioId;
  tick: number; episodeId: string; telemetry: Telemetry;
  history: Analysis[]; incident: SafetyIncident | null;
};
export interface SessionRepository {
  load(vehicleId: string): StoredSession | null;
  save(session: StoredSession): void;
}
// UI-facing commands exclude tool completions; only an adapter may accept those.
export type DriverCommand = Exclude<IncidentCommand, {type: "TOOL_SUCCESS" | "TOOL_FAILURE"}>;
export interface VehicleSessionAdapter {
  readonly mode: "mock" | "backend";
  getSnapshot(): SessionSnapshot;
  getServerSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): () => void;
  start(): void;
  dispose(): void;
  setScenario(scenario: ScenarioId): void;
  command(command: DriverCommand): void;
  check(): void;
  setFailNext(value: boolean): void;
  dismissRecovery(): void;
}
