// Scripted driver behaviour for demos without a camera. It produces the same frames as the
// webcam path, so the tracker, backend and UI are exercised for real; it is always labelled.
import type {CameraSample} from "./camera";

export type SimulationScenario = "attentive" | "drowsy" | "distracted" | "no_face";
export const SIMULATION_SCENARIOS: SimulationScenario[] = ["attentive", "drowsy", "distracted", "no_face"];

const smooth = (edge0: number, edge1: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return k * k * (3 - 2 * k);
};
/** 0 → 1 → 0 between `start` and `end`, with `ramp` ms easing at each side. */
const window01 = (x: number, start: number, end: number, ramp: number) => smooth(start, start + ramp, x) * (1 - smooth(end - ramp, end, x));
const blink = (x: number, every: number, length = 160) => (x % every < length ? 1 : 0);

export function simulatedSample(scenario: SimulationScenario, elapsedMs: number, t: number): CameraSample {
  if (scenario === "no_face") {
    return {frame: {t, facePresent: false, closure: null, yaw: null, pitch: null, confidence: 0}, box: null};
  }
  let closure = 0.1 + 0.75 * blink(elapsedMs, 3800);
  let yaw = 4 * Math.sin(elapsedMs / 1700);
  let pitch = 2 * Math.sin(elapsedMs / 2300);
  if (scenario === "drowsy") {
    // Every 9 s: heavy, slow blinks, then the eyes stay shut for about 3 s and the head nods.
    const x = elapsedMs % 9000;
    const shut = window01(x, 2500, 5700, 250);
    closure = Math.max(0.22 + 0.6 * blink(x, 2200, 320), 0.22 + 0.7 * shut);
    pitch += 9 * shut;
  } else if (scenario === "distracted") {
    // Every 10 s: looks to the side for 5 s (e.g. a phone on the passenger seat).
    const x = elapsedMs % 10_000;
    yaw += 40 * window01(x, 2000, 7000, 400);
    pitch += 6 * window01(x, 2000, 7000, 400);
  }
  const shift = yaw / 400;
  return {
    frame: {t, facePresent: true, closure: Math.min(1, closure), yaw, pitch, confidence: 0.92},
    box: {x: 0.34 - shift, y: 0.2 + pitch / 600, w: 0.32, h: 0.44},
  };
}
