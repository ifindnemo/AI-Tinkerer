// What the car agent just did, in the shape the robot's popup shows: the tools it called, the nearest garage
// it found and the appointment it proposes (which only the driver can confirm). Pure, so it is unit-tested.
import type {AgentPlan, AgentReply, Appointment, GarageOption, PendingBooking, Severity} from "../backend/contract";
import {toolSteps, type ToolStep} from "../backend/tool-insights";

export type AgentReport = {
  /** The analysis it comes from. */
  id: string;
  severity: Severity;
  /** The first sentences of the diagnosis. */
  lead: string;
  /** The tools the agent called, in order (the hard rule and the verdict are left out: the popup says the verdict itself). */
  steps: ToolStep[];
  /** The nearest garage the search found, if any (listed by distance). */
  garage: GarageOption | null;
  garageCount: number;
  /** An appointment waiting for the driver's confirmation. */
  pending: PendingBooking | null;
  /** The appointment that was confirmed and saved. */
  appointment: Appointment | null;
  /** Stop first: a critical alert (or a drowsy driver) comes before any garage trip. */
  stopFirst: boolean;
  /** What to do now, from the car and the driver together; null from an older backend. */
  plan: AgentPlan | null;
};

/** The lead of a long diagnosis; the full text stays in the agent panel. */
export function firstSentences(text: string, limit = 240) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  let out = "";
  for (const sentence of clean.split(/(?<=[.!?])\s+/)) {
    if (out && out.length + sentence.length + 1 > limit) break;
    out = out ? `${out} ${sentence}` : sentence;
  }
  return out.length > limit ? `${out.slice(0, limit - 1).trimEnd()}…` : out;
}

/** The popup for this reply, or null when there is nothing to show (a normal result with no tool worth a line). */
export function reportFrom(reply: AgentReply, id: string): AgentReport | null {
  const severity = reply.assessment.severity;
  const steps = toolSteps(reply).filter(step => step.kind !== "guardrail" && step.kind !== "verdict");
  const options = reply.tool_trace.find(item => item.tool === "search_nearby_garages")?.result.options ?? [];
  const nearest = [...options].filter(option => typeof option?.distance_km === "number").sort((a, b) => a.distance_km - b.distance_km)[0] ?? null;
  const pending = reply.pending_action?.status === "pending_confirmation" ? reply.pending_action : null;
  const appointment = reply.appointment ?? null;
  if (severity === "normal" && !pending && !appointment) return null;
  return {id, severity, lead: firstSentences(reply.assessment.diagnosis), steps, garage: nearest, garageCount: options.length, pending, appointment, stopFirst: severity === "critical" || reply.plan?.code === "rest_then_decide", plan: reply.plan ?? null};
}

/** What the driver has to do: confirm the proposed appointment. */
export const needsConfirmation = (report: AgentReport | null) => !!report?.pending;

/** One key per thing the viewer can dismiss: the pending appointment (so a new analysis of the same proposal
 * does not reopen it every 15 seconds), otherwise the analysis. */
export const reportKey = (report: AgentReport) => report.pending?.id ?? report.appointment?.id ?? report.id;
