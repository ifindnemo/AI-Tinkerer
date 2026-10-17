"use client";
import {useCallback, useEffect, useRef, useState} from "react";
import {ChevronLeft, ChevronRight, Maximize, Minimize, Timer} from "lucide-react";
import {useLang} from "@/hooks/use-preferences";
import SiteHeader from "../site/site-header";
import {SLIDES, TOTAL_SECONDS, clampSlide, clock, remaining, slideFromHash} from "./deck";
import {SLIDE_VIEWS} from "./slides";
import styles from "./present.module.css";

const STAGE_W = 1920;
const STAGE_H = 1080;

export default function Present() {
  const {t} = useLang();
  const deck = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [scale, setScale] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [timing, setTiming] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);
  const addressRead = useRef(false);

  const go = useCallback((next: number) => setIndex(clampSlide(next)), []);

  // The address carries the slide (#3), so a reload or a shared link lands in the same place.
  useEffect(() => {
    const read = () => {
      addressRead.current = true;
      setIndex(slideFromHash(location.hash));
    };
    queueMicrotask(read);
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  useEffect(() => {
    if (!addressRead.current) return; // the first render must not overwrite the address it has yet to read
    const wanted = `#${index + 1}`;
    if (location.hash !== wanted && (location.hash !== "" || index !== 0)) history.replaceState(null, "", wanted);
  }, [index]);

  // The 1920 × 1080 stage is scaled to whatever room the window leaves.
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const measure = () => {
      const {width, height} = node.getBoundingClientRect();
      if (width > 0 && height > 0) setScale(Math.min(width / STAGE_W, height / STAGE_H));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === deck.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await deck.current?.requestFullscreen();
    } catch {}
  }, []);

  useEffect(() => {
    if (!timing) return;
    const tick = () => setElapsed((performance.now() - startedAt.current) / 1000);
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [timing]);
  const toggleTimer = useCallback(() => {
    setTiming(on => {
      if (on) return false;
      startedAt.current = performance.now();
      setElapsed(0);
      return true;
    });
  }, []);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || target?.isContentEditable || target?.closest("input,select,textarea")) return;
      const key = event.key.toLowerCase();
      const onControl = !!target?.closest("button,a");
      if (key === "arrowright" || key === "pagedown" || (key === " " && !onControl)) {event.preventDefault(); setIndex(i => clampSlide(i + 1));}
      else if (key === "arrowleft" || key === "pageup") {event.preventDefault(); setIndex(i => clampSlide(i - 1));}
      else if (key === "home") {event.preventDefault(); go(0);}
      else if (key === "end") {event.preventDefault(); go(SLIDES.length - 1);}
      else if (key === "f") toggleFullscreen();
      else if (key === "t") toggleTimer();
      else if (/^[1-9]$/.test(key) && Number(key) <= SLIDES.length) go(Number(key) - 1);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [go, toggleFullscreen, toggleTimer]);

  const left = remaining(elapsed, index);
  return (
    <div className={styles.page}>
      {!fullscreen && <SiteHeader current="present" />}
      <div ref={deck} className={styles.deck} data-fullscreen={fullscreen || undefined}>
        <h1 className={styles.srOnly}>{t("Bài thuyết trình Car Neuron, 7 phút", "Car Neuron talk, 7 minutes")}</h1>
        <div ref={viewport} className={styles.viewport}>
          <div className={styles.frame} style={scale === null ? {visibility: "hidden"} : {width: STAGE_W * scale, height: STAGE_H * scale}}>
            <div className={styles.stage} style={{transform: `scale(${scale ?? 1})`}}>
              {SLIDE_VIEWS.map((View, i) => (
                <section key={SLIDES[i].id} className={styles.layer} data-active={i === index || undefined} data-slide={SLIDES[i].id} aria-roledescription="slide" aria-label={`${i + 1} / ${SLIDES.length}: ${SLIDES[i].title}`} aria-hidden={i !== index} inert={i !== index}>
                  <View />
                </section>
              ))}
            </div>
            <button className={`${styles.edge} ${styles.edgeBack}`} onClick={() => go(index - 1)} disabled={index === 0} aria-label={t("Slide trước", "Previous slide")}><ChevronLeft size={28} /></button>
            <button className={`${styles.edge} ${styles.edgeNext}`} onClick={() => go(index + 1)} disabled={index === SLIDES.length - 1} aria-label={t("Slide sau", "Next slide")}><ChevronRight size={28} /></button>
            <div className={styles.progress} aria-hidden="true">
              {SLIDES.map((slide, i) => <i key={slide.id} style={{flexGrow: slide.seconds}} data-done={i <= index || undefined} />)}
            </div>
          </div>
        </div>
        <p className={styles.srOnly} role="status" aria-live="polite">{`${index + 1} / ${SLIDES.length}: ${SLIDES[index].title}`}</p>
        <div className={styles.controls}>
          <div className={styles.steps}>
            <button className={styles.icon} onClick={() => go(index - 1)} disabled={index === 0} aria-label={t("Slide trước", "Previous slide")}><ChevronLeft size={20} /></button>
            <button className={styles.icon} onClick={() => go(index + 1)} disabled={index === SLIDES.length - 1} aria-label={t("Slide sau", "Next slide")}><ChevronRight size={20} /></button>
          </div>
          <ol className={styles.rail} aria-label={t("Các slide", "Slides")}>
            {SLIDES.map((slide, i) => (
              <li key={slide.id}>
                <button onClick={() => go(i)} aria-current={i === index ? "step" : undefined}>
                  <span>{slide.title}</span>
                  <small>{clock(slide.seconds)}</small>
                  <i style={{width: `${Math.max(8, (slide.seconds / 180) * 100)}%`}} />
                </button>
              </li>
            ))}
          </ol>
          <div className={styles.tools}>
            {timing && <span className={styles.clock} data-over={left < 0 || undefined} role="timer" aria-label={t("Thời gian", "Time")}>{clock(elapsed)} / {clock(TOTAL_SECONDS)}<small>{left >= 0 ? t(`còn ${clock(left)}`, `${clock(left)} left`) : t(`quá ${clock(-left)}`, `${clock(-left)} over`)}</small></span>}
            <button className={styles.tool} onClick={toggleTimer} aria-pressed={timing}><Timer size={18} />{timing ? t("Dừng giờ", "Stop timer") : t("Bấm giờ", "Timer")}</button>
            <button className={styles.tool} onClick={toggleFullscreen}>{fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}{fullscreen ? t("Thoát", "Exit") : t("Toàn màn hình", "Fullscreen")}</button>
          </div>
        </div>
        <p className={styles.rotate}>{t("Slide được vẽ cho màn hình ngang: xoay điện thoại hoặc mở trên máy tính.", "The slides are drawn for a landscape screen: rotate your phone or open this on a computer.")}</p>
        <p className={styles.hint}>{t("Phím tắt: ← → chuyển slide · 1–5 nhảy tới slide · F toàn màn hình · T bấm giờ", "Keys: ← → move · 1–5 jump · F fullscreen · T timer")}</p>
      </div>
    </div>
  );
}
