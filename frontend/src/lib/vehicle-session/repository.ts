import type { StoredSession, SessionRepository } from "./types";

export const sessionKey = (vehicleId: string) => `autolink.vehicle-session.v1.${vehicleId}`;
type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 4000;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const iso = (v: unknown) => text(v) && Number.isFinite(Date.parse(v));
const member = (v: unknown, values: string[]) => typeof v === "string" && values.includes(v);
const strings = (v: unknown) => Array.isArray(v) && v.length <= 30 && v.every(text);
const scenarios = ["normal", "environment", "engine", "offline"];
function telemetry(v: unknown, vehicleId: string): boolean {
  if (!object(v) || v.vehicleId !== vehicleId || !member(v.scenario, scenarios) || !member(v.powertrain,["ice","ev","hybrid"]) || typeof v.connected !== "boolean" || !(v.capturedAt === "" || iso(v.capturedAt))) return false;
  if (!["coolant","oil","ambient","intake","rpm","speed","battery","fuel","coolantTrend","fan"].every(key => finite(v[key]))) return false;
  if (!["map","tps","engineLoad","consumption"].every(key => v[key] === undefined || finite(v[key]))) return false;
  if (v.operatingSource !== undefined && !member(v.operatingSource,["excel-range","scenario"])) return false;
  if (v.fault !== undefined && ![0,1,2,3].includes(v.fault as number)) return false;
  if (!strings(v.dtc) || !object(v.location) || !text(v.location.name) || !finite(v.location.lat) || !finite(v.location.lon) || Math.abs(v.location.lat)>90 || Math.abs(v.location.lon)>180) return false;
  return v.traction === undefined || (object(v.traction) && ["batteryTemp","motorTemp","soc","soh","batteryTrend"].every(key => finite((v.traction as Obj)[key])));
}
function report(v: unknown, vehicleId: string): boolean {
  return object(v) && v.vehicleId === vehicleId && ["id","vehicleName","title","summary"].every(key => text(v[key])) && iso(v.createdAt)
    && member(v.powertrain,["ice","ev","hybrid"]) && member(v.severity,["good","watch","critical"])
    && member(v.cause,["normal","environment","engine","traction","unclassified"]) && finite(v.score) && v.score >= 0 && v.score <= 100 && strings(v.evidence) && strings(v.recommendations);
}
function incident(v: unknown, vehicleId: string): boolean {
  if (!object(v) || v.vehicleId !== vehicleId || !text(v.id) || !text(v.vehicleName) || !member(v.status,["MONITORING","WARNING","WAITING_CONFIRMATION","ACTION_IN_PROGRESS","CRITICAL","STABILIZING","RESOLVED"]) || !member(v.severity,["LOW","HIGH","CRITICAL"]) || !member(v.phase,["moving","slowing","stopped","cooling"])) return false;
  if (!Number.isSafeInteger(v.phaseTick) || (v.phaseTick as number) < 0 || !["driverAcknowledged","navigationDone","rescueDone"].every(key => typeof v[key] === "boolean")) return false;
  if (v.packet !== null && !telemetry(v.packet,vehicleId)) return false;
  if (!Array.isArray(v.timeline) || v.timeline.length > 30 || !v.timeline.every(item => object(item) && text(item.id) && iso(item.at) && text(item.message))) return false;
  if (new Set(v.timeline.map(item => (item as Obj).id)).size !== v.timeline.length) return false;
  if (v.action === null) return !v.rescueDone;
  const a=v.action;
  if (!object(a) || !text(a.id) || !member(a.kind,["NAVIGATE_SAFE_STOP","CREATE_RESCUE_REQUEST"]) || !member(a.status,["proposed","pending","succeeded","declined","failed"]) || !object(a.payload)) return false;
  const p=a.payload;
  if (p.vehicleId !== vehicleId || p.incidentId !== v.id || !text(p.vehicleName) || !iso(p.capturedAt) || !finite(p.latitude) || !finite(p.longitude) || Math.abs(p.latitude)>90 || Math.abs(p.longitude)>180 || !finite(p.coolant) || !finite(p.speed) || !strings(p.dtc)) return false;
  if (a.error !== undefined && !text(a.error)) return false;
  if (a.result !== undefined && (!object(a.result) || !text(a.result.requestId) || !text(a.result.message))) return false;
  if (a.status === "succeeded" && !object(a.result)) return false;
  if (v.rescueDone && !(a.kind === "CREATE_RESCUE_REQUEST" && a.status === "succeeded")) return false;
  return true;
}
export function decodeSession(raw: string | null, vehicleId: string): StoredSession | null {
  if (raw === null) return null;
  if (raw.length > 300_000) throw new Error("Saved session is too large.");
  const s: unknown = JSON.parse(raw);
  if (!object(s) || s.version !== 1 || s.vehicleId !== vehicleId || !iso(s.savedAt) || !member(s.scenario,scenarios) || !Number.isSafeInteger(s.tick) || (s.tick as number)<0 || !text(s.episodeId) || !telemetry(s.telemetry,vehicleId) || !Array.isArray(s.history) || s.history.length>20 || !s.history.every(item=>report(item,vehicleId)) || (s.incident !== null && !incident(s.incident,vehicleId))) throw new Error("Saved session schema or vehicle identity is invalid.");
  if (s.incident !== null && (!member(s.scenario,["engine","offline"]) || (s.incident as Obj).id !== s.episodeId)) throw new Error("Saved incident scope is invalid.");
  return s as StoredSession;
}
export function browserSessionRepository(): SessionRepository {
  // Access storage only when called by start(), never in server rendering.
  return {
    load: vehicleId => decodeSession(localStorage.getItem(sessionKey(vehicleId)),vehicleId),
    save: session => {localStorage.setItem(sessionKey(session.vehicleId),JSON.stringify(session));},
  };
}
