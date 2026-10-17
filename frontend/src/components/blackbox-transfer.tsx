"use client";
import {Activity, ArrowDownToLine, ArrowRight, Check, Download, LoaderCircle, Radio, Send, Sparkles, WifiOff} from "lucide-react";
import {useLang} from "@/hooks/use-preferences";
import type {BackendState} from "@/lib/backend/contract";
import type {BlackboxTransfer} from "@/lib/blackbox/types";
import type {Telemetry} from "@/lib/telemetry";
import {operatingUnit} from "@/lib/telemetry-profile";

function downloadBatch(t: BlackboxTransfer) {
  if (!t.lastBatch) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(t.lastBatch, null, 2)], {type: "application/json"}));
  const a = document.createElement("a");
  a.href = url;
  a.download = `blackbox-${t.lastBatch.vehicleId}-${t.lastBatch.batchId}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function BlackboxTransferStatus({transfer:t,backend}:{transfer:BlackboxTransfer;backend?:BackendState}){
  const {t:tx}=useLang();
  return <div className="blackbox-transfer" aria-label={tx("Gói dữ liệu blackbox","Blackbox data batch")}>
    <div><Radio size={15}/><span>{tx(`1 giây / mẫu · ${t.target} mẫu / gói`,`1 sample / s · ${t.target} samples / batch`)}</span><span data-testid="batch-buffer">{tx(`Đang gom ${t.buffered}/${t.target}`,`Collecting ${t.buffered}/${t.target}`)}</span></div>
    <div><span>{backend ? backend.phase === "sending" ? tx("Đang gửi backend…","Sending to backend…") : backend.phase === "error" ? tx("Gửi chưa hoàn tất","Send not completed") : backend.reply ? tx("Backend đã nhận gói gần nhất","Backend received the latest batch") : tx("Chờ đủ gói để gửi backend","Waiting for a full batch") : tx("Gói dữ liệu cục bộ · Chưa gửi backend","Local batch · Not sent to a backend")}</span><button className="outline-button" disabled={!t.lastBatch} onClick={()=>downloadBatch(t)}><Download size={14}/>{tx(`JSON ${t.lastBatch?.recordCount ?? t.target} mẫu`,`JSON ${t.lastBatch?.recordCount ?? t.target} samples`)}</button></div>
  </div>;
}

export function BlackboxBatchStation({
  transfer: t,
  backend,
  telemetry,
  onFlushNow,
  onInject,
  onViewTelemetry,
  onExportReport,
  hasReport,
}: {
  transfer: BlackboxTransfer;
  backend: BackendState;
  telemetry: Telemetry;
  onFlushNow: () => void;
  onInject: () => void;
  onViewTelemetry: () => void;
  onExportReport?: () => void;
  hasReport?: boolean;
}) {
  const {t: tx, time} = useLang();
  const connected = telemetry.connected;
  const busy = backend.phase === "sending";
  const phase = !connected ? "paused" : backend.phase;
  const target = t.target ?? 15;
  const currentStep = !connected || phase === "error" || phase === "paused" ? null : busy ? 1 : phase === "ready" && backend.reply ? 2 : 0;
  const statusText = !connected
    ? tx("Blackbox ngoại tuyến · Tạm dừng thu thập", "Blackbox offline · Collection paused")
    : busy
      ? tx("Đang gửi gói mẫu sang Backend & chạy Agent…", "Sending sample batch to Backend & running Agent…")
      : phase === "error"
        ? tx("Gửi gói chưa hoàn tất · Sẽ thử lại ở chu kỳ kế tiếp", "Batch send incomplete · Will retry next cycle")
        : backend.reply
          ? tx(`Backend đã xử lý gói ${backend.reply.accepted} mẫu lúc ${time(backend.reply.completedAt)}`, `Backend processed ${backend.reply.accepted}-sample batch at ${time(backend.reply.completedAt)}`)
          : tx("Đang thu thập mẫu ECU trực tiếp (1 Hz)", "Collecting live ECU samples (1 Hz)");

  const steps = [
    {
      title: tx("Thu thập mẫu ECU", "Collect ECU samples"),
      sub: tx(`Đệm 1 mẫu/giây · Gói ${target} mẫu`, `1 sample/s buffer · ${target}-sample batch`),
    },
    {
      title: tx("Gửi gói & Chạy Agent", "Send batch & Run Agent"),
      sub: tx("Luật an toàn cứng + LLM + Tool", "Hard safety rules + LLM + Tools"),
    },
    {
      title: tx("Nhận định & Hành động", "Assessment & Action"),
      sub: tx("Đồng bộ lên bảng Agent & Giọng nói", "Synced to Agent panel & Voice"),
    },
  ];

  return (
    <section
      id="blackbox-station"
      className="blackbox-station dash-section"
      data-testid="blackbox-station"
      aria-label={tx("Trạm thu thập và gửi mẫu cho Agent", "Blackbox sample collection and Agent transfer station")}
    >
      <div className="section-heading">
        <div>
          <span className="section-kicker">{tx("LUỒNG DỮ LIỆU BLACKBOX → CAR NEURON AGENT", "BLACKBOX STREAM → CAR NEURON AGENT")}</span>
          <h2>
            {tx("Trạm thu thập & Gửi mẫu cho Agent", "Blackbox Batch & Agent Pipeline")}{" "}
            <span>{tx(`1 GIÂY / MẪU · ${target} MẪU / GÓI`, `1 SAMPLE / S · ${target} SAMPLES / BATCH`)}</span>
          </h2>
        </div>
        <button className="agent-inspect-button station-table-link" onClick={onViewTelemetry}>
          {tx("Xem dữ liệu blackbox", "View blackbox data")} <ArrowRight size={15} />
        </button>
      </div>

      <div className="blackbox-station-card">
        <div className="station-top-bar">
          <div className="station-live-status" data-phase={phase}>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : !connected || backend.api === "offline" ? (
              <WifiOff size={16} />
            ) : (
              <span className="agent-live-dot" />
            )}
            <b>{statusText}</b>
          </div>
          <ol className="agent-cycle-steps station-cycle-steps" aria-label={tx("Chu kỳ xử lý mẫu", "Sample processing cycle")}>
            {steps.map((s, i) => (
              <li
                key={i}
                className={currentStep !== null && i <= currentStep ? "active" : ""}
                data-state={currentStep === i ? "current" : currentStep !== null && i < currentStep ? "done" : "pending"}
                aria-current={currentStep === i ? "step" : undefined}
              >
                <span>{currentStep !== null && i < currentStep ? <Check size={12} /> : i + 1}</span>
                <div>
                  <strong>{s.title}</strong>
                  <small>{s.sub}</small>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="station-body">
          <div className="station-progress-col">
            <div className="station-progress-header">
              <div className="station-progress-title">
                <Radio size={16} />
                <span>
                  {target < 15
                    ? tx("Lô đầu tiên của kịch bản mới (chốt sớm 5 mẫu)", "First batch of the new scenario (early 5-sample flush)")
                    : tx("Tiến trình đóng gói lô dữ liệu tiếp theo", "Next data batch packaging progress")}
                </span>
              </div>
              <div className="station-progress-badges">
                <span className="station-buffer-pill" data-testid="batch-buffer">
                  {tx(`Đang gom ${t.buffered}/${target}`, `Collecting ${t.buffered}/${target}`)}
                </span>
                <b>
                  {t.buffered}/{target} {tx("mẫu", "samples")}
                </b>
              </div>
            </div>

            <div
              className="agent-sample-segments station-segments"
              style={{gridTemplateColumns: `repeat(${target}, 1fr)`}}
              role="progressbar"
              aria-label={tx("Mẫu đã thu thập", "Samples collected")}
              aria-valuemin={0}
              aria-valuemax={target}
              aria-valuenow={t.buffered}
            >
              {Array.from({length: target}, (_, i) => (
                <span key={i} className={connected && i < t.buffered ? "filled" : ""}>
                  <em>{i + 1}</em>
                </span>
              ))}
            </div>

            <div className="station-sample-strip" aria-label={tx("Mẫu cảm biến đang đệm", "Buffered sensor sample")}>
              <span className="strip-label">
                <Sparkles size={13} />
                {tx("Mẫu vừa ghi nhận vào gói:", "Latest sample in buffer:")}
              </span>
              <div className="strip-metrics">
                <span>
                  <small>RPM</small>
                  <b>{connected ? `${telemetry.rpm} rpm` : "—"}</b>
                </span>
                <span>
                  <small>{tx("Tốc độ", "Speed")}</small>
                  <b>{connected ? `${telemetry.speed} ${operatingUnit(telemetry, "speed")}` : "—"}</b>
                </span>
                <span>
                  <small>{tx("Nước làm mát", "Coolant")}</small>
                  <b>{connected ? `${telemetry.coolant}°C` : "—"}</b>
                </span>
                <span>
                  <small>{tx("Dầu máy", "Oil")}</small>
                  <b>{connected ? `${telemetry.oil}°C` : "—"}</b>
                </span>
                <span>
                  <small>{tx("Điện áp", "Battery")}</small>
                  <b>{connected ? `${telemetry.battery}V` : "—"}</b>
                </span>
                <span>
                  <small>DTC</small>
                  <b>{connected ? telemetry.dtc.join(", ") || tx("Không lỗi", "None") : "—"}</b>
                </span>
              </div>
            </div>

            <p className="station-caption">
              {!connected
                ? tx("Dừng gửi khi blackbox ngoại tuyến.", "Sending pauses while the blackbox is offline.")
                : target < 15
                  ? tx(
                      `Gửi sớm sau ${target} mẫu để agent phản ứng nhanh; các lô sau tự động quay về đủ 15 mẫu.`,
                      `Sent early after ${target} samples so the agent reacts quickly; later batches return to 15 samples.`,
                    )
                  : tx(
                      "1 mẫu/giây · tự động đóng gói 15 mẫu mỗi lượt và gửi tới Car Neuron Agent; chờ nếu lượt trước chưa xử lý xong.",
                      "1 sample/s · automatically packages 15 samples per batch for Car Neuron Agent; waits if the previous batch is still running.",
                    )}
            </p>
          </div>

          <div className="station-actions-col">
            <div className="station-action-group">
              <span className="station-action-label">{tx("Điều khiển gửi mẫu & thử nghiệm", "Batch transfer & test controls")}</span>
              <button
                className="primary-button station-send-btn"
                data-testid="batch-flush-now"
                disabled={!connected || busy || (target <= 5 && t.buffered < 5)}
                onClick={onFlushNow}
              >
                {busy ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />}
                <span>
                  {busy
                    ? tx("Agent đang phân tích gói…", "Agent is analysing batch…")
                    : t.buffered >= 5
                      ? tx(`Gửi ngay ${t.buffered} mẫu hiện có cho Agent`, `Send ${t.buffered} buffered samples to Agent now`)
                      : target <= 5
                        ? tx(`Đang chốt sớm ở mẫu thứ 5 (${t.buffered}/5)…`, `Early flush armed at 5 samples (${t.buffered}/5)…`)
                        : tx("Chốt & gửi gói sớm (tối thiểu 5 mẫu)", "Flush & send batch early (min 5 samples)")}
                </span>
              </button>

              <div className="periodic-demo-control station-demo-control">
                <span>
                  <Activity size={13} />
                  {tx("Dữ liệu thử nghiệm · thời gian rút gọn", "Test data · compressed time")}
                </span>
                <button disabled={!connected || busy} onClick={onInject}>
                  {tx("Mô phỏng quá nhiệt", "Inject overheating")} <ArrowRight size={12} />
                </button>
              </div>
            </div>

            <div className="station-export-row">
              <button className="outline-button" disabled={!t.lastBatch} onClick={() => downloadBatch(t)}>
                <Download size={14} />
                {tx(`JSON ${t.lastBatch?.recordCount ?? target} mẫu`, `JSON ${t.lastBatch?.recordCount ?? target} samples`)}
              </button>
              {onExportReport && (
                <button
                  className="outline-button"
                  disabled={!hasReport}
                  onClick={onExportReport}
                  aria-label={tx("Xuất báo cáo JSON", "Export JSON report")}
                >
                  <ArrowDownToLine size={14} />
                  {tx("Xuất báo cáo chẩn đoán", "Export diagnosis JSON")}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

