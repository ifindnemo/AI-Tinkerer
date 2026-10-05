"use client";
import {overheatCoolant, overheatSecondAt} from "@/lib/live-telemetry";
import {useLang} from "@/hooks/use-preferences";
import {useInView} from "./reveal";
import styles from "./home.module.css";

// Drawn from the same ramp the dashboard streams in the overheating scenario.
const RULE = 120;
const END = 48;
const W = 640, H = 310, PAD = {l: 46, r: 20, t: 34, b: 34};
const Y0 = 90, Y1 = 126;
const x = (s: number) => PAD.l + (s / END) * (W - PAD.l - PAD.r);
const y = (c: number) => PAD.t + (1 - (c - Y0) / (Y1 - Y0)) * (H - PAD.t - PAD.b);
const points = Array.from({length: END * 2 + 1}, (_, i) => i / 2).map(s => [s, overheatCoolant(s).coolant] as const);
const RULE_CROSSING = overheatSecondAt(RULE);
const EARLY = overheatSecondAt(105);
const path = points.map(([s, c], i) => `${i ? "L" : "M"}${x(s).toFixed(1)} ${y(c).toFixed(1)}`).join(" ");

export default function OverheatChart() {
  const {t} = useLang();
  const [ref, visible] = useInView<HTMLDivElement>(0.35);
  const gap = Math.round(RULE_CROSSING - EARLY);
  return (
    <div ref={ref} className={styles.chart} data-visible={visible || undefined}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t(`Biểu đồ nhiệt độ nước làm mát tăng từ 95 lên 122°C trong ${END} giây; luật cứng 120°C kích hoạt ở giây ${RULE_CROSSING.toFixed(0)}.`, `Coolant rising from 95 to 122°C over ${END} seconds; the 120°C hard rule fires at second ${RULE_CROSSING.toFixed(0)}.`)}>
        <defs>
          <linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--danger)" stopOpacity="0.16" />
            <stop offset="1" stopColor="var(--danger)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[95, 105, 115, 125].map(c => (
          <g key={c} className={styles.chartGrid}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(c)} y2={y(c)} />
            <text x={PAD.l - 10} y={y(c) + 4} textAnchor="end">{c}°</text>
          </g>
        ))}
        {[0, 15, 30, 45].map(s => <text key={s} className={styles.chartAxis} x={x(s)} y={H - 10} textAnchor="middle">{s}s</text>)}
        <rect className={styles.chartWindow} x={x(EARLY)} y={PAD.t} width={x(RULE_CROSSING) - x(EARLY)} height={H - PAD.t - PAD.b} />
        <line className={styles.chartRule} x1={PAD.l} x2={W - PAD.r} y1={y(RULE)} y2={y(RULE)} />
        <text className={styles.chartRuleLabel} x={PAD.l + 6} y={y(RULE) - 8}>{t("Luật cứng 120°C", "Hard rule 120°C")}</text>
        <path className={styles.chartArea} d={`${path} L${x(END)} ${y(Y0)} L${x(0)} ${y(Y0)} Z`} fill="url(#chart-fill)" />
        <path className={styles.chartLine} d={path} pathLength={1} />
        <g className={styles.chartEarly} transform={`translate(${x(EARLY)} ${y(overheatCoolant(EARLY).coolant)})`}>
          <circle r="11" className={styles.chartHalo} />
          <circle r="5.5" />
        </g>
        <g className={styles.chartLate} transform={`translate(${x(RULE_CROSSING)} ${y(RULE)})`}>
          <circle r="5.5" />
        </g>
        <g className={styles.chartGap}>
          <line x1={x(EARLY)} x2={x(RULE_CROSSING)} y1={y(RULE) - 20} y2={y(RULE) - 20} />
          <text x={(x(EARLY) + x(RULE_CROSSING)) / 2} y={y(RULE) - 27} textAnchor="middle">{t(`≈ ${gap} giây sớm hơn`, `≈ ${gap} s earlier`)}</text>
        </g>
      </svg>
      <div className={styles.chartLegend}>
        <span><i className={styles.legendEarly} />{t("Agent nhận ra xu hướng · ~105°C", "Agent spots the trend · ~105°C")}</span>
        <span><i className={styles.legendLate} />{t(`Luật cứng kích hoạt · giây ${RULE_CROSSING.toFixed(0)}`, `Hard rule fires · second ${RULE_CROSSING.toFixed(0)}`)}</span>
      </div>
    </div>
  );
}
