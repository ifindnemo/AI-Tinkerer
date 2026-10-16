"use client";

import dynamic from "next/dynamic";
import {useEffect, useMemo, useState} from "react";
import {Activity, ArrowRight, FlaskConical, LayoutDashboard, Radio, Server, ShieldCheck, TriangleAlert} from "lucide-react";
import {useDeviceStream} from "@/hooks/use-device-stream";
import {useLang} from "@/hooks/use-preferences";
import {usePresenter} from "@/hooks/use-presenter";
import type {AgentMode} from "@/lib/preferences";
import {pick} from "@/lib/preferences";
import type {BackendState, BatchReply} from "@/lib/backend/contract";
import {isConnected, latestSample, latestValues, toTelemetry} from "@/lib/device/state";
import {SIGNALS, formatSignal} from "@/lib/device/signals";
import type {DeviceAnalysis, DeviceState, SignalName} from "@/lib/device/types";
import type {Analysis} from "@/lib/telemetry";
import {vehicles} from "@/lib/vehicles";
import BackendAgentPanel from "../backend-agent-panel";
import GarageCamera from "../driver/garage-camera";
import type {VehicleSnapshot} from "@/lib/guardian/types";
import SiteHeader from "../site/site-header";
import DtcCard from "./dtc-card";
import LiveMetrics from "./live-metrics";
import VehicleProfileCard, {profileName} from "./vehicle-profile";
import AgentDock from "../agent/agent-dock";
import {useAgentPresence} from "../agent/use-agent-presence";

const CarViewer = dynamic(() => import("../car-viewer"), {ssr: false});
type Tab = "overview" | "data";
const severityClass = {normal: "good", warning: "watch", critical: "critical"} as const;

function toBatchReply(analysis: DeviceAnalysis): BatchReply {
  return {
    batchId: analysis.id,
    vehicleId: analysis.vehicle_id,
    accepted: analysis.record_count,
    completedAt: analysis.created_at,
    latest: analysis.reply,
    incident: analysis.reply.incident ?? null,
  };
}

function toAnalysis(analysis: DeviceAnalysis, title: string, vehicleName: string): Analysis {
  const a = analysis.reply.assessment;
  return {
    id: analysis.id, vehicleId: analysis.vehicle_id, vehicleName, powertrain: "ice", createdAt: analysis.created_at,
    severity: severityClass[a.severity], score: null, source: "backend", cause: "unclassified",
    title, summary: a.diagnosis, evidence: a.evidence, recommendations: a.recommendations,
  };
}

/** The live OBD values the driver camera combines with the driver, or null while they are missing. */
function cameraSnapshot(capturedAt: string | undefined, speed?: number, coolant?: number, load?: number, simulated = false): VehicleSnapshot | null {
  if (!capturedAt || speed === undefined || coolant === undefined || !Number.isFinite(speed) || !Number.isFinite(coolant)) return null;
  return {source: simulated ? "simulated" : "obd", capturedAt, speedKmh: speed, coolantC: coolant, engineLoadPct: load !== undefined && Number.isFinite(load) ? load : null, drivingMinutes: null};
}

/** Browser time, refreshed every few seconds, for "is the device still sending?" */
function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export default function LiveGarage({mode, setMode}: {mode: AgentMode; setMode: (mode: AgentMode) => void}) {
  const vehicle = vehicles[0];
  const {t, lang, time} = useLang();
  const presenter = usePresenter();
  const state: DeviceState = useDeviceStream(vehicle.id);
  const now = useNow(2000);
  const [tab, setTab] = useState<Tab>("overview");
  const connected = isConnected(state, now);
  const telemetry = useMemo(() => toTelemetry(state, vehicle.id, connected), [state, vehicle.id, connected]);
  const simulated = state.trip?.simulated ?? state.analysis?.simulated ?? false;
  const profile = state.profile;
  const current = latestValues(state.samples);
  const available: SignalName[] = profile?.known ? profile.supported_signals : SIGNALS.map(s => s.name).filter(name => current[name] !== undefined);
  const missing: SignalName[] = profile?.known ? profile.missing_signals : [];
  const analysis = state.analysis;
  const last = latestSample(state);
  // Live OBD values for the camera's Guardian policy; signals the car does not report stay absent.
  const lastAt = connected ? last?.capturedAt : undefined;
  const speed = current.speed, coolant = current.coolant, load = current.engineLoad;
  const cameraVehicle = cameraSnapshot(lastAt, speed, coolant, load, simulated);
  const severity = analysis?.reply.assessment.severity;
  const verdictTitle = severity === "critical" ? t("Cảnh báo an toàn từ agent", "Safety alert from the agent") : severity === "warning" ? t("Agent đề xuất kiểm tra xe", "The agent recommends an inspection") : t("Agent chưa ghi nhận bất thường", "No anomaly found by the agent");
  // The 3D model is illustrative; never name the connected car after it.
  const carName = profileName(profile, t("Xe của bạn", "Your car"));
  useAgentPresence({
    phase: state.status === "reconnecting" ? "offline" : connected ? "ready" : "nodata",
    severity: analysis?.reply.assessment.severity ?? "normal",
    analysisId: analysis?.id ?? null,
    diagnosis: analysis?.reply.assessment.diagnosis ?? null,
    reply: analysis?.reply ?? null,
  });
  const backendState: BackendState = {
    phase: connected ? (analysis ? "ready" : "collecting") : "paused",
    api: state.status === "live" ? "online" : state.status === "reconnecting" ? "offline" : "checking",
    error: state.status === "reconnecting" ? t("Mất kết nối luồng dữ liệu từ backend, đang thử lại…", "Lost the data stream from the backend; retrying…") : "",
    reply: analysis ? toBatchReply(analysis) : null,
    incident: analysis?.reply.incident ?? null,
    history: state.analyses.map(toBatchReply),
    skipped: 0,
  };
  const chip = state.status !== "live" ? t("Đang kết nối…", "Connecting…") : !connected ? t("Thiết bị chưa gửi dữ liệu", "Device not sending") : simulated ? t("LIVE · thiết bị giả lập", "LIVE · simulated device") : t("LIVE · OBD", "LIVE · OBD");
  const healthClass = severity ? severityClass[severity] : "pending";
  const tabs: {id: Tab; label: string; icon: React.ReactNode}[] = [
    {id: "overview", label: t("Tổng quan", "Overview"), icon: <LayoutDashboard size={16} />},
    {id: "data", label: t("Dữ liệu OBD", "OBD data"), icon: <Activity size={16} />},
  ];

  return (
    <div className="app theme-studio live-garage">
      <SiteHeader current="garage">
      <div className="app-bar">
        <div className="app-bar-inner">
          <nav className="app-tabs" aria-label={t("Điều hướng garage", "Garage navigation")}>
            {tabs.map(item => (
              <button key={item.id} className="app-tab" aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)}>{item.icon}{item.label}</button>
            ))}
          </nav>
          <div className="app-bar-tools">
            {!presenter && (
              <div className="segmented" role="group" aria-label={t("Nguồn dữ liệu", "Data source")}>
                <button aria-pressed={mode === "device"} onClick={() => setMode("device")} title={t("Dữ liệu trực tiếp từ thiết bị OBD qua backend", "Live data from the OBD device via the backend")}><Radio size={12} />OBD</button>
                <button aria-pressed={mode === "backend"} onClick={() => setMode("backend")} title={t("Telemetry mô phỏng trong trình duyệt, agent ở backend", "Browser-simulated telemetry, agent in the backend")}><Server size={12} />API</button>
                <button aria-pressed={mode === "mock"} onClick={() => setMode("mock")} title={t("Chạy hoàn toàn trong trình duyệt, không cần mạng", "Runs entirely in the browser, no network needed")}><FlaskConical size={12} />{t("Mô phỏng", "Mock")}</button>
              </div>
            )}
          </div>
        </div>
      </div>
      </SiteHeader>
      <main className="dash">
        <section className="vehicle-bar" aria-label={t("Xe đang theo dõi", "Monitored car")}>
          <div className="vehicle-bar-id">
            <span className="section-kicker">{t("XE CỦA BẠN", "YOUR CAR")}</span>
            <h1 data-testid="live-car-name">{carName}</h1>
            <div className="vehicle-meta">
              <span>{profile?.vin ? `VIN ${profile.vin}` : t("Chưa đọc được VIN", "VIN not read yet")}</span>
              <span>{profile?.protocol ?? "OBD-II"}</span>
              {state.trip && <span>{t("Chuyến", "Trip")} {time(state.trip.started_at)} · {state.trip.distance_km.toLocaleString(lang === "en" ? "en-GB" : "vi-VN")} km</span>}
            </div>
          </div>
          <div className="live-vehicle-strip" aria-label={t("Trạng thái luồng dữ liệu", "Data stream status")}>
            <span className={`live-chip ${connected ? "" : "off"}`} data-testid="live-chip"><span className={`status-dot ${connected ? "" : "off"}`} />{chip}</span>
            <span className="live-item"><small>{t("Mẫu cuối", "Last sample")}</small><b data-testid="live-timestamp">{last ? time(last.capturedAt) : "—"}</b></span>
            <span className="live-item"><small>{t("Mã lỗi", "Fault codes")}</small><b>{state.dtc?.codes.length ? state.dtc.codes.map(c => c.code).join(", ") : state.dtc?.read_at ? t("Không có", "None") : "—"}</b></span>
          </div>
        </section>

        {tab === "overview" && (
          <>
            <section className={`health-overview ${healthClass}`} aria-label={t("Tình trạng xe", "Vehicle status")}>
              <div className="health-overview-icon">{healthClass === "watch" || healthClass === "critical" ? <TriangleAlert size={22} /> : <ShieldCheck size={22} />}</div>
              <div className="health-overview-copy">
                <span className="section-kicker">{t("TÌNH TRẠNG XE · TỰ ĐỘNG THEO DÕI", "VEHICLE STATUS · AUTO-MONITORED")}</span>
                <h2>{analysis ? verdictTitle : connected ? t("Đang chờ nhận định đầu tiên…", "Waiting for the first assessment…") : t("Chưa có dữ liệu từ thiết bị", "No data from the device yet")}</h2>
                <p>{analysis ? analysis.reply.assessment.diagnosis : t("Agent đánh giá khi bắt đầu chuyến, khi có dấu hiệu bất thường và 5 phút một lần.", "The agent assesses at the start of a trip, on warning signs and every 5 minutes.")}</p>
                <small>{analysis?.engine === "rules" ? t("Đánh giá theo luật", "Rule-based assessment") : t("Agent AI", "AI agent")} · {simulated ? t("dữ liệu thiết bị giả lập", "simulated device data") : t("dữ liệu đọc từ xe", "data read from the car")} · {t("cần kiểm tra kỹ thuật để xác nhận", "confirm with a technical check")}</small>
              </div>
            </section>
            <div className="overview-grid">
              <div className="overview-main">
                <section className="vehicle-card" aria-label="Garage 3D">
                  <CarViewer vehicle={vehicle} color="#e9eded" scanning={false} telemetry={telemetry} analysis={analysis && connected ? toAnalysis(analysis, verdictTitle, carName) : null} source={simulated ? "simulated" : "obd"} />
                  <div className="vehicle-footer">
                    <span className="viewer-caption">{t("Mô hình 3D minh họa, không phải mẫu xe đang kết nối.", "Illustrative 3D model, not the connected car.")}</span>
                    <div className="model-credit">
                      <a href={vehicle.source} target="_blank" rel="noreferrer">{vehicle.author} ↗</a>
                      <span>{vehicle.license}</span>
                    </div>
                  </div>
                </section>
                <section className="dash-section telemetry-section" aria-label={t("Thông số trực tiếp", "Live readings")}>
                  <div className="section-heading">
                    <h2>{t("Thông số trực tiếp", "Live readings")} <span>OBD-II</span></h2>
                    <button className="text-button" onClick={() => setTab("data")}>{t("Bảng dữ liệu đầy đủ", "Full data table")} <ArrowRight size={15} /></button>
                  </div>
                  {available.length === 0 ? (
                    <p className="dtc-empty">{t("Chưa nhận được dữ liệu cảm biến.", "No sensor data received yet.")}</p>
                  ) : (
                    <LiveMetrics available={available} missing={missing} samples={state.samples} telemetry={telemetry} />
                  )}
                </section>
                <DtcCard dtc={state.dtc} />
              </div>
              <aside className="insights-column">
                <GarageCamera vehicleId={vehicle.id} vehicle={cameraVehicle} />
                <BackendAgentPanel
                  state={backendState}
                  connected={connected}
                  onViewTelemetry={() => setTab("data")}
                  device={{simulated, engine: analysis?.engine ?? "agent", fallbackReason: analysis?.fallback_reason ?? null, findings: analysis?.findings ?? []}}
                />
                <VehicleProfileCard profile={profile} vehicleId={vehicle.id} />
              </aside>
            </div>
          </>
        )}

        {tab === "data" && (
          <section className="data-panel dash-section">
            <div className="data-heading">
              <div>
                <h2>{t("Dữ liệu OBD-II", "OBD-II data")}</h2>
                <p>{simulated ? t("Dữ liệu từ thiết bị giả lập (mô phỏng), cập nhật mỗi giây.", "Data from a simulated device, updated every second.") : t("Dữ liệu đọc trực tiếp từ xe qua cổng OBD, cập nhật mỗi giây.", "Read live from the car through the OBD port, updated every second.")}</p>
              </div>
            </div>
            <div className="table-wrap">
              <table data-testid="obd-table">
                <thead><tr><th>{t("Tín hiệu", "Signal")}</th><th>{t("Giá trị", "Value")}</th><th>PID</th><th>{t("Trạng thái", "Status")}</th></tr></thead>
                <tbody>
                  {SIGNALS.map(signal => {
                    const supported = available.includes(signal.name);
                    return (
                      <tr key={signal.name} className={supported ? undefined : "unsupported"}>
                        <td>{pick(signal.label, lang)}</td>
                        <td>{supported && connected && current[signal.name] !== undefined ? `${formatSignal(signal.name, current[signal.name])} ${signal.unit}` : "—"}</td>
                        <td>{signal.pid}</td>
                        <td>{supported ? t("Xe cung cấp", "Reported") : profile?.known ? t("Xe không cung cấp", "Not reported by the car") : t("Chưa rõ", "Unknown")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="data-timestamp">{t("Mẫu cuối", "Last sample")}: {last ? time(last.capturedAt) : "—"}{last?.location?.fixed ? ` · ${t("vị trí cố định do người dùng nhập", "fixed location entered by the user")}` : ""}</p>
          </section>
        )}
        <footer className="page-footer">
          <span><b>Car Neuron.</b> {t("Kết nối dữ liệu. Thấu hiểu hành trình.", "Connected data. Understood journeys.")}</span>
          <span>{simulated ? t("Thiết bị giả lập", "Simulated device") : "OBD-II"} · Frontend v0.3</span>
        </footer>
      </main>
      <AgentDock session={vehicle.id} anchor="car-agent" />
    </div>
  );
}
