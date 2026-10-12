"use client";
import {useEffect} from "react";
import {presence, type AgentPhase} from "@/lib/agent/presence";
import type {DriverSeverity} from "@/lib/driver/types";

/** The garage pages tell the agent dock what the car agent is doing, and put each new car alert
 * (one per analysis id) into its bubble. `null` (Mock mode) clears it. */
export function useAgentPresence(agent: {phase: AgentPhase; severity: DriverSeverity; analysisId: string | null; diagnosis: string | null} | null) {
  const phase = agent?.phase ?? null;
  const severity = agent?.severity ?? "normal";
  useEffect(() => {
    presence.set({agent: phase ? {phase, severity} : null});
  }, [phase, severity]);
  useEffect(() => () => presence.reset(), []);

  const id = agent?.analysisId ?? null;
  const text = agent?.diagnosis ?? null;
  useEffect(() => {
    if (id && text && severity !== "normal") presence.say({id: `car:${id}`, text: firstSentences(text), severity});
    // A new analysis id is a new message; later renders of the same analysis are not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
}

/** The bubble keeps the lead of a long diagnosis; the full text stays in the agent panel. */
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
