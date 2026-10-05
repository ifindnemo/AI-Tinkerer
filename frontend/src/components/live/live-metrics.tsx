"use client";
import {AlertTriangle} from "lucide-react";
import {useLang} from "@/hooks/use-preferences";
import {pick} from "@/lib/preferences";
import {thermalLabels, thermalLevel} from "@/lib/thermal-status";
import type {Telemetry} from "@/lib/telemetry";
import {SIGNAL, SIGNALS, formatSignal} from "@/lib/device/signals";
import {latestValues} from "@/lib/device/state";
import type {DeviceSample, SignalName} from "@/lib/device/types";
import {Sparkline} from "../vehicle-telemetry";

const THERMAL: Partial<Record<SignalName, "cooling" | "engine">> = {coolant: "cooling", oil: "engine"};

/** Every signal the car reports, live; nothing is shown for signals it lacks. */
export default function LiveMetrics({available, missing, samples, telemetry}: {available: SignalName[]; missing: SignalName[]; samples: DeviceSample[]; telemetry: Telemetry}) {
  const {t, lang} = useLang();
  const latest = latestValues(samples);
  const shown = SIGNALS.filter(signal => available.includes(signal.name));
  return (
    <>
      <div className="metrics-grid live-metrics" data-testid="live-metrics">
        {shown.map(({name, pid, label, unit}) => {
          const sensor = THERMAL[name];
          const level = sensor && telemetry.connected ? thermalLevel(telemetry, sensor) : "normal";
          const values = samples.flatMap(sample => sample.signals[name] === undefined ? [] : [sample.signals[name]!]);
          return (
            <article key={name} className={`metric-card ${telemetry.connected ? level : "unknown"}`} data-signal={name}>
              <div className="metric-label">{pick(label, lang)}{level === "danger" && <AlertTriangle size={16} />}</div>
              <div className="metric-middle">
                <span className="metric-value" data-testid={`signal-${name}`}>{telemetry.connected ? formatSignal(name, latest[name]) : "—"}<small>{unit}</small></span>
                {telemetry.connected && <Sparkline values={values.slice(-30)} warm={level === "watch" || level === "danger"} />}
              </div>
              <div className="metric-sub"><span className={`tiny-dot ${telemetry.connected ? "" : "off"}`} />{sensor ? pick(thermalLabels[level], lang) : `PID ${pid}`}</div>
            </article>
          );
        })}
      </div>
      {missing.length > 0 && (
        <p className="missing-signals" data-testid="missing-signals">
          <b>{t("Xe không cung cấp", "Not reported by this car")}:</b> {missing.map(name => pick(SIGNAL[name].label, lang)).join(" · ")}
        </p>
      )}
    </>
  );
}
