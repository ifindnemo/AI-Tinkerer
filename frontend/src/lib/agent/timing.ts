/** Observed player start relative to visible text; audio already playing means zero extra wait. */
export function replyToAudioMs(replyShownAt: number | null, audioStartedAt: number | null): number | null {
  if (replyShownAt === null || audioStartedAt === null || !Number.isFinite(replyShownAt) || !Number.isFinite(audioStartedAt)) return null;
  return Math.max(0, audioStartedAt - replyShownAt);
}
