/** Monotonic milliseconds. Kept out of the React render path so event callbacks can time a turn. */
export function monotonicNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
