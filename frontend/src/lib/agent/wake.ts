/** "hey neuron" opens a conversation. The words after it, if any, are the question. */

const WAKE = /\b(?:hey|hi|hay|hei)\s+(?:new\s+ron|neurons?)\b/;
const FILLER = new Set(["uh", "um", "ah", "er", "hmm", "a", "u"]);

export function normalizeSpeech(transcript: string): string {
  return transcript
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * `null` when the phrase was not said. A string is the question after it,
 * empty when the driver only said the wake phrase and will keep talking.
 */
export function commandAfterWake(transcript: string): string | null {
  const normalized = normalizeSpeech(transcript);
  const match = WAKE.exec(normalized);
  if (!match) return null;
  const rest = normalized.slice(match.index + match[0].length).trim();
  return rest.split(" ").filter(word => word && !FILLER.has(word)).join(" ");
}

/** A same-breath question long enough to trust. A bare word waits for the Blaze recording. */
export function commandIsQuestion(command: string): boolean {
  const words = command.split(" ").filter(Boolean);
  return words.length >= 2 || command.length >= 8;
}
