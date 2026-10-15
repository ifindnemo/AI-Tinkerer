"use client";
import {useSyncExternalStore} from "react";
import {Languages, Volume2, VolumeX} from "lucide-react";
import {useAgentLang, useLang, useVoiceVolume} from "@/hooks/use-preferences";
import {muteStore} from "@/lib/agent/mute";
import {presence} from "@/lib/agent/presence";
import {VOICE_VOLUMES, type AgentLang, type VoiceVolume} from "@/lib/preferences";
import styles from "./agent-settings.module.css";

const LANGUAGES: {value: AgentLang; vi: string; en: string}[] = [
  {value: "auto", vi: "Theo giao diện", en: "Follow interface"},
  {value: "vi", vi: "Tiếng Việt", en: "Vietnamese"},
  {value: "en", vi: "English", en: "English"},
];

/**
 * What the agent answers in and how it sounds: the language of its words and of its voice (one setting, because
 * the voice reads the same words), the voice on or off, and its volume. The horn is the camera's own switch.
 * The language only changes the wording: levels and mandatory steps are the same in both.
 */
export default function AgentSettings() {
  const {t} = useLang();
  const {setting, resolved, setAgentLang} = useAgentLang();
  const [volume, setVolume] = useVoiceVolume();
  const muted = useSyncExternalStore(muteStore.subscribe, muteStore.get, () => false);
  const voice = useSyncExternalStore(presence.subscribe, presence.get, presence.get).voice;
  const spoken = resolved === "en" ? t("tiếng Anh", "English") : t("tiếng Việt", "Vietnamese");
  // `voice.enabled` says whether the backend has a voice for the language the page last polled with.
  const known = voice.lang === resolved ? voice.enabled : null;
  const status = muted ? t("Giọng nói đang tắt: agent vẫn hiện chữ.", "Voice is off: the agent still shows its words.")
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
      <p className={styles.status} role="status" data-testid="agent-voice-status">{status}</p>
    </section>
  );
}
