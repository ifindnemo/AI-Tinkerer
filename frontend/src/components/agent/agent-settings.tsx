"use client";
import {useSyncExternalStore} from "react";
import {Languages, Play, RotateCcw, ScanFace, Square, Volume2, VolumeX} from "lucide-react";
import {useAgentLang, useDriverVoice, useLang, useVoiceRate, useVoiceVolume} from "@/hooks/use-preferences";
import {useVoiceOptions} from "@/hooks/use-voice-options";
import {muteStore} from "@/lib/agent/mute";
import {presence} from "@/lib/agent/presence";
import {VOICE_RATES, VOICE_VOLUMES, type AgentLang, type VoiceRate, type VoiceVolume} from "@/lib/preferences";
import styles from "./agent-settings.module.css";

const LANGUAGES: {value: AgentLang; vi: string; en: string}[] = [
  {value: "auto", vi: "Theo giao diện", en: "Follow interface"},
  {value: "vi", vi: "Tiếng Việt", en: "Vietnamese"},
  {value: "en", vi: "English", en: "English"},
];

/**
 * What the agent answers in and how it sounds: the language of its words and of its voice (one setting, because
 * the voice reads the same words), the voice on or off, which Blaze voice reads (per language, with a preview), and its volume. The horn is the camera's own switch.
 * The language only changes the wording: levels and mandatory steps are the same in both.
 */
export default function AgentSettings() {
  const {t} = useLang();
  const {setting, resolved, setAgentLang} = useAgentLang();
  const [volume, setVolume] = useVoiceVolume();
  const [rate, setRate] = useVoiceRate();
  const [driverVoice, setDriverVoice] = useDriverVoice();
  const muted = useSyncExternalStore(muteStore.subscribe, muteStore.get, () => false);
  const voice = useSyncExternalStore(presence.subscribe, presence.get, presence.get).voice;
  const voices = useVoiceOptions(resolved);
  const options = voices.options;
  const current = options?.voices.find(voice => voice.id === options.selected);
  const spoken = resolved === "en" ? t("tiếng Anh", "English") : t("tiếng Việt", "Vietnamese");
  // `voice.enabled` says whether the backend has a voice for the language the page last polled with.
  const known = voice.lang === resolved ? voice.enabled : null;
  const status = muted ? t("Giọng nói đang tắt: agent vẫn hiện chữ.", "Voice is off: the agent still shows its words.")
    : voice.blocked ? t("Trình duyệt chặn phát tiếng. Bấm vào trang một lần để nghe cảnh báo.", "The browser blocked audio. Tap the page once to hear the alert.")
    : known === false ? t(`Giọng ${spoken} chưa cấu hình trên backend: agent vẫn hiện chữ.`, `No ${spoken} voice is configured on the backend: the agent still shows its words.`)
    : known === true ? t(`Agent trả lời và đọc bằng ${spoken}.`, `The agent answers and speaks in ${spoken}.`)
    : t(`Agent trả lời bằng ${spoken}.`, `The agent answers in ${spoken}.`);

  return (
    <section className={styles.settings} aria-label={t("Ngôn ngữ và giọng nói của agent", "Agent language and voice")} data-testid="agent-settings">
      <div className={styles.row}>
        <span className={styles.label} id="agent-lang-label"><Languages size={14} aria-hidden="true" /> {t("Agent trả lời bằng", "Agent answers in")}</span>
        <div className={styles.segments} role="radiogroup" aria-labelledby="agent-lang-label">
          {LANGUAGES.map(option => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={setting === option.value}
              className={styles.segment}
              onClick={() => setAgentLang(option.value)}
              data-testid={`agent-lang-${option.value}`}
            >
              {t(option.vi, option.en)}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.toggle}
          aria-pressed={!muted}
          onClick={() => muteStore.set(!muted)}
          data-testid="agent-voice-toggle"
        >
          {muted ? <VolumeX size={15} aria-hidden="true" /> : <Volume2 size={15} aria-hidden="true" />}
          {muted ? t("Giọng nói: tắt", "Voice: off") : t("Giọng nói: bật", "Voice: on")}
        </button>
        <label className={styles.volume}>
          <span>{t("Âm lượng", "Volume")}</span>
          <input
            type="range"
            min={Number(VOICE_VOLUMES[0])}
            max={Number(VOICE_VOLUMES[VOICE_VOLUMES.length - 1])}
            step={20}
            value={Number(volume)}
            disabled={muted}
            onChange={event => setVolume(String(event.target.value) as VoiceVolume)}
            aria-valuetext={`${volume}%`}
            data-testid="agent-voice-volume"
          />
          <output>{volume}%</output>
        </label>
      </div>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.toggle}
          aria-pressed={driverVoice}
          onClick={() => setDriverVoice(!driverVoice)}
          disabled={muted}
          data-testid="agent-driver-voice-toggle"
        >
          <ScanFace size={15} aria-hidden="true" />
          {driverVoice ? t("Đọc cảnh báo tài xế: bật", "Read driver alerts: on") : t("Đọc cảnh báo tài xế: tắt", "Read driver alerts: off")}
        </button>
        <span className={styles.hint}>{t("Cảnh báo xe vẫn được đọc; còi camera bật/tắt riêng.", "Car alerts are still read; the camera horn has its own switch.")}</span>
      </div>
      {options && options.voices.length > 0 && (
        <div className={styles.row} data-testid="agent-voice-picker">
          <label className={styles.label} htmlFor="agent-voice-select">{t(`Giọng đọc (${spoken})`, `Voice (${spoken})`)}</label>
          <span className={styles.picker}>
            <select
              id="agent-voice-select"
              className={styles.select}
              value={options.selected}
              onChange={event => void voices.choose(event.target.value)}
              data-testid="agent-voice-select"
            >
              {options.voices.map(voice => (
                <option key={voice.id} value={voice.id}>
                  {voice.name}{voice.gender ? ` · ${voice.gender === "Female" ? t("nữ", "female") : t("nam", "male")}` : ""}{voice.id === options.fallback ? t(" · mặc định", " · default") : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => current && voices.preview(current.id)}
              aria-label={t("Nghe thử giọng này", "Preview this voice")}
              title={t("Nghe thử giọng này", "Preview this voice")}
              data-testid="agent-voice-preview"
            >
              {voices.previewing === options.selected ? <Square size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
            </button>
            {options.selected !== options.fallback && (
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => void voices.choose(null)}
                aria-label={t("Về giọng mặc định", "Back to the default voice")}
                title={t("Về giọng mặc định", "Back to the default voice")}
                data-testid="agent-voice-reset"
              >
                <RotateCcw size={13} aria-hidden="true" />
              </button>
            )}
          </span>
        </div>
      )}
      <div className={styles.row}>
        <span className={styles.label} id="agent-rate-label">{t("Tốc độ đọc", "Speaking speed")}</span>
        <div className={styles.segments} role="radiogroup" aria-labelledby="agent-rate-label">
          {VOICE_RATES.map(option => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={rate === option}
              className={styles.segment}
              onClick={() => setRate(option as VoiceRate)}
              data-testid={`agent-voice-rate-${option}`}
            >
              {Number(option) / 100}×
            </button>
          ))}
        </div>
      </div>
      {voices.failed && <p className={styles.status} role="alert" data-testid="agent-voice-error">{t("Chưa lấy hoặc đổi được giọng đọc. Thử lại sau.", "Could not load or change the voice. Try again later.")}</p>}
      <p className={styles.status} role="status" data-testid="agent-voice-status">{status}</p>
    </section>
  );
}
