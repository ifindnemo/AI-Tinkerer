// How often the page asks the backend for new voice clips. A clip is usually ready a couple of seconds after the
// batch or the camera alert that caused it, so right after one the page asks faster; otherwise it stays calm.
import type {DriverSeverity} from "../driver/types";
import type {Presence} from "./presence";

export const POLL_IDLE_MS = 1000;
export const POLL_LIVE_MS = 400; // a conversation turn is waiting for its own clip
export const POLL_HURRY_MS = 400; // an alert was just raised: its clip is on the way
export const POLL_HIDDEN_MS = 4000;
export const HURRY_FOR_MS = 10_000;

const RANK: Record<DriverSeverity, number> = {normal: 0, warning: 1, critical: 2};
const level = (p: Presence): number => Math.max(RANK[p.agent?.severity ?? "normal"], RANK[p.camera?.severity ?? "normal"]);

/** Whether a change of what the agent knows means a clip is probably about to be ready. */
export function hurryTrigger(before: Presence, after: Presence): boolean {
  if (before.agent?.phase !== "analyzing" && after.agent?.phase === "analyzing") return true;
  if (level(after) > level(before)) return true;
  return !!after.message && after.message.id !== before.message?.id && after.message.severity !== "normal";
}

/** The wait before the next poll. A hidden tab always waits longest. */
export function clipPollDelay(input: {hidden: boolean; live: boolean; hurryUntil: number; now: number}): number {
  if (input.hidden) return POLL_HIDDEN_MS;
  if (input.live) return POLL_LIVE_MS;
  return input.now < input.hurryUntil ? POLL_HURRY_MS : POLL_IDLE_MS;
}
