"use client";
import {CircleCheck, CircleAlert, OctagonAlert, Wrench} from "lucide-react";
import {useLang} from "@/hooks/use-preferences";
import {pick} from "@/lib/preferences";
import {SIGNAL, formatSignal} from "@/lib/device/signals";
import type {DtcCode, DtcStatus, SignalName} from "@/lib/device/types";

function Code({item}: {item: DtcCode}) {
  const {t, lang, time} = useLang();
  const {info} = item;
  const frame = Object.entries(item.freeze_frame ?? {}) as [SignalName, number][];
  return (
    <article className={`dtc-item urgency-${info.urgency}`} data-testid="dtc-item" data-code={item.code}>
      <header>
        <span className="dtc-code">{item.code}</span>
        <span className="dtc-kind">{item.kind === "stored" ? t("Đã lưu", "Stored") : t("Đang chờ xác nhận", "Pending")}</span>
        <span className="dtc-urgency">{info.urgency === "critical" ? <OctagonAlert size={13} /> : <CircleAlert size={13} />}{info.urgency_label}</span>
      </header>
      <h4>{info.title}</h4>
      <p>{info.meaning}</p>
      {frame.length > 0 && (
        <div className="dtc-freeze">
          <b>{t("Lúc mã xuất hiện (freeze frame)", "When the code was set (freeze frame)")}</b>
          <dl>{frame.map(([name, value]) => <div key={name}><dt>{SIGNAL[name] ? pick(SIGNAL[name].label, lang) : name}</dt><dd>{SIGNAL[name] ? `${formatSignal(name, value)} ${SIGNAL[name].unit}` : value}</dd></div>)}</dl>
        </div>
      )}
      {info.checks.length > 0 && (
        <div className="dtc-checks">
          <b><Wrench size={13} />{t("Garage sẽ kiểm tra", "What the garage will check")}</b>
          <ul>{info.checks.map(check => <li key={check}>{check}</li>)}</ul>
        </div>
      )}
      <p className="dtc-advice">{info.advice}</p>
      <small>{t("Ghi nhận lúc", "First seen")} {time(item.first_seen_at)}</small>
    </article>
  );
}

export default function DtcCard({dtc}: {dtc: DtcStatus | null}) {
  const {t, time} = useLang();
  const codes = dtc?.codes ?? [];
  return (
    <section className="dash-section dtc-section" aria-label={t("Mã lỗi động cơ", "Engine fault codes")} data-testid="dtc-card">
      <div className="section-heading">
        <h2>{t("Mã lỗi động cơ", "Engine fault codes")} <span>DTC</span></h2>
        <span className={`dtc-mil ${dtc?.mil ? "on" : ""}`} data-testid="dtc-mil">{dtc?.mil ? t("Đèn check engine đang bật", "Check-engine light on") : t("Đèn check engine tắt", "Check-engine light off")}</span>
      </div>
      {!dtc?.read_at ? (
        <p className="dtc-empty">{t("Chưa đọc mã lỗi trong chuyến này.", "No fault-code read in this trip yet.")}</p>
      ) : codes.length === 0 ? (
        <p className="dtc-empty ok"><CircleCheck size={16} />{t("Xe không báo mã lỗi", "The car reports no fault codes")} · {t("đọc lúc", "read at")} {time(dtc.read_at)}</p>
      ) : (
        <div className="dtc-list">{codes.map(item => <Code key={`${item.code}-${item.kind}`} item={item} />)}</div>
      )}
      {(dtc?.earlier.length ?? 0) > 0 && (
        <details className="dtc-earlier">
          <summary>{t("Mã đã thấy trước đó trong chuyến", "Codes seen earlier in this trip")} ({dtc!.earlier.length})</summary>
          <ul>{dtc!.earlier.map(item => <li key={`${item.code}-${item.kind}`}><b>{item.code}</b> {item.info.title}</li>)}</ul>
        </details>
      )}
      <p className="dtc-note">{t("Car Neuron chỉ đọc mã lỗi; việc xóa mã để garage làm sau khi sửa xong.", "Car Neuron only reads fault codes; clearing them is for the garage after the repair.")}</p>
    </section>
  );
}
