// `?reset=1` on /garage or /driver wipes what rehearsals leave in this browser (driver settings and
// history, the robot's mute, saved sessions and incident ids, the data source), so the next demo starts
// clean. The presenter's own choices stay: the interface and agent language and how the voice sounds
// (a reset must not switch an English demo back to Vietnamese). Nothing else on the machine is touched.
export const DEMO_STORAGE_PREFIXES = ["car-neuron.", "autolink.vehicle-session.v1."] as const;
export const KEPT_PREFERENCES = ["car-neuron.lang", "car-neuron.agent-lang", "car-neuron.voice-volume", "car-neuron.voice-rate", "car-neuron.driver-voice"] as const;

export const demoKeys = (keys: readonly string[]) =>
  keys.filter(key => DEMO_STORAGE_PREFIXES.some(prefix => key.startsWith(prefix)) && !(KEPT_PREFERENCES as readonly string[]).includes(key));

/** Removes the demo's keys and returns them. Never throws (storage may be blocked). */
export function clearDemoState(storage: Pick<Storage, "length" | "key" | "removeItem">): string[] {
  try {
    const keys = Array.from({length: storage.length}, (_, index) => storage.key(index)).filter((key): key is string => key !== null);
    const mine = demoKeys(keys);
    mine.forEach(key => storage.removeItem(key));
    return mine;
  } catch {
    return [];
  }
}

/** The same address without the `reset` parameter, so a reload does not reset again. */
export function withoutReset(search: string, pathname: string, hash = ""): string {
  const params = new URLSearchParams(search);
  params.delete("reset");
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}${hash}`;
}

export const BACKEND_RESET_PATH = "/api/vehicle/demo/reset";

/**
 * Asks the backend to forget the last run, so the first batch of this one does not inherit it. Scope "demo" (the
 * page opened with reset=1) clears everything: newest assessment, camera summary, open incident, spoken-alert history
 * and transcripts. Scope "car" (the scenario was switched) clears only what describes the car, because the camera and
 * the conversation go on. Waits at most `timeoutMs`; never throws, and a backend that is down or slow leaves the
 * browser to go ahead. Returns whether it was cleared.
 */
export async function resetBackendState(
  request: (url: string, init: {method: string; headers: Record<string, string>; body: string; signal: AbortSignal}) => Promise<{ok: boolean}>,
  timeoutMs = 2000,
  scope: "demo" | "car" = "demo",
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await request(BACKEND_RESET_PATH, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({scope}),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
