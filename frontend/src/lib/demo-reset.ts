// `?reset=1` on /garage or /driver wipes what rehearsals leave in this browser (driver settings and
// history, the robot's mute, saved sessions and incident ids, the chosen language and data source), so
// the next demo starts from the defaults. Nothing else on the machine is touched.
export const DEMO_STORAGE_PREFIXES = ["car-neuron.", "autolink.vehicle-session.v1."] as const;

export const demoKeys = (keys: readonly string[]) => keys.filter(key => DEMO_STORAGE_PREFIXES.some(prefix => key.startsWith(prefix)));

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
