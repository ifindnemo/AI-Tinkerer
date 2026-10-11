// Webcam + MediaPipe FaceLandmarker, entirely in the browser. Frames are read from the <video>
// element by the WASM model and never copied, encoded or sent anywhere.
import {eyeReading, faceConfidence, headPose, type Blendshape, type Landmark} from "./features";
import type {DriverFrame} from "./types";

export const MEDIAPIPE_ASSETS = {wasm: "/mediapipe/wasm", model: "/mediapipe/face_landmarker.task"} as const;
const MIN_INTERVAL_MS = 66; // ≈ 15 analyses per second is plenty for attention and saves battery

/** Face bounds in the unmirrored video frame, normalised to 0…1. */
export type FaceBox = {x: number; y: number; w: number; h: number};
export type CameraSample = {frame: DriverFrame; box: FaceBox | null};
export type CameraErrorCode = "insecure" | "unsupported" | "denied" | "no_camera" | "disconnected" | "busy" | "model" | "other";

export class CameraError extends Error {
  constructor(readonly code: CameraErrorCode, cause?: unknown) {
    super(code, {cause});
  }
}

export type CameraSession = {stop: () => void; delegate: "GPU" | "CPU"; deviceId: string};

type LandmarkerResult = {faceLandmarks?: Landmark[][]; faceBlendshapes?: {categories: Blendshape[]}[]};

/** Pure conversion of one model result (tested without a browser). */
export function toSample(result: LandmarkerResult, width: number, height: number, t: number): CameraSample {
  const landmarks = result.faceLandmarks?.[0];
  const pose = landmarks?.length ? headPose(landmarks, width / height) : null;
  const eyes = eyeReading(result.faceBlendshapes?.[0]?.categories);
  if (!landmarks || !pose || !eyes) {
    return {frame: {t, facePresent: false, closure: null, yaw: null, pitch: null, confidence: 0}, box: null};
  }
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const point of landmarks) {
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
  }
  const clamp = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 1e4) / 1e4;
  return {
    frame: {
      t, facePresent: true, closure: eyes.score, yaw: pose.yaw, pitch: pose.pitch,
      confidence: faceConfidence({faceWidth: pose.faceWidth, asymmetry: eyes.asymmetry, yaw: pose.yaw}),
    },
    box: {x: clamp(minX), y: clamp(minY), w: clamp(clamp(maxX) - clamp(minX)), h: clamp(clamp(maxY) - clamp(minY))},
  };
}

function cameraError(error: unknown): CameraError {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return new CameraError("denied", error);
  if (name === "NotFoundError" || name === "OverconstrainedError") return new CameraError("no_camera", error);
  if (name === "NotReadableError" || name === "AbortError") return new CameraError("busy", error);
  return new CameraError("other", error);
}

async function createLandmarker() {
  const {FaceLandmarker, FilesetResolver} = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_ASSETS.wasm);
  let lastError: unknown;
  for (const delegate of ["GPU", "CPU"] as const) {
    try {
      const landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: {modelAssetPath: MEDIAPIPE_ASSETS.model, delegate},
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
      });
      return {landmarker, delegate};
    } catch (error) {
      lastError = error; // no WebGL here: try the CPU
    }
  }
  throw new CameraError("model", lastError);
}

/** Opens the front camera into `video` and calls `onSample` about 15 times per second. */
export async function startCamera(video: HTMLVideoElement, onSample: (sample: CameraSample) => void, signal?: AbortSignal, options: {deviceId?: string; onEnded?: () => void} = {}): Promise<CameraSession> {
  if (typeof window !== "undefined" && !window.isSecureContext) throw new CameraError("insecure");
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError("unsupported");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {...(options.deviceId ? {deviceId: {exact: options.deviceId}} : {facingMode: "user"}), width: {ideal: 640}, height: {ideal: 480}, frameRate: {ideal: 30}},
    });
  } catch (error) {
    throw cameraError(error);
  }
  const track = stream.getVideoTracks()[0];
  const ended = () => options.onEnded?.();
  track?.addEventListener("ended", ended, {once: true});
  const release = () => {
    track?.removeEventListener("ended", ended);
    signal?.removeEventListener("abort", release);
    stream.getTracks().forEach(track => track.stop());
    if (video.srcObject === stream) video.srcObject = null;
  };
  signal?.addEventListener("abort", release, {once: true});
  if (signal?.aborted) {
    release();
    throw new CameraError("other");
  }
  try {
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
  } catch (error) {
    release();
    throw cameraError(error);
  }
  let model: Awaited<ReturnType<typeof createLandmarker>>;
  try {
    model = await createLandmarker();
  } catch (error) {
    release();
    throw error instanceof CameraError ? error : new CameraError("model", error);
  }
  if (signal?.aborted) {
    model.landmarker.close();
    release();
    throw new CameraError("other");
  }

  let stopped = false;
  let handle = 0;
  let lastRun = 0;
  let lastTimestamp = 0;
  let lastVideoTime = -1;
  let lastFrameAt = performance.now();
  const loop = () => {
    if (stopped) return;
    const now = performance.now();
    if (now - lastRun >= MIN_INTERVAL_MS) {
      lastRun = now;
      let sample: CameraSample | null = null;
      if (video.readyState >= 2 && video.videoWidth > 0 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const timestamp = Math.max(now, lastTimestamp + 1); // MediaPipe needs strictly increasing timestamps
        lastTimestamp = timestamp;
        try {
          const result = model.landmarker.detectForVideo(video, timestamp) as LandmarkerResult;
          sample = toSample(result, video.videoWidth, video.videoHeight, Date.now());
          lastFrameAt = now;
        } catch {
          // A single bad frame is skipped; persistent failures become unavailable signal below.
        }
      }
      if (sample) onSample(sample);
      else if (now - lastFrameAt >= 1000) onSample(toSample({}, 1, 1, Date.now()));
    }
    handle = requestAnimationFrame(loop);
  };
  handle = requestAnimationFrame(loop);

  return {
    deviceId: track?.getSettings().deviceId ?? options.deviceId ?? "",
    delegate: model.delegate,
    stop: () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(handle);
      release();
      model.landmarker.close();
    },
  };
}
