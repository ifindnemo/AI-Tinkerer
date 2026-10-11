import type {AttentionState, DriverAssessment, DriverBatch, DriverReply} from "./types";

const STATES: AttentionState[] = ["attentive", "distracted", "drowsy", "no_face", "uncertain"];
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");

function isAssessment(value: unknown): value is DriverAssessment {
  const a = value as DriverAssessment;
  return !!a && ["normal", "warning", "critical"].includes(a.severity) && typeof a.summary === "string"
    && strings(a.evidence) && strings(a.recommendations) && typeof a.confidence === "number"
    && (a.engine === "agent" || a.engine === "rules") && STATES.includes(a.state) && typeof a.at === "string";
}

const LEVELS = ["normal", "warning", "critical"];

function isGuardian(value: unknown): boolean {
  const g = value as DriverReply["guardian"];
  return !!g && typeof g.vehicle?.speedKmh === "number" && typeof g.vehicle.coolantC === "number" && LEVELS.includes(g.vehicle.level)
    && ["attentive", "low_attention", "unknown"].includes(g.driver?.attention) && LEVELS.includes(g.driver.severity)
    && typeof g.driver.responded === "boolean" && typeof g.action === "string" && typeof g.mustStop === "boolean";
}

export function isDriverReply(value: unknown): value is DriverReply {
  const reply = value as DriverReply;
  return !!reply && typeof reply.accepted === "number" && typeof reply.sessionId === "string"
    && STATES.includes(reply.state) && isAssessment(reply.assessment) && reply.privacy?.rawVideoReceived === false
    && (reply.guardian === undefined || isGuardian(reply.guardian));
}

/** Sends structured events only (the batch type has no field that could carry an image). */
export async function postDriverEvents(batch: DriverBatch, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<DriverReply> {
  const response = await fetchImpl("/api/driver/events", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(batch),
    cache: "no-store",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (data as {error?: unknown} | null)?.error;
    throw new Error(typeof message === "string" ? message : `HTTP ${response.status}`);
  }
  if (!isDriverReply(data) || data.sessionId !== batch.sessionId || data.accepted !== batch.events.length) throw new Error("invalid reply");
  return data;
}
