"use client";
import Link from "next/link";
import {useCallback, useEffect, useRef, useState} from "react";
import {ArrowRight, Download, Maximize, RotateCcw, Video, X} from "lucide-react";
import {useLang} from "@/hooks/use-preferences";
import {pick} from "@/lib/preferences";
import SiteHeader from "../site/site-header";
import {CHAPTERS, TOTAL, chapterAt, clampTime, formatTime, startFromSearch} from "./timeline";
import styles from "./film.module.css";

const FILM = "/film/car-neuron-pitch-210s.mp4";

// The narration is English, so each language shows its own captions.
function selectSubtitles(tracks: TextTrackList | undefined, language: string) {
  if (tracks) for (const track of tracks) track.mode = track.language === language ? "showing" : "disabled";
}

export default function Film() {
  const {t, lang} = useLang();
  const video = useRef<HTMLVideoElement>(null);
  const player = useRef<HTMLDivElement>(null);
  const pendingSeek = useRef<number | null>(null);
  const initialized = useRef(false);
  const [time, setTime] = useState(0);
  const [clean, setClean] = useState(false);
  const [error, setError] = useState(false);

  const seek = useCallback((value: number) => {
    const next = clampTime(value);
    const media = video.current;
    if (media && media.readyState >= 1) media.currentTime = next;
    else pendingSeek.current = next;
    setTime(next);
  }, []);
  const toggle = useCallback(() => {
    const media = video.current;
    if (!media) return;
    if (media.paused) {
      if (media.ended) media.currentTime = 0;
      void media.play().catch(() => {}); // A blocked autoplay leaves the native Play button available.
    } else media.pause();
  }, []);
  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (player.current?.requestFullscreen) await player.current.requestFullscreen();
      else (video.current as (HTMLVideoElement & {webkitEnterFullscreen?: () => void}) | null)?.webkitEnterFullscreen?.();
    } catch {}
  }, []);
  const updateSubtitles = useCallback(() => {
    selectSubtitles(video.current?.textTracks, lang);
  }, [lang]);

  useEffect(() => {
    queueMicrotask(() => setClean(new URLSearchParams(location.search).has("clean")));
  }, []);
  useEffect(() => updateSubtitles(), [updateSubtitles]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || target?.isContentEditable || target?.closest("input,select,textarea,button,a,video")) return;
      const key = event.key.toLowerCase();
      if (key === " " || key === "k") {event.preventDefault(); toggle();}
      else if (key === "arrowright" || key === "arrowleft") {event.preventDefault(); seek((video.current?.currentTime ?? 0) + (key === "arrowright" ? 5 : -5));}
      else if (key === "f") toggleFullscreen();
      else if (key === "c") setClean(value => !value);
      else if (/^[1-9]$/.test(key) && Number(key) <= CHAPTERS.length) seek(CHAPTERS[Number(key) - 1].start);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [seek, toggle, toggleFullscreen]);

  const loaded = useCallback(() => {
    if (initialized.current) return;
    initialized.current = true;
    const start = pendingSeek.current ?? startFromSearch(location.search);
    if (start !== null) seek(start);
    pendingSeek.current = null;
    updateSubtitles();
    // Playback with sound starts on a click; explicit autoplay is muted and respects reduced motion.
    if (start === null && new URLSearchParams(location.search).get("autoplay") === "1" && !matchMedia("(prefers-reduced-motion: reduce)").matches && video.current) {
      video.current.muted = true;
      void video.current.play().catch(() => {});
    }
  }, [seek, updateSubtitles]);
  // A cached media file can load or fail before React attaches its event handlers.
  useEffect(() => {
    queueMicrotask(() => {
      if (video.current?.error) setError(true);
      else if (video.current && video.current.readyState >= 1) loaded();
    });
  }, [loaded]);
  const current = chapterAt(time);
  return (
    <div className={styles.page} data-clean={clean || undefined}>
      {!clean && <SiteHeader current="film" />}
      <main className={styles.main}>
        {!clean && <div className={styles.head}>
          <div>
            <span className={styles.headKicker}>{t("Phim giới thiệu · 3 phút 30 · Full HD", "Intro film · 3 min 30 · Full HD")}</span>
            <h1>{t("Hiểu xe. Hiểu người lái.", "Understand the car. Understand the driver.")}</h1>
            <p>{t("Điều gì Car Neuron đã xây, nó hoạt động ra sao bên trong và những gì đã hỏng trên đường — thuyết minh bằng giọng Blaze tiếng Anh.", "What Car Neuron is, how it works under the hood, and what broke along the way — narrated in English by Blaze.")}</p>
          </div>
          <a href={FILM} download="Car-Neuron-pitch-210s.mp4" className="outline-button"><Download size={16} />{t("Tải video MP4", "Download MP4")}</a>
        </div>}
        <div ref={player} className={styles.player}>
          <video ref={video} className={styles.video} src={FILM} poster="/film/car-neuron-pitch-poster.webp" width={1920} height={1080} controls playsInline preload="metadata"
            aria-label={t("Phim giới thiệu Car Neuron, 3 phút 30", "Car Neuron intro film, 3 minutes 30")}
            onLoadedMetadata={loaded} onTimeUpdate={event => setTime(clampTime(event.currentTarget.currentTime))} onSeeked={event => setTime(clampTime(event.currentTarget.currentTime))}
            onEnded={() => setTime(TOTAL)} onError={() => setError(true)}>
            <track src="/film/car-neuron-pitch-vi.vtt" kind="captions" srcLang="vi" label="Tiếng Việt" />
            <track src="/film/car-neuron-pitch-en.vtt" kind="subtitles" srcLang="en" label="English" />
            {t("Trình duyệt không hỗ trợ video.", "Your browser does not support video.")}
          </video>
          {error && <div className={styles.error} role="alert">
            <p>{t("Chưa tải được video. Bạn có thể tải lại hoặc tải file MP4 để xem.", "The video could not load. Retry or download the MP4 to watch.")}</p>
            <button className="outline-button" onClick={() => {pendingSeek.current = time; initialized.current = false; setError(false); video.current?.load();}}><RotateCcw size={15} />{t("Tải lại video", "Reload video")}</button>
            <a href={FILM} download className="outline-button"><Download size={15} />{t("Tải MP4", "Download MP4")}</a>
          </div>}
          {!clean && <div className={styles.controls}>
            <div className={styles.chapterHead}><span>{t("Chuyển đến phần", "Jump to a chapter")}</span><span>{formatTime(time)} / {formatTime(TOTAL)}</span></div>
            <ol className={styles.chapters} aria-label={t("Các phần của phim", "Film chapters")}>
              {CHAPTERS.map((chapter, i) => <li key={chapter.id}>
                <button aria-current={i === current ? "step" : undefined} onClick={() => seek(chapter.start)}>
                  <i>{String(i + 1).padStart(2, "0")}</i><span>{pick(chapter.title, lang)}</span><small>{formatTime(chapter.start)}</small>
                </button>
              </li>)}
            </ol>
            <div className={styles.viewActions}>
              <p>{t("Hình ảnh minh họa kịch bản demo. Thuyết minh tiếng Anh (Blaze) và nhạc nền; có phụ đề tiếng Việt và tiếng Anh.", "Illustrative demo scenarios. English narration (Blaze) and background music; Vietnamese and English captions available.")}</p>
              <button className={styles.textButton} onClick={() => setClean(true)}><Video size={15} />{t("Chỉ xem video", "Video only")}</button>
              <button className={styles.textButton} onClick={toggleFullscreen}><Maximize size={15} />{t("Toàn màn hình", "Fullscreen")}</button>
            </div>
          </div>}
        </div>
        {clean && <button className={styles.exitClean} onClick={() => setClean(false)} aria-label={t("Hiện lại giao diện", "Show the interface")}><X size={18} /></button>}
        {!clean && <>
          <div className={styles.below}>
            <div><Link href="/garage" className="outline-button">{t("Mở dashboard xe", "Open vehicle dashboard")}<ArrowRight size={15} /></Link><Link href="/driver" className="primary-button">{t("Trải nghiệm camera", "Try the driver camera")}<ArrowRight size={15} /></Link></div>
            <p>{t("Phím tắt: Space phát/dừng · ← → tua 5 giây · 1–8 chuyển phần · F toàn màn hình · C ẩn giao diện", "Shortcuts: Space play/pause · ← → seek 5 seconds · 1–8 jump to a chapter · F fullscreen · C hide the interface")}</p>
          </div>
          <details className={styles.transcript}>
            <summary>{t("Nội dung phim", "Film transcript")}</summary>
            {CHAPTERS.map(chapter => <div key={chapter.id}><h2>{formatTime(chapter.start)} · {pick(chapter.title, lang)}</h2><p>{pick(chapter.description, lang)}</p></div>)}
          </details>
          <p className={styles.credits}>BMW M2: Outlaw Games™ (CC BY-NC 4.0) · {t("Nhạc", "Music")}: Sascha Ende, ende.app (CC BY 4.0) · {t("Không liên kết với BMW", "Not affiliated with BMW")}</p>
        </>}
      </main>
    </div>
  );
}
