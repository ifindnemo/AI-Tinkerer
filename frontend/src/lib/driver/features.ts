// Pure geometry on MediaPipe FaceLandmarker output. No DOM, no camera.
export type Landmark = {x: number; y: number; z: number};
export type Blendshape = {categoryName: string; score: number};

// Indices in the 468-point face mesh (FaceLandmarker returns 478 with the same first 468).
export const LM = {CHEEK_A: 234, CHEEK_B: 454, FOREHEAD: 10, CHIN: 152} as const;
const deg = (radians: number) => (radians * 180) / Math.PI;
export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

export type HeadPose = {yaw: number; pitch: number; faceWidth: number};

/**
 * Head angles from the 3D landmarks. x and z share one scale (MediaPipe) and y is normalised by
 * the image height, so y is rescaled by `aspect` (= width / height) first.
 * yaw > 0: the nose points toward the image's right (the driver turned toward their own left,
 * because the camera faces them). pitch > 0: the head is tilted down. Both are approximate and
 * are measured against a per-session calibration, not an absolute zero.
 */
export function headPose(landmarks: readonly Landmark[], aspect: number): HeadPose | null {
  const a = landmarks[LM.CHEEK_A];
  const b = landmarks[LM.CHEEK_B];
  const top = landmarks[LM.FOREHEAD];
  const chin = landmarks[LM.CHIN];
  if (!a || !b || !top || !chin || !(aspect > 0)) return null;
  const faceWidth = Math.abs(b.x - a.x);
  if (faceWidth < 1e-4) return null;
  const yaw = deg(Math.atan2(b.z - a.z, b.x - a.x));
  const pitch = deg(Math.atan2(chin.z - top.z, (chin.y - top.y) / aspect));
  return {yaw: round(yaw, 1), pitch: round(pitch, 1), faceWidth: round(faceWidth, 3)};
}

export type EyeReading = {score: number; asymmetry: number};

/** Mean eye-blink score (0 open … 1 closed) and how much the two eyes disagree. */
export function eyeReading(blendshapes: readonly Blendshape[] | undefined): EyeReading | null {
  const find = (name: string) => blendshapes?.find(item => item.categoryName === name)?.score;
  const left = find("eyeBlinkLeft");
  const right = find("eyeBlinkRight");
  if (left === undefined || right === undefined) return null;
  return {score: round((left + right) / 2, 3), asymmetry: round(Math.abs(left - right), 3)};
}

/**
 * Heuristic confidence in the reading, 0…1 (not a calibrated probability): the face must be
 * large enough in the frame, both eyes must agree (a wink or an occluded eye is unreliable),
 * and the head must not be turned so far that the eyes are hidden.
 */
export function faceConfidence(input: {faceWidth: number; asymmetry: number | null; yaw: number | null}): number {
  const size = clamp01((input.faceWidth - 0.1) / 0.12);
  const symmetry = input.asymmetry === null ? 0.6 : 1 - clamp01((input.asymmetry - 0.3) / 0.4);
  const pose = input.yaw === null ? 1 : 1 - clamp01((Math.abs(input.yaw) - 45) / 25);
  return round(size * symmetry * pose, 2);
}
