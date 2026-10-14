"use client";
import {useLang} from "@/hooks/use-preferences";
import type {DriverAssessment} from "@/lib/driver/types";
import styles from "./driver.module.css";

/** What the safety agent says: its words (or the rule text until they arrive), the steps from the
 * policy, and an honest label for who wrote the words. Severity and steps always come from the rules. */
export function AgentCard({assessment, offline, id = "driver-agent", testId = "driver-agent"}: {assessment: DriverAssessment | null; offline: boolean; id?: string; testId?: string}) {
  const {t} = useLang();
  if (!assessment || assessment.severity === "normal") {
    return (
      <div id={id} tabIndex={-1} className={styles.agent} data-severity="normal" data-testid={testId}>
        <div className={styles.agentHead}>
          <span className={styles.kicker}>Car Neuron Agent</span>
          {offline && <span className={styles.engine}>{t("Backend chưa phản hồi", "Backend not reachable")}</span>}
        </div>
        <p className={styles.agentQuiet}>{assessment ? assessment.summary : t("Agent lên tiếng khi xe hoặc tài xế cần chú ý.", "The agent speaks up when the car or the driver needs attention.")}</p>
      </div>
    );
  }
  const engine = assessment.fallbackReason === "local" ? t("Luật trên thiết bị", "On-device rules")
    : assessment.engine === "agent" ? t("Agent AI · mức và bước do luật", "AI agent · level and steps by rules")
    : assessment.fallbackReason === "pending" ? t("Đánh giá theo luật · agent đang viết…", "Rule-based · the agent is writing…")
    : t("Đánh giá theo luật", "Rule-based");
  return (
    <div id={id} tabIndex={-1} className={styles.agent} data-severity={assessment.severity} data-testid={testId}>
      <div className={styles.agentHead}>
        <span className={styles.kicker}>Car Neuron Agent</span>
        <span className={styles.engine} title={assessment.fallbackReason ?? undefined} data-testid={`${testId}-engine`}>{engine}</span>
      </div>
      <p className={styles.agentSummary}>{assessment.summary}</p>
      <ol className={styles.steps}>
        {assessment.recommendations.map((step, index) => <li key={step} style={{animationDelay: `${120 + index * 80}ms`}}>{step}</li>)}
      </ol>
      {assessment.evidence.length > 0 && <details className={styles.evidence} open={assessment.severity === "critical"}>
        <summary>{t("Cơ sở nhận định", "Evidence")}</summary>
        <ul>{assessment.evidence.map(item => <li key={item}>{item}</li>)}</ul>
      </details>}
    </div>
  );
}
