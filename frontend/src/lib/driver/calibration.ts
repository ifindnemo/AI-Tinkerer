import type {Baseline} from "./attention";
import type {DriverFrame} from "./types";

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export type CalibrationStatus = {state: "collecting" | "done" | "failed"; progress: number; baseline?: Baseline};

/**
 * "Look straight ahead with your eyes open" for a few seconds. The median head angles become the
 * straight-ahead pose and the median eye score sets the closed threshold for this face and light.
 */
export class Calibrator {
  private startedAt: number | null = null;
  private yaw: number[] = [];
  private pitch: number[] = [];
  private closure: number[] = [];

  constructor(private readonly durationMs = 2500, private readonly minFrames = 15) {}

  add(frame: DriverFrame): CalibrationStatus {
    this.startedAt ??= frame.t;
    const elapsed = frame.t - this.startedAt;
    if (frame.facePresent && frame.yaw !== null && frame.pitch !== null && frame.closure !== null && frame.confidence >= 0.6 && frame.closure < 0.45) {
      this.yaw.push(frame.yaw); this.pitch.push(frame.pitch); this.closure.push(frame.closure);
    }
    const progress = Math.min(1, elapsed / this.durationMs);
    if (elapsed >= this.durationMs && this.yaw.length >= this.minFrames) {
      return {
        state: "done", progress: 1,
        baseline: {yaw: median(this.yaw), pitch: median(this.pitch), eyesOn: median(this.closure) + 0.35},
      };
    }
    if (elapsed >= this.durationMs * 3) return {state: "failed", progress: 1};
    return {state: "collecting", progress};
  }
}
