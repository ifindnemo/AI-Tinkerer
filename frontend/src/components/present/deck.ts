// The talk timetable: five slides, 7:00 in all. The live demo is the longest slide, as the brief asks.
// "built" and "hood" carry the two animated diagrams of the intro film (the 0:20 and 0:35 scenes), kept as live slides.
export const SLIDES = [
  {id: "built", title: "What I built", seconds: 40},
  {id: "demo", title: "Live demo", seconds: 160},
  {id: "hood", title: "Under the hood", seconds: 100},
  {id: "challenges", title: "Challenges & learnings", seconds: 90},
  {id: "wrap", title: "Wrap-up", seconds: 30},
] as const;

export const TOTAL_SECONDS = SLIDES.reduce((sum, slide) => sum + slide.seconds, 0);

export function clampSlide(index: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.min(SLIDES.length - 1, Math.max(0, Math.trunc(index)));
}

/** `#3` opens the third slide; anything else opens the first. */
export function slideFromHash(hash: string): number {
  const match = /^#(\d{1,2})$/.exec(hash);
  return match ? clampSlide(Number(match[1]) - 1) : 0;
}

export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Seconds into the talk at which each slide should start, so the timer can say "ahead" or "behind". */
export function slideStarts(): number[] {
  let at = 0;
  return SLIDES.map(slide => {
    const start = at;
    at += slide.seconds;
    return start;
  });
}

/** Seconds left in the slide the presenter is on, counted from the start of the talk; negative once the slide has run over. */
export function remaining(elapsed: number, index: number): number {
  const safe = clampSlide(index);
  return Math.round(slideStarts()[safe] + SLIDES[safe].seconds - elapsed);
}
