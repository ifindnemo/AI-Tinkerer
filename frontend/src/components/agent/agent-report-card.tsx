"use client";
import {ArrowUpRight, MapPin, TriangleAlert, X} from "lucide-react";
import type {AgentReport} from "@/lib/agent/report";
import BookingCard from "./booking-card";
import {severityLabel, stepView, type T} from "./tool-step-view";
import styles from "./agent-dock.module.css";

/**
 * What the car agent just did, in the robot's popup and quick panel: its words, the tools it called, the nearest
 * garage it found and, when it proposes an appointment, the question only the driver can answer.
 * A critical alert says to stop first: the garage is for afterwards.
 */
export default function AgentReportCard({report, t, lang, onClose, onDetails, speaking}: {report: AgentReport; t: T; lang: string; onClose?: () => void; onDetails?: () => void; speaking?: boolean}) {
  const locale = lang === "en" ? "en-GB" : "vi-VN";
  const steps = report.steps.map(step => stepView(step, t, lang));
  const garage = report.garage;
  const ask = !!report.pending;
  // The proposal card already shows this garage's address: the line below then keeps only its name and distance.
  const proposed = report.pending?.payload.garage_id ?? report.appointment?.garage_id;
  const sameAsProposal = !!garage && proposed === garage.name;
  return (
    <section className={styles.report} data-severity={report.severity} data-ask={ask} role={ask || report.severity === "critical" ? "alertdialog" : "status"} aria-label={t("Agent vừa kiểm tra xe", "The agent just checked the car")} data-testid="agent-report">
      <div className={styles.bubbleHead}>
        <span className={styles.bubbleTag}>{severityLabel(report.severity, t)}</span>
        <span className={styles.reportTitle}>{ask ? t("Cần bạn xác nhận", "Needs your confirmation") : t("Agent vừa kiểm tra xe", "The agent just checked the car")}</span>
        {speaking && <span className={styles.bubbleLive}>{t("đang đọc", "speaking")}</span>}
        {onClose && <button type="button" className={styles.bubbleClose} onClick={onClose} aria-label={t("Đóng", "Close")} data-testid="agent-report-close"><X size={14} /></button>}
      </div>
      <p className={styles.reportLead}>{report.lead}</p>
      {report.plan ? (
        <div className={styles.reportPlan} data-code={report.plan.code} data-testid="agent-report-plan">
          <p className={report.stopFirst ? styles.reportStop : styles.reportPlanTitle}>{report.stopFirst && <TriangleAlert size={13} aria-hidden="true" />}{report.plan.title}</p>
          {report.plan.driver === "drowsy" || report.plan.driver === "distracted" ? <small className={styles.reportPlanWhy}>{report.plan.driver === "drowsy" ? t("Camera thấy bạn buồn ngủ, nên phương án khác với khi bạn tỉnh táo.", "The camera sees you are drowsy, so the plan differs from when you are alert.") : t("Camera thấy bạn mất tập trung.", "The camera sees you are distracted.")}</small> : null}
          <ul className={styles.reportOptions} aria-label={t("Phương án", "Options")}>
            {report.plan.options.map(option => <li key={option}>{option}</li>)}
          </ul>
        </div>
      ) : report.stopFirst && <p className={styles.reportStop} data-testid="agent-report-stop"><TriangleAlert size={13} aria-hidden="true" />{t("Dừng xe ở nơi an toàn trước. Garage chỉ để tham khảo sau đó.", "Stop somewhere safe first. The garage is for afterwards.")}</p>}
      {(report.pending || report.appointment) && <BookingCard pending={report.pending} appointment={report.appointment} t={t} lang={lang} />}
      {garage && (sameAsProposal ? (
        <p className={styles.reportNearest} data-testid="agent-report-garage"><MapPin size={13} aria-hidden="true" />{t("Đây là garage gần xe nhất", "This is the garage nearest to the car")} · {garage.distance_km.toLocaleString(locale)} km</p>
      ) : (
        <div className={styles.reportGarage} data-testid="agent-report-garage">
          <MapPin size={14} aria-hidden="true" />
          <span>
            <small>{t("Garage gần nhất", "Nearest garage")}</small>
            <b>{garage.name}</b>
            <small>{garage.distance_km.toLocaleString(locale)} km{garage.address ? ` · ${garage.address.startsWith(garage.name) ? garage.address.slice(garage.name.length).replace(/^[\s,]+/, "") : garage.address}` : ""}</small>
          </span>
        </div>
      ))}
      {steps.length > 0 && (
        <details className={styles.reportTools} data-testid="agent-report-steps">
          <summary>{t(`Agent đã dùng ${steps.length} công cụ`, steps.length === 1 ? "The agent used 1 tool" : `The agent used ${steps.length} tools`)}</summary>
          <ol className={styles.reportSteps} aria-label={t("Agent đã làm gì", "What the agent did")}>
            {steps.map((step, index) => (
              <li key={index} data-ok={step.ok}>
                <span className={styles.reportIcon} aria-hidden="true">{step.icon}</span>
                <span className={styles.reportStep} title={`${step.title}: ${step.detail}`}><b>{step.title}</b><small>{step.detail}</small></span>
              </li>
            ))}
          </ol>
        </details>
      )}
      {onDetails && <button type="button" className={styles.bubbleLink} onClick={onDetails}>{t("Xem chi tiết", "Details")} <ArrowUpRight size={14} /></button>}
    </section>
  );
}
