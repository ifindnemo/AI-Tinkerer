/** "hey neuron" opens a conversation. The words after it, if any, are the question. */

const WAKE = /\b(?:hey|hi|hay|hei)\s+(?:new\s+ron|neurons?)\b/;
const FILLER = new Set(["uh", "um", "ah", "er", "hmm", "a", "u"]);

export function normalizeSpeech(transcript: string): string {
  return transcript
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
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

export type AudioControl = "quiet" | "resume" | "end";

const QUIET = /^(stop|quiet|silence|be quiet|stop talking|hush|im|im lang|im di|tam im|tam im lang|dung noi|dung doc)$/;
const RESUME = /^(resume|speak again|unmute|bat lai|noi tiep|doc tiep)$/;
const END = /^(end|end conversation|stop conversation|goodbye|ket thuc|ket thuc hoi thoai|dung hoi)$/;

/**
 * A direct audio command. `stop` alone is quiet, and only with a wake phrase or inside a
 * conversation that is already open. "stop the engine" and "why did you stop" stay questions.
 */
export function parseControl(transcript: string, options: {inConversation: boolean; wake?: boolean} = {inConversation: false}): AudioControl | null {
  const afterWake = commandAfterWake(transcript);
  const armed = options.inConversation || afterWake !== null || options.wake === true;
  if (!armed) return null;
  const text = afterWake !== null ? afterWake : normalizeSpeech(transcript);
  if (!text) return null;
  if (QUIET.test(text)) return "quiet";
  if (RESUME.test(text)) return "resume";
  if (END.test(text)) return "end";
  return null;
}

/** True when the microphone mostly heard the line that is already playing. */
export function looksLikeEcho(heard: string, spoken: string): boolean {
  const left = normalizeSpeech(heard);
  const right = normalizeSpeech(spoken);
  if (!left || !right) return false;
  if (left.length >= 8 && (right.includes(left) || left.includes(right))) return true;
  const heardWords = new Set(left.split(" ").filter(word => word.length > 2));
  const spokenWords = right.split(" ").filter(word => word.length > 2);
  if (!spokenWords.length || !heardWords.size) return false;
  const hits = spokenWords.filter(word => heardWords.has(word)).length;
  return hits / spokenWords.length >= 0.6 && hits >= 3;
}

/** During playback only a final, explicit wake command can interrupt. Never turn TTS into a question. */
export function playbackControl(transcript: string, spoken: string | null, isFinal: boolean): AudioControl | null {
  if (!isFinal || commandAfterWake(transcript) === null) return null;
  if (spoken && looksLikeEcho(transcript, spoken)) return null;
  return parseControl(transcript, {inConversation: true});
}
