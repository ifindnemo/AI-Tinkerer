// A two-tone horn made with WebAudio (no audio file): high-low, like a vehicle alert, loud enough for a meeting
// room. The AudioContext must be created during a click, so call `prime()` from the button that starts the
// camera or simulation.
export type HornNote = {frequency: number; at: number; length: number; peak: number};

const HIGH = 880;
const LOW = 660;

/** The notes of one alert, in seconds from its start. Warning: two high-low pairs (about 1.1 s).
 * Critical: three higher, louder, faster pairs (about 1.4 s) so a mandatory stop cannot be mistaken for a warning. */
export function hornPattern(level: "warning" | "critical"): HornNote[] {
  const critical = level === "critical";
  const pairs = critical ? 3 : 2;
  const step = critical ? 0.23 : 0.28;
  const notes: HornNote[] = [];
  for (let pair = 0; pair < pairs; pair++) {
    [critical ? 988 : HIGH, critical ? 740 : LOW].forEach((frequency, index) => {
      notes.push({frequency, at: (pair * 2 + index) * step, length: step * 0.92, peak: critical ? 0.5 : 0.32});
    });
  }
  return notes;
}

export class AlertTone {
  private context: AudioContext | null = null;

  prime() {
    if (this.context || typeof window === "undefined") return;
    const Context = window.AudioContext ?? (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
    if (!Context) return;
    try {
      this.context = new Context();
    } catch {
      this.context = null;
    }
  }

  play(level: "warning" | "critical") {
    const context = this.context;
    if (!context) return;
    void context.resume().catch(() => {});
    // A compressor keeps the sum of overlapping tails from clipping the speakers.
    const output = context.createDynamicsCompressor();
    output.connect(context.destination);
    const start = context.currentTime + 0.02;
    for (const note of hornPattern(level)) {
      const at = start + note.at;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.value = note.frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(note.peak, at + 0.015);
      gain.gain.setValueAtTime(note.peak, at + note.length * 0.7);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + note.length);
      oscillator.connect(gain).connect(output);
      oscillator.start(at);
      oscillator.stop(at + note.length + 0.03);
    }
  }

  close() {
    void this.context?.close().catch(() => {});
    this.context = null;
  }
}
