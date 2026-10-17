"use client";
import {useEffect, useSyncExternalStore} from "react";
import {bookingStore} from "@/lib/agent/booking-store";
import {presence, type AgentPhase} from "@/lib/agent/presence";
import type {AgentReply} from "@/lib/backend/contract";
import type {DriverSeverity} from "@/lib/driver/types";
import {firstSentences, reportFrom, withBookingChoices} from "@/lib/agent/report";

export {firstSentences};

/** The garage pages tell the agent dock what the car agent is doing, and put each new car alert
 * (one per analysis id) into its bubble. `null` (Mock mode) clears it. */
export function useAgentPresence(agent: {phase: AgentPhase; severity: DriverSeverity; analysisId: string | null; diagnosis: string | null; reply?: AgentReply | null} | null) {
  const phase = agent?.phase ?? null;
  const severity = agent?.severity ?? "normal";
  useEffect(() => {
    presence.set({agent: phase ? {phase, severity} : null});
  }, [phase, severity]);
  useEffect(() => () => presence.reset(), []);

  // The popup: the tools the agent called, the nearest garage and what needs the driver's confirmation.
  const reply = agent?.reply ?? null;
  const reportId = agent?.analysisId ?? null;
  // "Not now" closes the question everywhere (the popup does not wait for it again); a confirmation shows the appointment.
  const choices = useSyncExternalStore(bookingStore.subscribe, bookingStore.get, bookingStore.get);
  useEffect(() => {
    const report = reply && reportId ? reportFrom(reply, reportId) : null;
    presence.set({report: report ? withBookingChoices(report, choices) : null});
  }, [reply, reportId, choices]);

  const id = agent?.analysisId ?? null;
  const text = agent?.diagnosis ?? null;
  useEffect(() => {
    if (id && text && severity !== "normal") presence.say({id: `car:${id}`, text: firstSentences(text), severity});
    // A new analysis id is a new message; later renders of the same analysis are not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
}
