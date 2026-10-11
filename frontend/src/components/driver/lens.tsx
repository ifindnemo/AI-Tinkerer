"use client";
import {useEffect, useId, useRef, type RefObject} from "react";
import {Eye, EyeOff, Lock, ScanFace, Square, Volume2, VolumeX} from "lucide-react";
import {useLang} from "@/hooks/use-preferences";
import type {MonitorView} from "@/hooks/use-driver-monitor";
import {pick} from "@/lib/preferences";
import {approach, type LiveChannel} from "@/lib/driver/live";
import type {AttentionState} from "@/lib/driver/types";
import {STATE_LABEL} from "./labels";
import styles from "./driver.module.css";

type Rect = {x: number; y: number; w: number; h: number};
const SIM_ASPECT = {width: 4, height: 3};

/** Where a normalised (unmirrored) source box lands in the mirrored, object-fit: cover lens. */
function toLens(box: Rect, source: {width: number; height: number}, lens: {width: number; height: number}): Rect {
  const scale = Math.max(lens.width / source.width, lens.height / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  const offsetX = (lens.width - width) / 2;
  const offsetY = (lens.height - height) / 2;
  const pad = 0.14; // the landmark hull is tight; give the corners some air
  const x = 1 - (box.x + box.w) - box.w * pad; // mirrored
  const y = box.y - box.h * pad;
  return {x: offsetX + x * width, y: offsetY + y * height, w: box.w * (1 + 2 * pad) * width, h: box.h * (1 + 2 * pad) * height};
}

const lid = (cx: number, closure: number) => {
  const y = 104 - 10 + 17 * Math.min(1, Math.max(0, closure));
  return {upper: `M${cx - 13} 104 Q${cx} ${y.toFixed(2)} ${cx + 13} 104`, clip: `M${cx - 13} 104 Q${cx} ${y.toFixed(2)} ${cx + 13} 104 Q${cx} 111 ${cx - 13} 104Z`};
};

type Props = {
  view: MonitorView;
  live: LiveChannel;
  videoRef: RefObject<HTMLVideoElement | null>;
  severity: "normal" | "warning" | "critical";
  /** Current observation; alert severity can remain high after this changes. */
  shownState: AttentionState | null;
  onToggleVideo: () => void;
  onToggleSound: () => void;
  onRecalibrate: () => void;
  onStop: () => void;
};

export default function Lens({view, live, videoRef, severity, shownState, onToggleVideo, onToggleSound, onRecalibrate, onStop}: Props) {
  const {t, lang} = useLang();
  const id = useId().replace(/:/g, "");
  const lens = useRef<HTMLDivElement>(null);
  const reticle = useRef<HTMLDivElement>(null);
  const avatar = useRef<SVGSVGElement>(null);
  const features = useRef<SVGGElement>(null);
  const head = useRef<SVGEllipseElement>(null);
  const lids = useRef<(SVGPathElement | null)[]>([]);
  const clips = useRef<(SVGPathElement | null)[]>([]);
  const size = useRef({width: 1, height: 1});
  const shown = useRef({rect: null as Rect | null, yaw: 0, pitch: 0, closure: 0.1});

  const {phase, source} = view;
  const showVideo = view.store.settings.showVideo;
  const active = phase === "calibrating" || phase === "running";
  const videoOn = source === "webcam" && showVideo && active;
  const avatarOn = !videoOn;

  useEffect(() => {
    const element = lens.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      size.current = {width: entry.contentRect.width, height: entry.contentRect.height};
      shown.current.rect = null;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Frame-rate visuals: written straight to the DOM, never through React state.
  useEffect(() => {
    let handle = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      const frame = live.get();
      const lensSize = size.current;
      const video = videoRef.current;
      const sourceSize = frame?.video && video?.videoWidth ? {width: video.videoWidth, height: video.videoHeight} : SIM_ASPECT;
      const box = frame?.sample.box;
      const face = !!box && !!frame?.sample.frame.facePresent;
      lens.current?.setAttribute("data-face", face ? "on" : "off");
      const target = box
        ? toLens(box, sourceSize, lensSize)
        : {x: lensSize.width * 0.32, y: lensSize.height * 0.18, w: lensSize.width * 0.36, h: lensSize.height * 0.62};
      const s = shown.current;
      const r = s.rect ?? target;
      s.rect = {
        x: approach(r.x, target.x, dt, 60), y: approach(r.y, target.y, dt, 60),
        w: approach(r.w, target.w, dt, 80), h: approach(r.h, target.h, dt, 80),
      };
      const rect = s.rect;
      if (reticle.current) {
        // Near the top edge the label would collide with the chips: draw it inside the corners.
        reticle.current.dataset.tag = rect.y < 76 ? "inside" : "above";
        reticle.current.style.transform = `translate3d(${rect.x.toFixed(1)}px, ${rect.y.toFixed(1)}px, 0)`;
        reticle.current.style.width = `${rect.w.toFixed(1)}px`;
        reticle.current.style.height = `${rect.h.toFixed(1)}px`;
      }
      // The line-drawn head mirrors the driver, like the video would.
      const yaw = frame?.event?.head.yawDeg ?? frame?.sample.frame.yaw ?? 0;
      const pitch = frame?.event?.head.pitchDeg ?? frame?.sample.frame.pitch ?? 0;
      s.yaw = approach(s.yaw, Math.max(-60, Math.min(60, yaw)), dt, 70);
      s.pitch = approach(s.pitch, Math.max(-35, Math.min(35, pitch)), dt, 70);
      s.closure = approach(s.closure, frame?.sample.frame.closure ?? 0.1, dt, 35);
      const scale = (rect.h * 1.02) / 240;
      avatar.current?.setAttribute("style", `transform: translate3d(${(rect.x + rect.w / 2 - 100 * scale).toFixed(1)}px, ${(rect.y + rect.h / 2 - 124 * scale).toFixed(1)}px, 0) scale(${scale.toFixed(3)}); transform-origin: 0 0;`);
      features.current?.setAttribute("transform", `translate(${(-s.yaw * 0.9).toFixed(1)} ${(s.pitch * 0.8).toFixed(1)})`);
      head.current?.setAttribute("rx", (70 * (1 - Math.min(0.22, Math.abs(s.yaw) / 220))).toFixed(1));
      [72, 128].forEach((cx, index) => {
        const path = lid(cx, s.closure);
        lids.current[index]?.setAttribute("d", path.upper);
        clips.current[index]?.setAttribute("d", path.clip);
      });
      handle = requestAnimationFrame(loop);
    };
    handle = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(handle);
  }, [live, videoRef]);

  // The corners "lock" when calibration completes.
  const previous = useRef(phase);
  useEffect(() => {
    const element = reticle.current;
    if (previous.current === "calibrating" && phase === "running" && element) {
      element.dataset.locked = "true";
      const timer = setTimeout(() => {delete element.dataset.locked;}, 500);
      previous.current = phase;
      return () => clearTimeout(timer);
    }
    previous.current = phase;
  }, [phase]);

  const tag = phase === "calibrating" ? t("Hiệu chỉnh", "Calibrating") : shownState ? pick(STATE_LABEL[shownState], lang) : "";

  return (
    <div
      ref={lens}
      className={styles.lens}
      data-video={videoOn ? "on" : "off"}
      data-avatar={avatarOn ? "on" : "off"}
      data-face="off"
      data-phase={phase}
      data-severity={active ? severity : "normal"}
      data-testid="driver-lens"
    >
      {/* Frames go from the camera to the model in this tab; nothing records or uploads them. */}
      <video ref={videoRef} className={styles.video} muted playsInline aria-hidden="true" />
      <svg ref={avatar} className={styles.avatar} width="200" height="240" viewBox="0 0 200 240" aria-hidden="true">
        <defs>
          {[0, 1].map(index => (
            <clipPath key={index} id={`${id}-eye-${index}`}><path ref={el => {clips.current[index] = el;}} d={lid(index ? 128 : 72, 0.1).clip} /></clipPath>
          ))}
        </defs>
        <ellipse ref={head} className={styles.avatarHead} cx="100" cy="118" rx="70" ry="94" />
        <g ref={features}>
          {[72, 128].map((cx, index) => (
            <g key={cx}>
              <circle className={styles.avatarIris} cx={cx} cy="104" r="4.6" clipPath={`url(#${id}-eye-${index})`} />
              <path className={styles.avatarFeature} d={`M${cx - 13} 104 Q${cx} 111 ${cx + 13} 104`} />
              <path ref={el => {lids.current[index] = el;}} className={styles.avatarFeature} d={lid(cx, 0.1).upper} />
            </g>
          ))}
          <path className={styles.avatarFeature} d="M100 116 Q97 134 92 140 Q99 143 104 141" />
          <path className={styles.avatarFeature} d="M84 166 Q100 172 116 166" />
          <path className={styles.avatarFeature} d="M58 86 Q72 80 86 85 M114 85 Q128 80 142 86" />
        </g>
      </svg>
      <div ref={reticle} className={styles.reticle} aria-hidden="true">
        <span className={styles.corner} /><span className={styles.corner} /><span className={styles.corner} /><span className={styles.corner} />
        {active && tag && <span className={styles.reticleTag} data-testid="reticle-tag">{tag}</span>}
      </div>
      <div className={styles.lensRing} aria-hidden="true" />
      {phase === "calibrating" && <div className={styles.calibrationSweep} aria-hidden="true" />}

      <div className={styles.chips}>
        <span>
          {source === "webcam" && active && (
            <span className={styles.chip}><span className={styles.liveDot} />{t("Camera trực tiếp", "Live camera")}</span>
          )}
          {source === "simulated" && <span className={`${styles.chip} ${styles.simTag}`} data-testid="sim-tag">{t("Mô phỏng", "Simulated")}</span>}
        </span>
        <span className={styles.chip}><Lock size={12} />{t("0 khung hình gửi đi", "0 frames sent")}</span>
      </div>

      {phase === "calibrating" && (
        <div className={styles.calibration} aria-live="polite">
          <div className={styles.calibrationCopy}>
            <strong>{view.calibration.face ? t("Nhìn thẳng về phía trước", "Look straight ahead") : t("Chưa thấy khuôn mặt, hãy ngồi vào khung hình", "No face yet: sit in front of the camera")}</strong>
            <div className={styles.calibrationTrack}><div className={styles.calibrationFill} style={{transform: `scaleX(${view.calibration.progress})`}} /></div>
          </div>
        </div>
      )}

      {!active && (
        <p className={styles.lensCaption}>{t("Khung hình được xử lý tại đây, không lưu và không gửi đi.", "Frames are analysed here, never stored or sent.")}</p>
      )}

      {(active || phase === "starting") && (
        <div className={styles.controls}>
          {source === "webcam" && active && (
            <button type="button" className={styles.controlButton} aria-pressed={showVideo} onClick={onToggleVideo} title={showVideo ? t("Ẩn video, chỉ hiện hình vẽ", "Hide the video, show the drawing") : t("Hiện video", "Show the video")} aria-label={t("Hiện video", "Show the video")}>
              {showVideo ? <Eye size={17} /> : <EyeOff size={17} />}<span>{showVideo ? t("Ẩn video", "Hide video") : t("Hiện video", "Show video")}</span>
            </button>
          )}
          {source === "webcam" && active && (
            <button type="button" className={styles.controlButton} disabled={phase === "calibrating"} onClick={onRecalibrate} title={t("Hiệu chỉnh lại", "Recalibrate")} aria-label={t("Hiệu chỉnh lại", "Recalibrate")}>
              <ScanFace size={17} /><span>{t("Hiệu chỉnh", "Calibrate")}</span>
            </button>
          )}
          {active && <button type="button" className={styles.controlButton} aria-pressed={view.store.settings.sound} onClick={onToggleSound} title={t("Âm báo", "Alert sound")} aria-label={t("Âm báo", "Alert sound")}>
            {view.store.settings.sound ? <Volume2 size={17} /> : <VolumeX size={17} />}<span>{view.store.settings.sound ? t("Âm bật", "Sound on") : t("Âm tắt", "Muted")}</span>
          </button>}
          <button type="button" className={styles.controlButton} onClick={onStop} title={t("Dừng", "Stop")} aria-label={t("Dừng", "Stop")}>
            <Square size={15} /><span>{t("Dừng", "Stop")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
