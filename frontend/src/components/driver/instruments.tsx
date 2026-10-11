"use client";
import {useEffect, useRef} from "react";
import {useLang} from "@/hooks/use-preferences";
import {pick} from "@/lib/preferences";
import {DEFAULT_CONFIG} from "@/lib/driver/attention";
import {approach, type LiveChannel} from "@/lib/driver/live";
import type {DriverEvent} from "@/lib/driver/types";
import {DIRECTION_LABEL} from "./labels";
import styles from "./driver.module.css";

const RING = 2 * Math.PI * 52;
const ROAD = DEFAULT_CONFIG.yawAway;

/** Runs `draw(dt)` every animation frame while mounted. */
function useFrameLoop(draw: (dtMs: number) => void) {
  const drawRef = useRef(draw);
  useEffect(() => {drawRef.current = draw;});
  useEffect(() => {
    let handle = 0;
    let last = performance.now();
    const loop = (now: number) => {
      drawRef.current(Math.min(100, now - last));
      last = now;
      handle = requestAnimationFrame(loop);
    };
    handle = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(handle);
  }, []);
}

const lidPath = (closure: number) => {
  // Upper lid: arched when open (control y −22), lying on the lower lid when closed (+12).
  const y = -22 + 34 * Math.min(1, Math.max(0, closure));
  return {upper: `M-30 0 Q0 ${y.toFixed(2)} 30 0`, clip: `M-30 0 Q0 ${y.toFixed(2)} 30 0 Q0 14 -30 0Z`};
};

/** An eye whose upper lid follows the measured eye score, inside a ring that fills toward the microsleep threshold. */
export function EyeGauge({live, event}: {live: LiveChannel; event: DriverEvent | null}) {
  const {t, lang} = useLang();
  const lid = useRef<SVGPathElement>(null);
  const clip = useRef<SVGPathElement>(null);
  const ring = useRef<SVGCircleElement>(null);
  const shown = useRef({closure: 0.1, ring: 0});
  useFrameLoop(dt => {
    const frame = live.get();
    const closure = frame?.sample.frame.closure ?? 0.1;
    const closedMs = frame?.event?.eyes.closedMs ?? 0;
    shown.current.closure = approach(shown.current.closure, closure, dt, 40);
    shown.current.ring = approach(shown.current.ring, Math.min(1, closedMs / DEFAULT_CONFIG.drowsyClosedMs), dt, 60);
    const path = lidPath(shown.current.closure);
    lid.current?.setAttribute("d", path.upper);
    clip.current?.setAttribute("d", path.clip);
    ring.current?.setAttribute("stroke-dashoffset", (RING * (1 - shown.current.ring)).toFixed(1));
    // A zero-length arc still draws its round cap as a dot.
    ring.current?.setAttribute("stroke-opacity", shown.current.ring > 0.01 ? "1" : "0");
  });
  const closed = event?.eyes.closedMs ?? 0;
  const perclos = event?.eyes.perclos;
  const seconds = (closed / 1000).toLocaleString(lang === "en" ? "en-GB" : "vi-VN", {minimumFractionDigits: 1, maximumFractionDigits: 1});
  return (
    <div className={styles.tile}>
      <span className={styles.tileLabel}>{t("Mắt nhắm liên tục", "Eyes closed for")}</span>
      <svg className={styles.gauge} viewBox="-60 -60 120 120" role="img" aria-label={t("Độ nhắm mắt", "Eye closure")}>
        <circle className={styles.track} r="52" />
        <circle ref={ring} className={styles.progress} r="52" strokeDasharray={RING.toFixed(1)} strokeDashoffset={RING.toFixed(1)} transform="rotate(-90)" />
        <defs><clipPath id="driver-eye-clip"><path ref={clip} d={lidPath(0.1).clip} /></clipPath></defs>
        <circle className={styles.iris} r="10" clipPath="url(#driver-eye-clip)" />
        <path className={styles.eyeLine} d="M-30 0 Q0 14 30 0" />
        <path ref={lid} className={styles.eyeLid} d={lidPath(0.1).upper} />
      </svg>
      <span className={styles.reading} data-testid="eyes-closed">{seconds}<small>{t("giây", "s")}</small></span>
      <span className={styles.tileSub}>
        {perclos === null || perclos === undefined
          ? t("Tỉ lệ nhắm 30 s: đang đo", "30 s closure: measuring")
          : t(`Tỉ lệ nhắm 30 s: ${Math.round(perclos * 100)}%`, `30 s closure: ${Math.round(perclos * 100)}%`)}
      </span>
    </div>
  );
}

/** Seen from above: the road sector ahead, and a head whose nose turns with the measured yaw. */
export function HeadGauge({live, event}: {live: LiveChannel; event: DriverEvent | null}) {
  const {t, lang} = useLang();
  const head = useRef<SVGGElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  const road = useRef<SVGPathElement>(null);
  const shown = useRef({yaw: 0, pitch: 0});
  useFrameLoop(dt => {
    const e = live.get()?.event;
    shown.current.yaw = approach(shown.current.yaw, Math.max(-80, Math.min(80, e?.head.yawDeg ?? 0)), dt, 70);
    shown.current.pitch = approach(shown.current.pitch, Math.max(-40, Math.min(40, e?.head.pitchDeg ?? 0)), dt, 70);
    // The driver's left is drawn on the left (the view is from above, facing the road).
    head.current?.setAttribute("transform", `rotate(${(-shown.current.yaw).toFixed(1)})`);
    dot.current?.setAttribute("cy", (shown.current.pitch * 0.75).toFixed(1));
    road.current?.setAttribute("data-on", String(Math.abs(shown.current.yaw) < ROAD));
  });
  const rad = (ROAD * Math.PI) / 180;
  const sx = 54 * Math.sin(rad);
  const x = sx.toFixed(1);
  const xl = (-sx).toFixed(1);
  const y = (-54 * Math.cos(rad)).toFixed(1);
  const direction = event?.head.direction;
  const away = event?.head.awayMs ?? 0;
  const yaw = event?.head.yawDeg;
  return (
    <div className={styles.tile}>
      <span className={styles.tileLabel}>{t("Hướng đầu", "Head direction")}</span>
      <svg className={styles.gauge} viewBox="-60 -60 120 120" role="img" aria-label={t("Hướng đầu nhìn từ trên xuống", "Head direction seen from above")}>
        <path ref={road} className={styles.road} d={`M0 0 L${xl} ${y} A54 54 0 0 1 ${x} ${y} Z`} data-on="true" />
        <path className={styles.roadEdge} d={`M0 0 L${xl} ${y} M0 0 L${x} ${y}`} />
        <g ref={head}>
          <circle className={styles.headShape} r="20" />
          <path className={styles.nose} d="M-6 -18 L0 -28 L6 -18 Z" />
        </g>
        <line className={styles.pitchScale} x1="52" y1="-30" x2="52" y2="30" />
        <line className={styles.pitchScale} x1="48" y1="0" x2="56" y2="0" />
        <circle ref={dot} className={styles.pitchDot} cx="52" cy="0" r="3.5" />
      </svg>
      <span className={styles.reading} data-testid="head-direction">{direction ? pick(DIRECTION_LABEL[direction], lang) : "—"}</span>
      <span className={styles.tileSub}>
        {yaw !== null && yaw !== undefined ? `${Math.round(Math.abs(yaw))}° · ` : ""}
        {away > 0
          ? t(`rời đường ${(away / 1000).toFixed(1).replace(".", ",")} s`, `off the road ${(away / 1000).toFixed(1)} s`)
          : direction ? t("đang nhìn đường", "watching the road") : t("chưa thấy khuôn mặt", "no face yet")}
      </span>
    </div>
  );
}

export function ConfidenceBar({value}: {value: number | null}) {
  const {t} = useLang();
  const share = value ?? 0;
  return (
    <div className={styles.confidence}>
      <div className={styles.confidenceRow}>
        <span>{t("Độ tin cậy của phép đo · ước lượng, chưa hiệu chuẩn", "Measurement confidence · estimate, not calibrated")}</span>
        <b data-testid="confidence">{value === null ? "—" : `${Math.round(share * 100)}%`}</b>
      </div>
      <div className={styles.confidenceTrack}><div className={styles.confidenceFill} style={{transform: `scaleX(${share})`}} /></div>
    </div>
  );
}
