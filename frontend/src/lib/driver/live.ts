import type {CameraSample} from "./camera";
import type {DriverEvent} from "./types";

/** The newest analysed frame, for visuals that animate at frame rate outside React state. */
export type LiveFrame = {sample: CameraSample; event: DriverEvent | null; calibrating: boolean; video: boolean};

export class LiveChannel {
  private value: LiveFrame | null = null;
  private listeners = new Set<(frame: LiveFrame | null) => void>();

  push(frame: LiveFrame | null) {
    this.value = frame;
    this.listeners.forEach(listener => listener(frame));
  }

  get() {
    return this.value;
  }

  subscribe(listener: (frame: LiveFrame | null) => void) {
    this.listeners.add(listener);
    return () => {this.listeners.delete(listener);};
  }
}

/** Moves `current` a fraction of the way to `target` each animation frame (frame-rate aware). */
export const approach = (current: number, target: number, dtMs: number, halfLifeMs = 70) =>
  target + (current - target) * Math.pow(0.5, dtMs / halfLifeMs);
