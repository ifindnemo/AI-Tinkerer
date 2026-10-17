// Presenter pause for simulated clocks only. Wall time spent paused is not added back on resume,
// so a coolant ramp and an eye-closure timer do not jump forward.

export type DemoHoldView = {
  paused: boolean;
  pausedAt: number | null;
  scene: number;
};

const SERVER: DemoHoldView = {paused: false, pausedAt: null, scene: 0};

let paused = false;
let pausedAt: number | null = null;
let skew = 0;
let anchor = 0;
let scene = 0;
let published: DemoHoldView = SERVER;
const listeners = new Set<() => void>();

function emit() {
  published = {paused, pausedAt, scene};
  listeners.forEach(listener => listener());
}

export const demoHold = {
  get: (): DemoHoldView => published,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  isPaused: () => paused,
  scene: () => scene,
  now(wall = Date.now()) {
    return paused ? anchor - skew : wall - skew;
  },
  pause(wall = Date.now()) {
    if (paused) return;
    paused = true;
    anchor = wall;
    pausedAt = wall;
    emit();
  },
  resume(wall = Date.now()) {
    if (!paused) return;
    skew += wall - anchor;
    paused = false;
    pausedAt = null;
    emit();
  },
  bumpScene() {
    scene += 1;
    emit();
  },
  reset() {
    paused = false;
    pausedAt = null;
    skew = 0;
    anchor = 0;
    scene = 0;
    emit();
  },
};
