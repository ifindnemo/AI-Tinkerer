"use client";
import Image from "next/image";
import Link from "next/link";
import {useCallback, useEffect, useRef, useState} from "react";
import {ArrowRight, Expand, Minimize, Pause, Play, RotateCcw, Video} from "lucide-react";
import {useLang} from "@/hooks/use-preferences";
import {pick, type Lang} from "@/lib/preferences";
import SiteHeader from "../site/site-header";
import {SCENE_COMPONENTS} from "./scenes";
import {SCENES, SCENE_STARTS, TOTAL, advance, captionAt, formatTime, locate, span, startFromSearch} from "./timeline";
import styles from "./film.module.css";

type Say = (vi: string, en: string) => string;

function Frame({time, say, lang}: {time: number; say: Say; lang: Lang}) {
  const {index, scene, local} = locate(time);
  const Scene = SCENE_COMPONENTS[scene.id];
  const cue = captionAt(scene, local);
  const last = index === SCENES.length - 1;
  const captionOpacity = cue ? span(local, cue.at, cue.at + 0.35) * (last ? 1 : 1 - span(local, scene.duration - 0.35, scene.duration)) : 0;
  return (
    <div className={styles.frame}>
      <div className={styles.backdrop} />
      <Scene t={local} d={scene.duration} say={say} />
      <div className={styles.chromeBrand}>
        <Image src="/brand/car-neuron-logo.png" alt="" width={34} height={34} /><span>Car Neuron<span className={styles.accent}>.</span></span>
      </div>
      <span className={styles.chromeTag}>{say("Minh họa · dữ liệu mô phỏng", "Illustration · simulated data")}</span>
      <span className={styles.chromeIndex}>{String(index + 1).padStart(2, "0")} / {String(SCENES.length).padStart(2, "0")} · {pick(scene.title, lang)}</span>
      {cue && <p className={styles.caption} style={{opacity: captionOpacity}}>{pick(cue.text, lang)}</p>}
    </div>
  );
}

export default function Film() {
  const {t: say, lang} = useLang();
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [clean, setClean] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [scale, setScale] = useState(0);
  const timeRef = useRef(0);
  const player = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const ended = time >= TOTAL;

  const seek = useCallback((value: number) => {
    const next = Math.min(TOTAL, Math.max(0, value));
    timeRef.current = next;
    setTime(next);
  }, []);
  const toggle = useCallback(() => {
    if (timeRef.current >= TOTAL) {seek(0); setPlaying(true); return;}
    setPlaying(value => !value);
  }, [seek]);
  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await player.current?.requestFullscreen();
    } catch {}
  }, []);

  // ?t=42 opens paused at that second, ?clean hides the page chrome for screen recording,
  // ?autoplay=0 waits for a click. Reduced motion never autoplays.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const start = startFromSearch(location.search);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    queueMicrotask(() => {
      if (start !== null) seek(start);
      setClean(params.has("clean"));
      setPlaying(start === null && !reduced && params.get("autoplay") !== "0");
    });
  }, [seek]);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const step = advance(timeRef.current, (now - last) / 1000);
      last = now;
      timeRef.current = step.time;
      setTime(step.time);
      if (step.ended) {setPlaying(false); return;}
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const {width, height} = entry.contentRect;
      setScale(Math.min(width / 1920, height / 1080));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [clean]);

  useEffect(() => {
    const change = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const typing = target?.closest("input, select, textarea");
      const onButton = target?.closest("button, a");
      const key = event.key.toLowerCase();
      if ((key === " " && !onButton && !typing) || key === "k") {event.preventDefault(); toggle();}
      else if (key === "arrowright" && !typing) seek(timeRef.current + 5);
      else if (key === "arrowleft" && !typing) seek(timeRef.current - 5);
      else if (key === "home") seek(0);
      else if (key === "f") toggleFullscreen();
      else if (key === "c") setClean(value => !value);
      else if (/^[1-8]$/.test(key)) seek(SCENE_STARTS[Number(key) - 1]);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [seek, toggle, toggleFullscreen]);

  const current = locate(time).index;
  return (
    <div className={styles.page} data-clean={clean || undefined}>
      {!clean && <SiteHeader current="film" />}
      <main className={styles.main}>
        {!clean && (
          <div className={styles.head}>
            <div>
              <span className={styles.headKicker}>{say("Phim giới thiệu · motion graphic", "Intro film · motion graphic")}</span>
              <h1>{say("Car Neuron trong 80 giây", "Car Neuron in 80 seconds")}</h1>
              <p>{say("Tự chạy từ đầu đến cuối, dùng để mở đầu buổi pitch hoặc quay màn hình làm video. Số liệu theo kịch bản quá nhiệt của bản demo.", "Runs on its own, to open a pitch or to screen-record as a video. Numbers follow the demo's overheating scenario.")}</p>
            </div>
          </div>
        )}
        <div ref={player} className={styles.player} data-fullscreen={fullscreen || undefined}>
          <div ref={box} className={styles.stageBox} onClick={toggle} role="region" aria-label={say("Phim giới thiệu Car Neuron", "Car Neuron intro film")} aria-roledescription="video">
            <div className={styles.stage} style={{transform: `translate(-50%, -50%) scale(${scale})`, visibility: scale ? "visible" : "hidden"}}>
              <Frame time={time} say={say} lang={lang} />
            </div>
            {!playing && !ended && (!clean || time === 0) && (
              <button className={styles.bigPlay} onClick={event => {event.stopPropagation(); toggle();}} aria-label={say("Phát phim", "Play the film")}>
                <Play size={34} />
              </button>
            )}
            {ended && (
              <div className={styles.endCard} onClick={event => event.stopPropagation()}>
                <button className="primary-button" onClick={() => {seek(0); setPlaying(true);}}><RotateCcw size={16} />{say("Xem lại", "Replay")}</button>
                <Link href="/garage" className="outline-button">{say("Mở garage", "Open the garage")} <ArrowRight size={15} /></Link>
              </div>
            )}
          </div>
          {!clean && (
            <div className={styles.controls}>
              <div className={styles.controlRow}>
                <button className={styles.control} onClick={toggle} aria-label={playing ? say("Tạm dừng", "Pause") : say("Phát", "Play")}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
                <button className={styles.control} onClick={() => seek(0)} aria-label={say("Về đầu phim", "Back to start")}><RotateCcw size={17} /></button>
                <span className={styles.clock}>{formatTime(time)} <i>/ {formatTime(TOTAL)}</i></span>
                <div className={styles.scrub}>
                  <div className={styles.track} aria-hidden="true">
                    {SCENES.map((scene, i) => {
                      const fill = Math.min(1, Math.max(0, (time - SCENE_STARTS[i]) / scene.duration));
                      return <span key={scene.id} style={{flexGrow: scene.duration}}><i style={{width: `${fill * 100}%`}} /></span>;
                    })}
                  </div>
                  <input type="range" min={0} max={TOTAL} step={0.1} value={time} onChange={event => seek(Number(event.target.value))} aria-label={say("Tua phim", "Seek")} aria-valuetext={`${formatTime(time)} / ${formatTime(TOTAL)}`} />
                </div>
                <button className={styles.control} onClick={() => setClean(true)} aria-label={say("Chế độ quay: ẩn giao diện (phím C)", "Recording mode: hide the interface (C key)")} title={say("Chế độ quay (C)", "Recording mode (C)")}><Video size={17} /></button>
                <button className={styles.control} onClick={toggleFullscreen} aria-label={fullscreen ? say("Thoát toàn màn hình", "Exit fullscreen") : say("Toàn màn hình (F)", "Fullscreen (F)")}>{fullscreen ? <Minimize size={17} /> : <Expand size={17} />}</button>
              </div>
              <ol className={styles.chapters}>
                {SCENES.map((scene, i) => (
                  <li key={scene.id}>
                    <button aria-current={i === current ? "step" : undefined} onClick={() => seek(SCENE_STARTS[i])}>
                      <i>{String(i + 1).padStart(2, "0")}</i>{pick(scene.title, lang)}<small>{formatTime(SCENE_STARTS[i])}</small>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
        {!clean && <p className={styles.keys}>{say("Phím tắt: Space phát/dừng · ← → tua 5 giây · 1–8 chuyển cảnh · F toàn màn hình · C chế độ quay (ẩn giao diện) · ?t=30 mở tại giây 30", "Shortcuts: Space play/pause · ← → seek 5 s · 1–8 jump to a scene · F fullscreen · C recording mode (hide the interface) · ?t=30 opens at second 30")}</p>}
      </main>
    </div>
  );
}
