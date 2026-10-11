import {clamp01} from "./features";
import type {AttentionState, DriverEvent, DriverFrame, HeadDirection} from "./types";

export type TrackerConfig = {
  eyesOn: number; // eye score at/above which the eyes count as closed
  eyesOff: number; // eye score below which they count as open again (hysteresis)
  reopenToleranceMs: number; // a blink shorter than this does not break a closure
  drowsyClosedMs: number; // continuous closure that means microsleep
  perclosWindowMs: number;
  perclosMinMs: number; // observed time needed before PERCLOS is reported
  perclosDrowsy: number; // share of time with closed eyes that means drowsiness
  yawAway: number;
  yawBack: number;
  pitchAway: number;
  pitchBack: number;
  awayMs: number; // continuous time not looking ahead that means distraction
  awayToleranceMs: number; // a glance back shorter than this does not reset the timer
  noFaceMs: number;
  minConfidence: number;
  maxFrameGapMs: number; // longer gaps between frames are not credited to PERCLOS
};

// Starting values from common drowsiness practice (PERCLOS ≈ 0.15–0.2, microsleep ≈ 1.5 s).
// They are not validated for a particular car or driver: calibrate and tune on the real camera.
export const DEFAULT_CONFIG: TrackerConfig = {
  eyesOn: 0.55, eyesOff: 0.4, reopenToleranceMs: 150, drowsyClosedMs: 1500,
  perclosWindowMs: 30_000, perclosMinMs: 15_000, perclosDrowsy: 0.2,
  yawAway: 25, yawBack: 18, pitchAway: 20, pitchBack: 14,
  awayMs: 2000, awayToleranceMs: 300, noFaceMs: 2000, minConfidence: 0.5, maxFrameGapMs: 500,
};

export type Baseline = {yaw: number; pitch: number; eyesOn?: number};

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Turns a stream of frames into structured attention events. Time comes only from `frame.t`. */
export class AttentionTracker {
  private readonly cfg: TrackerConfig;
  private base: Baseline = {yaw: 0, pitch: 0};
  private closed = false;
  private closedSince: number | null = null;
  private reopenSince: number | null = null;
  private direction: HeadDirection = "forward";
  private awaySince: number | null = null;
  private backSince: number | null = null;
  private absentSince: number | null = null;
  private lastT: number | null = null;
  private samples: {t: number; dt: number; closed: boolean}[] = [];

  constructor(config: Partial<TrackerConfig> = {}) {
    this.cfg = {...DEFAULT_CONFIG, ...config};
  }

  setBaseline(baseline: Baseline) {
    this.base = baseline;
    if (baseline.eyesOn !== undefined) {
      this.cfg.eyesOn = Math.min(0.75, Math.max(0.5, baseline.eyesOn));
      this.cfg.eyesOff = this.cfg.eyesOn - 0.15;
    }
  }

  reset() {
    this.closed = false; this.closedSince = null; this.reopenSince = null;
    this.direction = "forward"; this.awaySince = null; this.backSince = null;
    this.absentSince = null; this.lastT = null; this.samples = [];
  }

  update(frame: DriverFrame): DriverEvent {
    const cfg = this.cfg;
    // Unobserved time must never count as eyes closed or looking away.
    if (this.lastT !== null && frame.t - this.lastT > cfg.maxFrameGapMs) this.reset();
    const gap = this.lastT === null ? 0 : Math.min(Math.max(frame.t - this.lastT, 0), cfg.maxFrameGapMs);
    this.lastT = frame.t;
    const capturedAt = new Date(frame.t).toISOString();

    if (!frame.facePresent || frame.closure === null || frame.yaw === null || frame.pitch === null) {
      this.absentSince ??= frame.t;
      // Without a face the eyes and head cannot be read, so their timers stop.
      this.closed = false; this.closedSince = null; this.reopenSince = null;
      this.direction = "forward"; this.awaySince = null; this.backSince = null;
      this.samples = [];
      const absentMs = frame.t - this.absentSince;
      return {
        capturedAt, facePresent: false, absentMs,
        eyes: {closed: false, closedMs: 0, perclos: this.perclos(), score: null},
        head: {direction: null, yawDeg: null, pitchDeg: null, awayMs: 0},
        state: absentMs >= cfg.noFaceMs ? "no_face" : "uncertain",
        confidence: 0,
      };
    }
    this.absentSince = null;

    if (frame.confidence < cfg.minConfidence) {
      this.reset();
      return {
        capturedAt, facePresent: true, absentMs: 0,
        eyes: {closed: false, closedMs: 0, perclos: null, score: round(frame.closure, 2)},
        head: {direction: null, yawDeg: null, pitchDeg: null, awayMs: 0},
        state: "uncertain", confidence: round(clamp01(frame.confidence), 2),
      };
    }

    // Eyes, with hysteresis and a tolerance for blinks.
    if (!this.closed && frame.closure >= cfg.eyesOn) this.closed = true;
    else if (this.closed && frame.closure < cfg.eyesOff) this.closed = false;
    if (this.closed) {
      this.closedSince ??= frame.t;
      this.reopenSince = null;
    } else if (this.closedSince !== null) {
      this.reopenSince ??= frame.t;
      if (frame.t - this.reopenSince >= cfg.reopenToleranceMs) {this.closedSince = null; this.reopenSince = null;}
    }
    const closedMs = this.closedSince === null ? 0 : Math.max(0, (this.reopenSince ?? frame.t) - this.closedSince);

    if (gap > 0) this.samples.push({t: frame.t, dt: gap, closed: this.closed});
    while (this.samples.length && this.samples[0].t < frame.t - cfg.perclosWindowMs) this.samples.shift();

    // Head, relative to the calibrated straight-ahead pose.
    const yaw = frame.yaw - this.base.yaw;
    const pitch = frame.pitch - this.base.pitch;
    const yawLimit = this.direction === "left" || this.direction === "right" ? cfg.yawBack : cfg.yawAway;
    const down = pitch >= (this.direction === "down" ? cfg.pitchBack : cfg.pitchAway);
    const up = pitch <= -(this.direction === "up" ? cfg.pitchBack : cfg.pitchAway);
    const turned = Math.abs(yaw) >= yawLimit;
    if (turned && (!(down || up) || Math.abs(yaw) / cfg.yawAway >= Math.abs(pitch) / cfg.pitchAway)) {
      this.direction = yaw > 0 ? "left" : "right";
    } else if (down) this.direction = "down";
    else if (up) this.direction = "up";
    else this.direction = "forward";

    if (this.direction !== "forward") {
      this.awaySince ??= frame.t;
      this.backSince = null;
    } else if (this.awaySince !== null) {
      this.backSince ??= frame.t;
      if (frame.t - this.backSince >= cfg.awayToleranceMs) {this.awaySince = null; this.backSince = null;}
    }
    const awayMs = this.awaySince === null ? 0 : Math.max(0, (this.backSince ?? frame.t) - this.awaySince);

    const perclos = this.perclos();
    let state: AttentionState;
    if (closedMs >= cfg.drowsyClosedMs || (perclos !== null && perclos >= cfg.perclosDrowsy)) state = "drowsy";
    else if (awayMs >= cfg.awayMs) state = "distracted";
    else state = "attentive";

    return {
      capturedAt, facePresent: true, absentMs: 0,
      eyes: {closed: this.closed, closedMs, perclos, score: round(frame.closure, 2)},
      head: {direction: this.direction, yawDeg: round(yaw, 1), pitchDeg: round(pitch, 1), awayMs},
      state, confidence: round(clamp01(frame.confidence), 2),
    };
  }

  /** Share of observed time with closed eyes over the last 30 s, once 15 s have been observed. */
  private perclos(): number | null {
    const total = this.samples.reduce((sum, sample) => sum + sample.dt, 0);
    if (total < this.cfg.perclosMinMs) return null;
    const closed = this.samples.reduce((sum, sample) => sum + (sample.closed ? sample.dt : 0), 0);
    return round(closed / total, 3);
  }
}
