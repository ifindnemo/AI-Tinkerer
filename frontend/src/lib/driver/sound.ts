// A soft two- or three-note chime made with WebAudio (no audio file). The AudioContext must be
// created during a click, so call `prime()` from the button that starts the camera or simulation.
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
    const notes = level === "critical" ? [880, 698.5, 880] : [659.3, 880];
    const start = context.currentTime + 0.02;
    notes.forEach((frequency, index) => {
      const at = start + index * 0.22;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(level === "critical" ? 0.22 : 0.14, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.42);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.45);
    });
  }

  close() {
    void this.context?.close().catch(() => {});
    this.context = null;
  }
}
