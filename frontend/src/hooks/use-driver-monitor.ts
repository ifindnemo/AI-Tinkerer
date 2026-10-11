"use client";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {AttentionTracker} from "@/lib/driver/attention";
import {Calibrator} from "@/lib/driver/calibration";
import {CameraError, startCamera, type CameraErrorCode, type CameraSample, type CameraSession} from "@/lib/driver/camera";
import {postDriverEvents} from "@/lib/driver/client";
import {LiveChannel} from "@/lib/driver/live";
import {simulatedSample, type SimulationScenario} from "@/lib/driver/simulation";
import {AlertTone} from "@/lib/driver/sound";
import {DriverSafety} from "@/lib/driver/safety";
import {HISTORY_LIMIT, loadDriverStore, saveDriverStore, type DriverSettings, type DriverStore} from "@/lib/driver/storage";
import type {AttentionState, DriverAssessment, DriverEvent, DriverReply, DriverSeverity, DriverSource} from "@/lib/driver/types";
import {DEFAULT_ECU, ecuReading, type EcuScenario} from "@/lib/guardian/ecu";
import {COOLANT_WARN_C, LocalGuardian, MOVING_KMH, canConfirm, shouldSound} from "@/lib/guardian/policy";
import type {GuardianBlock, GuardianDecision, VehicleSnapshot} from "@/lib/guardian/types";

export type MonitorPhase = "idle" | "starting" | "calibrating" | "running" | "error";

export type MonitorView = {
  hydrated: boolean;
  phase: MonitorPhase;
  error: CameraErrorCode | null;
  source: DriverSource | null;
  scenario: SimulationScenario | null;
  delegate: "GPU" | "CPU" | null;
  calibration: {progress: number; failed: boolean; face: boolean};
  event: DriverEvent | null;
  localAssessment: DriverAssessment | null; // car + driver, decided on this device
  guardian: GuardianBlock | null; // the local Guardian block (the backend's arrives in `reply.guardian`)
  vehicle: VehicleSnapshot | null;
  acknowledgedAt: string | null;
  hornMuted: boolean; // quick mute for this session only; the saved sound setting is untouched
  reply: DriverReply | null;
  sendError: boolean;
  sentEvents: number;
  history: [number, AttentionState][];
  store: DriverStore;
};

const UI_INTERVAL_MS = 200; // text and numbers: 5 updates per second
const SEND_INTERVAL_MS = 3000;
const MAX_QUEUE = 60;
const CRITICAL_REPEAT_MS = 8000;
// Crossing these sends at once instead of waiting for the next 3-second batch.
const ESCALATE_CLOSED_MS = 2500;
const ESCALATE_AWAY_MS = 4000;

export function useDriverMonitor() {
  const live = useMemo(() => new LiveChannel(), []);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState("");
  const deviceRequest = useRef({sequence: 0});
  const refreshCameras = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const request = ++deviceRequest.current.sequence;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (request === deviceRequest.current.sequence) setCameras(devices.filter(device => device.kind === "videoinput" && device.deviceId));
    } catch { /* Permission/OS may hide devices; camera start still reports actionable errors. */ }
  }, []);
  useEffect(() => {
    const devices = navigator.mediaDevices;
    const requestState = deviceRequest.current;
    void refreshCameras(); // Listing devices never requests camera permission.
    devices?.addEventListener("devicechange", refreshCameras);
    return () => {
      requestState.sequence++;
      devices?.removeEventListener("devicechange", refreshCameras);
    };
  }, [refreshCameras]);
  const [view, setView] = useState<MonitorView>(() => ({
    hydrated: false, phase: "idle", error: null, source: null, scenario: null, delegate: null,
    calibration: {progress: 0, failed: false, face: true}, event: null, localAssessment: null, guardian: null, vehicle: null, acknowledgedAt: null, hornMuted: false,
    reply: null, sendError: false, sentEvents: 0,
    history: [], store: {version: 1, consent: false, settings: {sound: true, showVideo: true, ecu: DEFAULT_ECU}, history: []},
  }));

  // Mutable machinery that must not trigger renders.
  const m = useRef({
    tracker: new AttentionTracker(),
    safety: new DriverSafety(),
    guardian: new LocalGuardian(),
    ecuStart: Date.now(),
    vehicle: null as VehicleSnapshot | null,
    warnC: COOLANT_WARN_C, // replaced by the backend's configured threshold once it replies
    ackAt: null as string | null, // capturedAt of the event at which the driver confirmed
    lastGuardian: null as GuardianBlock | null,
    lastDecision: null as GuardianDecision | null,
    hornMuted: false,
    calibrator: null as Calibrator | null,
    camera: null as CameraSession | null,
    cameraAbort: null as AbortController | null,
    simTimer: null as ReturnType<typeof setInterval> | null,
    simStart: 0,
    scenario: null as SimulationScenario | null,
    source: null as DriverSource | null,
    phase: "idle" as MonitorPhase,
    sessionId: "",
    lastUi: 0,
    lastSecond: 0,
    lastState: null as AttentionState | null,
    lastEvent: null as DriverEvent | null,
    lastSentState: null as AttentionState | null,
    lastSend: 0,
    queue: [] as DriverEvent[],
    sending: false,
    abort: null as AbortController | null,
    severity: "normal" as DriverSeverity,
    lastTone: 0,
    history: [] as [number, AttentionState][],
    store: null as DriverStore | null,
    lastSave: 0,
    generation: 0,
    tone: new AlertTone(),
  });

  useEffect(() => {
    // Read browser storage after hydration so the server HTML stays deterministic.
    const timer = setTimeout(() => {
      const store = loadDriverStore();
      m.current.store = store;
      m.current.history = store.history;
      setView(current => ({...current, hydrated: true, store, history: store.history}));
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const persist = useCallback((patch: Partial<DriverStore> = {}, force = false) => {
    const state = m.current;
    const base = state.store ?? loadDriverStore();
    const store: DriverStore = {...base, ...patch, history: state.history.slice(-HISTORY_LIMIT)};
    state.store = store;
    const now = Date.now();
    if (force || now - state.lastSave >= 5000) {
      state.lastSave = now;
      saveDriverStore(store);
    }
    return store;
  }, []);

  const playTone = useCallback((level: "warning" | "critical") => {
    const state = m.current;
    if (!state.store?.settings.sound || state.hornMuted) return;
    state.lastTone = Date.now();
    state.tone.play(level);
  }, []);

  const send = useCallback(async () => {
    const state = m.current;
    if (state.sending || !state.queue.length || !state.source) return;
    const generation = state.generation;
    const events = state.queue.splice(0, MAX_QUEUE);
    state.sending = true;
    state.lastSend = Date.now();
    state.lastSentState = events.at(-1)!.state;
    const vehicle = state.vehicle;
    const ecu = state.store?.settings.ecu;
    const ackAt = state.ackAt;
    const moving = vehicle ? vehicle.speedKmh >= MOVING_KMH : true;
    const controller = new AbortController();
    state.abort = controller;
    try {
      const reply = await postDriverEvents({
        schemaVersion: 1,
        sessionId: state.sessionId,
        source: state.source,
        context: {vehicleMoving: moving, ...(vehicle ? {vehicle} : {}), ...(ackAt ? {acknowledgedAt: ackAt} : {})},
        events,
      }, controller.signal);
      if (generation !== state.generation) return;
      if (reply.guardian) state.warnC = reply.guardian.vehicle.warnC;
      const stillRelevant = events.at(-1)!.state === state.lastEvent?.state && ecu === state.store?.settings.ecu && ackAt === state.ackAt;
      setView(current => ({...current, reply: stillRelevant ? reply : null, sendError: false, sentEvents: current.sentEvents + events.length}));
    } catch {
      if (generation !== state.generation || controller.signal.aborted) return;
      // Keep the newest events for the next attempt; never resend an unbounded backlog.
      state.queue = [...events, ...state.queue].slice(-MAX_QUEUE);
      setView(current => ({...current, sendError: true}));
    } finally {
      if (generation === state.generation) {state.sending = false; state.abort = null;}
    }
  }, []);

  const handleSample = useCallback((sample: CameraSample) => {
    const state = m.current;
    const now = sample.frame.t;
    const video = state.source === "webcam" && (state.store?.settings.showVideo ?? true);

    if (state.phase === "calibrating" && state.calibrator) {
      const status = state.calibrator.add(sample.frame);
      live.push({sample, event: null, calibrating: true, video});
      if (status.state === "collecting") {
        if (now - state.lastUi >= UI_INTERVAL_MS) {
          state.lastUi = now;
          setView(current => ({...current, calibration: {progress: status.progress, failed: false, face: sample.frame.facePresent}}));
        }
        return;
      }
      if (status.baseline) state.tracker.setBaseline(status.baseline);
      state.calibrator = null;
      state.phase = "running";
      setView(current => ({...current, phase: "running", calibration: {progress: 1, failed: status.state === "failed", face: true}}));
      return;
    }
    if (state.phase !== "running") return;

    const event = state.tracker.update(sample.frame);
    const vehicle = ecuReading(state.store?.settings.ecu ?? DEFAULT_ECU, now - state.ecuStart, now);
    state.vehicle = vehicle;
    const driver = state.safety.update(event, vehicle.speedKmh >= MOVING_KMH);
    const local = state.guardian.update(event, driver, vehicle, state.ackAt, state.warnC);
    // A confirmation ends with its episode, and a new closure or glance away voids it.
    if (state.ackAt && !local.block.driver.responded) state.ackAt = null;
    state.lastGuardian = local.block;
    const localAssessment = local.assessment;
    // A warm engine alone stays visual; the driver's alertness and a mandatory stop sound.
    if (shouldSound(state.lastDecision, local.decision)) playTone(localAssessment.severity === "critical" ? "critical" : "warning");
    state.lastDecision = local.decision;
    const severityChanged = state.severity !== localAssessment.severity;
    state.severity = localAssessment.severity;
    live.push({sample, event, calibrating: false, video});
    const changed = event.state !== state.lastState;
    const previous = state.lastEvent;
    const escalated = (event.eyes.closedMs >= ESCALATE_CLOSED_MS && (previous?.eyes.closedMs ?? 0) < ESCALATE_CLOSED_MS)
      || (event.head.awayMs >= ESCALATE_AWAY_MS && (previous?.head.awayMs ?? 0) < ESCALATE_AWAY_MS);
    state.lastState = event.state;
    state.lastEvent = event;

    const second = Math.floor(now / 1000);
    if (second !== state.lastSecond) {
      state.lastSecond = second;
      state.queue.push(event);
      if (state.queue.length > MAX_QUEUE) state.queue.shift();
      state.history = [...state.history, [second * 1000, event.state] as [number, AttentionState]].slice(-HISTORY_LIMIT);
      persist();
    } else if (changed || escalated) {
      state.queue.push(event);
    }

    if (escalated || event.state !== state.lastSentState || now - state.lastSend >= SEND_INTERVAL_MS) void send();
    if (state.severity === "critical" && now - state.lastTone >= CRITICAL_REPEAT_MS) playTone("critical");

    if (changed || severityChanged || now - state.lastUi >= UI_INTERVAL_MS) {
      state.lastUi = now;
      setView(current => ({...current, event, localAssessment, guardian: local.block, vehicle, acknowledgedAt: state.ackAt, history: state.history, ...(changed ? {reply: null} : {})}));
    }
  }, [live, persist, playTone, send]);

  const reset = useCallback(() => {
    const state = m.current;
    state.generation += 1;
    state.hornMuted = false;
    state.cameraAbort?.abort();
    state.cameraAbort = null;
    state.camera?.stop();
    state.camera = null;
    if (state.simTimer) clearInterval(state.simTimer);
    state.simTimer = null;
    state.abort?.abort();
    state.abort = null;
    state.sending = false;
    state.queue = [];
    state.tracker = new AttentionTracker();
    state.safety = new DriverSafety();
    state.guardian = new LocalGuardian();
    state.lastDecision = null;
    state.ackAt = null;
    state.lastGuardian = null;
    state.calibrator = null;
    state.lastState = null;
    state.lastEvent = null;
    state.lastSentState = null;
    state.severity = "normal";
    state.scenario = null;
    state.source = null;
    state.phase = "idle";
    live.push(null);
  }, [live]);

  const startWebcam = useCallback(async (deviceId = selectedCamera) => {
    const state = m.current;
    if (state.phase === "starting") return;
    state.tone.prime(); // inside the click: browsers only allow audio after a gesture
    reset();
    const generation = state.generation;
    state.phase = "starting";
    state.source = "webcam";
    state.sessionId = crypto.randomUUID();
    persist({consent: true}, true);
    setView(current => ({...current, phase: "starting", error: null, source: "webcam", scenario: null, reply: null, event: null, localAssessment: null, sentEvents: 0, sendError: false, calibration: {progress: 0, failed: false, face: true}, store: m.current.store ?? current.store}));
    const video = videoRef.current;
    if (!video) {
      state.phase = "error";
      state.source = null;
      setView(current => ({...current, phase: "error", source: null, error: "other"}));
      return;
    }
    try {
      state.cameraAbort = new AbortController();
      const session = await startCamera(video, handleSample, state.cameraAbort.signal, {
        deviceId,
        onEnded: () => {
          if (generation !== state.generation) return;
          reset();
          state.phase = "error";
          setView(current => ({...current, phase: "error", source: null, error: "disconnected", event: null, localAssessment: null, reply: null}));
          void refreshCameras();
        },
      });
      if (generation !== state.generation) {session.stop(); return;}
      state.camera = session;
      setSelectedCamera(session.deviceId);
      void refreshCameras(); // Permission reveals device names and the other connected cameras.
      state.calibrator = new Calibrator();
      state.phase = "calibrating";
      setView(current => ({...current, phase: "calibrating", delegate: session.delegate}));
    } catch (error) {
      if (generation !== state.generation) return;
      state.phase = "error";
      state.source = null;
      setView(current => ({...current, phase: "error", source: null, error: error instanceof CameraError ? error.code : "other"}));
    }
  }, [handleSample, persist, reset, selectedCamera, refreshCameras]);

  const selectCamera = useCallback((deviceId: string) => {
    setSelectedCamera(deviceId);
    if (m.current.source === "webcam" && ["calibrating", "running"].includes(m.current.phase)) void startWebcam(deviceId);
  }, [startWebcam]);

  const startSimulation = useCallback((scenario: SimulationScenario) => {
    const state = m.current;
    state.tone.prime();
    if (state.source !== "simulated") {
      reset();
      state.sessionId = crypto.randomUUID();
      state.source = "simulated";
      state.phase = "running";
      state.simTimer = setInterval(() => {
        if (state.scenario) handleSample(simulatedSample(state.scenario, Date.now() - state.simStart, Date.now()));
      }, 66);
    }
    const fresh = state.scenario !== scenario;
    if (fresh) {
      // Each scenario is a different driver: a new backend session, no PERCLOS, timers or alert hold.
      state.generation += 1;
      state.abort?.abort();
      state.abort = null;
      state.sending = false;
      state.queue = [];
      state.sessionId = crypto.randomUUID();
      state.tracker = new AttentionTracker();
      state.safety = new DriverSafety();
      state.guardian = new LocalGuardian();
      state.lastDecision = null;
      state.ackAt = null;
      state.lastState = null;
      state.lastEvent = null;
      state.lastSentState = null;
      state.severity = "normal";
    }
    state.scenario = scenario;
    state.simStart = Date.now();
    setView(current => ({...current, phase: "running", error: null, source: "simulated", scenario, delegate: null, calibration: {progress: 1, failed: false, face: true}, ...(fresh ? {reply: null, event: null, localAssessment: null, guardian: null, acknowledgedAt: null, sendError: false, sentEvents: 0} : {})}));
  }, [handleSample, reset]);

  const stop = useCallback(() => {
    reset();
    persist({}, true);
    setView(current => ({...current, hornMuted: false, phase: "idle", source: null, scenario: null, event: null, localAssessment: null, guardian: null, vehicle: null, acknowledgedAt: null, reply: null, error: null, sendError: false}));
  }, [persist, reset]);

  const recalibrate = useCallback(() => {
    const state = m.current;
    if (state.source !== "webcam" || !state.camera) return;
    state.generation += 1;
    state.abort?.abort();
    state.abort = null;
    state.sending = false;
    state.queue = [];
    state.tracker = new AttentionTracker();
    state.guardian = new LocalGuardian();
    state.lastDecision = null;
    state.ackAt = null;
    state.calibrator = new Calibrator();
    state.phase = "calibrating";
    state.lastState = null;
    state.lastEvent = null;
    state.lastSentState = null;
    setView(current => ({...current, phase: "calibrating", event: null, reply: null, calibration: {progress: 0, failed: false, face: true}}));
  }, []);

  const updateSettings = useCallback((patch: Partial<DriverSettings>) => {
    const state = m.current;
    const base = state.store ?? loadDriverStore();
    if (patch.sound) state.tone.prime();
    const store = persist({settings: {...base.settings, ...patch}}, true);
    // A different car situation: drop the old reply; the next frame recomputes the local decision.
    setView(current => ({...current, store, ...(patch.ecu !== undefined && patch.ecu !== base.settings.ecu ? {reply: null} : {})}));
    if (patch.ecu !== undefined && patch.ecu !== base.settings.ecu) state.lastSend = 0;
  }, [persist]);

  const muteHorn = useCallback(() => {
    m.current.hornMuted = true;
    setView(current => ({...current, hornMuted: true}));
  }, []);

  const setEcu = useCallback((ecu: EcuScenario) => updateSettings({ecu}), [updateSettings]);

  /** The driver confirms the alert. Accepted only with open eyes facing forward during an active alert. */
  const acknowledge = useCallback(() => {
    const state = m.current;
    const event = state.lastEvent;
    if (state.phase !== "running" || !canConfirm(event) || !state.lastGuardian?.driver.alertSince) return false;
    state.ackAt = event!.capturedAt;
    state.queue.push(event!); // the backend checks the confirmation against this very event
    setView(current => ({...current, acknowledgedAt: state.ackAt}));
    void send();
    return true;
  }, [send]);

  useEffect(() => {
    const state = m.current;
    return () => {
      reset();
      state.tone.close();
    };
  }, [reset]);

  return {view, live, videoRef, cameras, selectedCamera, selectCamera, refreshCameras, startWebcam, startSimulation, stop, recalibrate, updateSettings, setEcu, acknowledge, muteHorn};
}
