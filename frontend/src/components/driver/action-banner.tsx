"use client";
import {OctagonAlert, TriangleAlert} from "lucide-react";
import {useLang} from "@/hooks/use-preferences";
import {pick} from "@/lib/preferences";
import type {DriverSeverity} from "@/lib/driver/types";
import type {GuardianBlock} from "@/lib/guardian/types";
import {ACTION_LABEL} from "./guardian-board";
import styles from "./driver.module.css";

const decimal = (value: number, lang: string) => value.toLocaleString(lang === "en" ? "en-GB" : "vi-VN", {minimumFractionDigits: 1, maximumFractionDigits: 1});

/** The one sentence a room full of people should read first: what to do now, in large type, with the
 * reasons beside it. It restates the policy's action; it decides nothing and it never waits for the agent. */
export default function ActionBanner({guardian, severity}: {guardian: GuardianBlock; severity: DriverSeverity}) {
  const {t, lang} = useLang();
  if (guardian.action === "continue" || severity === "normal") return null;
  const {vehicle, driver} = guardian;
  const reasons = [
    guardian.action === "stop_engine"
      ? t(`Nước làm mát ${decimal(vehicle.coolantC, lang)} °C, mức dừng bắt buộc`, `Coolant ${decimal(vehicle.coolantC, lang)} °C, mandatory-stop level`)
      : vehicle.level !== "normal" ? t(`Nước làm mát ${decimal(vehicle.coolantC, lang)} °C`, `Coolant ${decimal(vehicle.coolantC, lang)} °C`) : null,
    vehicle.moving ? `${Math.round(vehicle.speedKmh)} km/h` : t("xe đứng yên", "stopped"),
    driver.attention === "low_attention" ? (driver.responded ? t("tài xế đã xác nhận", "driver confirmed") : t("tài xế giảm tỉnh táo", "driver low attention")) : null,
  ].filter(Boolean).join(" · ");
  const Icon = severity === "critical" ? OctagonAlert : TriangleAlert;
  return (
    <div className={styles.actionBanner} data-severity={severity} data-testid="action-banner">
      <Icon size={30} aria-hidden="true" />
      <div>
        <b data-testid="action-banner-text">{pick(ACTION_LABEL[guardian.action], lang)}</b>
        <span>{reasons}</span>
      </div>
    </div>
  );
}
