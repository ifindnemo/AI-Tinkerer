"use client";

import dynamic from "next/dynamic";
import { useVehicleSession } from "@/hooks/use-vehicle-session";
import { useAgentMode, useLang } from "@/hooks/use-preferences";
import { pick, type AgentMode } from "@/lib/preferences";
import { usePresenter } from "@/hooks/use-presenter";
import { useDemoReset } from "@/hooks/use-demo-reset";
import LiveGarage from "./live/live-garage";
import {thermalLevel} from "@/lib/thermal-status";
import BlackboxTransferStatus from "./blackbox-transfer";
import BackendAgentPanel from "./backend-agent-panel";
import AgentSettings from "./agent/agent-settings";
import GarageCamera from "./driver/garage-camera";
import AgentDock from "./agent/agent-dock";
import {useAgentPresence} from "./agent/use-agent-presence";
import type {VehicleSnapshot} from "@/lib/guardian/types";
import VehicleLibrary from "./vehicle-library";
import SiteHeader from "./site/site-header";
import { VehicleMetrics, TelemetryReadings, OperatingMetrics } from "./vehicle-telemetry";
import { vehicles, powertrainLabels, type Vehicle } from "@/lib/vehicles";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  Cpu,
  FlaskConical,
  History,
  LayoutDashboard,
  LoaderCircle,
  MapPin,
  Radio,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Thermometer,
  TriangleAlert,
  Unplug,
  X,
} from "lucide-react";
import {
  scenarios,
  type Analysis,
  type ScenarioId,
} from "@/lib/telemetry";
// This interactive panel follows a browser-owned live stream. Keep its initial
// HTML deterministic; mount connection-dependent controls only on the client.
function AgentLoading() {
  const {t} = useLang();
  return (
    <section className="safety-agent-panel agent-loading" aria-label="Vehicle Safety Agent" aria-busy="true">
      <span className="section-kicker">{t("ĐỒNG HÀNH CÙNG CHIẾC XE", "YOUR CAR COMPANION")}</span>
      <h2>Car Neuron Agent</h2>
      <p role="status">{t("Đang chuẩn bị giao diện agent…", "Preparing the agent…")}</p>
    </section>
  );
}
function ViewerLoading() {
  const {t} = useLang();
  return <div className="viewer viewer-loading">{t("Chuẩn bị garage 3D…", "Preparing the 3D garage…")}</div>;
}
const SafetyAgentPanel = dynamic(() => import("./vehicle-agent-panel"), {
  ssr: false,
  loading: () => <AgentLoading />,
});
const CarViewer = dynamic(() => import("./car-viewer"), {
  ssr: false,
  loading: () => <ViewerLoading />,
});
const paints = [
  { name: "Alpine White", color: "#e9eded" },
  { name: "Zandvoort Blue", color: "#7ea8b9" },
  { name: "Brooklyn Grey", color: "#777e80" },
  { name: "Black Sapphire", color: "#22282c" },
];
type Tab = "overview" | "telemetry" | "history";

// Live OBD data ("device") has its own dashboard; API and Mock share the classic one.
// Separate components keep each mode's hooks independent when the user switches.
export default function Garage() {
  useDemoReset();
  const [mode, setMode] = useAgentMode();
  return mode === "device" ? <LiveGarage mode={mode} setMode={setMode} /> : <ClassicGarage mode={mode} setMode={setMode} />;
}

function ClassicGarage({mode, setMode}: {mode: "backend" | "mock"; setMode: (mode: AgentMode) => void}) {
  const presenter = usePresenter();
  const [vehicle, setVehicle] = useState<Vehicle>(vehicles[0]);
  const [tab, setTab] = useState<Tab>("overview");
  const {t, lang, time: timeLabel, setLang} = useLang();
  const {snapshot, adapter} = useVehicleSession(vehicle, mode);
  const {scenario, telemetry, samples, result: rawResult, history: rawHistory, incident, failNext, restoring, recoveryNotice, storageError} = snapshot;
  // Backend titles derive from severity, so render them in the current language instead of the one at receipt.
  const localize = (item: Analysis): Analysis => item.source !== "backend" ? item : {...item,
    title: item.severity === "good" ? t("Agent chưa ghi nhận bất thường", "No anomaly found by the agent") : item.severity === "watch" ? t("Agent đề xuất kiểm tra xe", "The agent recommends an inspection") : t("Cảnh báo an toàn từ agent", "Safety alert from the agent")};
  const result = rawResult && localize(rawResult);
  const history = rawHistory.map(localize);
  // Where the camera card puts the agent's words: the top of the agent cell (row 2, right).
  // Cells of row 2 that the camera card fills through portals: the agent's words and the Guardian's six facts.
  const [guardianSlot, setGuardianSlot] = useState<HTMLElement | null>(null);
  const [factsSlot, setFactsSlot] = useState<HTMLElement | null>(null);
  const [paint, setPaint] = useState(0);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"settings" | "help" | null>(null);
  const [notice, setNotice] = useState("");
  const [theme, setTheme] = useState("studio");
  const modalRef = useRef<HTMLDialogElement>(null);
  const backend = snapshot.backend;
  const latest = backend?.reply?.latest.assessment;
  // The robot mirrors the API agent (Mock mode runs without a backend, so no robot there).
  useAgentPresence(backend ? {
    phase: backend.api === "offline" || backend.phase === "error" ? "offline" : !telemetry.connected || backend.phase === "paused" ? "nodata" : backend.phase === "sending" ? "analyzing" : "ready",
    severity: latest?.severity ?? "normal",
    analysisId: backend.reply?.batchId ?? null,
    diagnosis: latest?.diagnosis ?? null,
  } : null);
  const busy = backend?.phase === "sending";
  const weatherResult = backend?.reply?.latest.tool_trace.find(t => t.tool === "get_external_environment_context")?.result;
  const liveWeather = weatherResult?.success ? weatherResult.data : null;
  const thermalDanger = thermalLevel(telemetry,"engine") === "danger" || thermalLevel(telemetry,"cooling") === "danger";
  // The blackbox values the camera's Guardian policy combines with the driver (browser-simulated stream).
  const cameraVehicle = useMemo<VehicleSnapshot | null>(() => telemetry.connected && Number.isFinite(telemetry.speed) && Number.isFinite(telemetry.coolant)
    ? {source: "simulated", capturedAt: telemetry.capturedAt, speedKmh: telemetry.speed, coolantC: telemetry.coolant, engineLoadPct: telemetry.engineLoad ?? null, drivingMinutes: null}
    : null, [telemetry.connected, telemetry.speed, telemetry.coolant, telemetry.engineLoad, telemetry.capturedAt]);
  useEffect(() => {
    if (modal) modalRef.current?.showModal();
    else modalRef.current?.close();
  }, [modal]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3000);
    return () => clearTimeout(timer);
  }, [notice]);
  const switchScenario = (id: ScenarioId) => {
    setError("");
    adapter.setScenario(id);
  };
  const switchVehicle = (next: Vehicle) => {
    if(next.id===vehicle.id)return;
    setVehicle(next);
    setPaint(0);
    setError("");
  };
  const runAnalysis = () => {
    const {buffered, target} = snapshot.blackbox;
    if (backend) {setTab("overview");setNotice(t(`Tự gửi theo gói · Đang gom ${buffered}/${target} mẫu.`, `Sent automatically per batch · Collecting ${buffered}/${target} samples.`));return;}
    try {adapter.check();setError("");setNotice(t("Đã kiểm tra gói dữ liệu mới nhất của xe.", "Checked the latest data batch."));}
    catch(error){setError(error instanceof Error?error.message:t("Chưa thể phân tích.", "Cannot analyse yet."));}
  };
  const exportReport = () => {
    if (!result) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            mode: backend ? "backend-with-simulated-telemetry" : "demo",
            vehicle: {
              id: vehicle.id,
              brand: vehicle.brand,
              name: vehicle.name,
              year: vehicle.year,
              powertrain: vehicle.powertrain,
            },
            telemetry,
            analysis: result,
            incident: backend?.incident ?? incident,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `car-neuron-${result.id.slice(0, 8)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(t("Đã xuất báo cáo JSON.", "JSON report exported."));
  };
  const display = (value: number, suffix = "") =>
    telemetry.connected ? `${value}${suffix}` : "—";
  const visibleHistory = history.filter(item => item.vehicleId === vehicle.id);
  const tabs: {id: Tab; label: string; icon: React.ReactNode}[] = [
    {id: "overview", label: t("Tổng quan", "Overview"), icon: <LayoutDashboard size={16} />},
    {id: "telemetry", label: t("Dữ liệu blackbox", "Blackbox data"), icon: <Activity size={16} />},
    {id: "history", label: t("Lịch sử phân tích", "Analysis history"), icon: <History size={16} />},
  ];
  const healthClass = !backend && thermalDanger ? "critical" : result?.severity ?? "pending";
  return (
    <div className={`app theme-${theme}`}>
      <SiteHeader current="garage">
      <div className="app-bar">
        <div className="app-bar-inner">
          <nav className="app-tabs" aria-label={t("Điều hướng garage", "Garage navigation")}>
            {tabs.map(item => (
              <button key={item.id} className="app-tab" aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)}>
                {item.icon}
                {item.label}
                {item.id === "history" && visibleHistory.length > 0 && <span className="nav-count">{visibleHistory.length}</span>}
              </button>
            ))}
          </nav>
          <div className="app-bar-tools">
            {!presenter && <div className="segmented" role="group" aria-label={t("Nguồn agent", "Agent source")}>
              <button onClick={() => setMode("device")} title={t("Dữ liệu trực tiếp từ thiết bị OBD qua backend", "Live data from the OBD device via the backend")}><Radio size={12} />OBD</button>
              <button aria-pressed={mode === "backend"} onClick={() => setMode("backend")} title={t("Gửi telemetry tới backend và agent AI thật", "Send telemetry to the backend and the real AI agent")}><Server size={12} />API</button>
              <button aria-pressed={mode === "mock"} onClick={() => setMode("mock")} title={t("Chạy hoàn toàn trong trình duyệt, không cần mạng", "Runs entirely in the browser, no network needed")}><FlaskConical size={12} />{t("Mô phỏng", "Mock")}</button>
            </div>}
            <button className="icon-button" onClick={() => setModal("settings")} aria-label={t("Cài đặt demo", "Demo settings")} title={t("Cài đặt demo", "Demo settings")}><Settings2 size={17} /></button>
            <button className="icon-button" onClick={() => setModal("help")} aria-label={t("Hướng dẫn", "Guide")} title={t("Hướng dẫn", "Guide")}><CircleHelp size={17} /></button>
          </div>
        </div>
      </div>
      </SiteHeader>
      <main className="dash">
        <section className="vehicle-bar" aria-label={t("Xe đang theo dõi", "Monitored car")}>
          <div className="vehicle-bar-id">
            <span className="section-kicker">{t("XE CỦA BẠN", "YOUR CAR")}</span>
            <h1>{vehicle.brand} <span>{vehicle.name}</span></h1>
            <div className="vehicle-meta">
              <span>{vehicle.year ?? t("Đời xe chưa xác minh", "Year unverified")}</span>
              <span>{pick(powertrainLabels[vehicle.powertrain], lang)}</span>
              <span>{vehicle.description}</span>
            </div>
          </div>
          <div className="live-vehicle-strip" aria-label={t("Trạng thái luồng dữ liệu", "Data stream status")}>
            <span className={`live-chip ${telemetry.connected ? "" : "off"}`}><span className={`status-dot ${telemetry.connected ? "" : "off"}`} />{telemetry.connected ? t("LIVE · mô phỏng", "LIVE · simulated") : t("Mất kết nối", "Disconnected")}</span>
            <span className="live-item"><small>{t("Thiết bị", "Device")}</small><b>AL–{vehicle.id.toUpperCase()}</b></span>
            <span className="live-item"><small>{t("Gói cuối", "Last packet")}</small><b data-testid="live-timestamp">{timeLabel(telemetry.capturedAt)}</b></span>
            <span className="live-item"><small>{t("Mã lỗi", "Fault")}</small><b>{!telemetry.connected ? "Fault —" : telemetry.fault === undefined ? t("Đang nhận…", "Receiving…") : telemetry.fault === 0 ? t("Fault 0 · không lỗi", "Fault 0 · none") : t(`Fault ${telemetry.fault} · có lỗi`, `Fault ${telemetry.fault} · present`)}</b></span>
          </div>
          <label className="scenario-select">
            <span>{t("Kịch bản", "Scenario")}</span>
            <select
              aria-label={t("Kịch bản mô phỏng", "Simulation scenario")}
              value={scenario}
              onChange={(e) => switchScenario(e.target.value as ScenarioId)}
            >
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {vehicle.powertrain === "ev" && s.id === "engine"
                    ? t("Pin / motor quá nhiệt", "Battery / motor overheating")
                    : pick(s.label, lang)}
                </option>
              ))}
            </select>
            <ChevronDown size={15} />
          </label>
        </section>
        {vehicles.length > 1 && <VehicleLibrary selected={vehicle} onSelect={switchVehicle} />}
        {restoring && <div className="session-notice" role="status">{t("Đang khôi phục phiên theo dõi của xe…", "Restoring the monitoring session…")}</div>}
        {recoveryNotice && <div className="session-notice" role="status"><span>{recoveryNotice}</span><button aria-label={t("Ẩn thông báo khôi phục", "Dismiss recovery notice")} onClick={adapter.dismissRecovery}><X size={15} /></button></div>}
        {storageError && <div className="session-notice session-error" role="alert">{storageError}</div>}
        {/* With the backend the overview stays mounted (hidden on other tabs): the driver camera lives in it and must not stop. */}
        {(tab === "overview" || !!backend) && (
          <div className="overview-pane" style={{display: tab === "overview" ? "contents" : "none"}}>
            {/* With the backend, overall status follows the agent verdict; sensor cards still show local heat levels. */}
            <section className={`health-overview health-overview-slim ${healthClass}`} aria-label={t("Tình trạng xe", "Vehicle status")}>
              <div className="health-overview-icon">{healthClass === "watch" || healthClass === "critical" ? <TriangleAlert size={22} /> : <ShieldCheck size={22} />}</div>
              <div className="health-overview-copy">
                <span className="section-kicker">{t("TÌNH TRẠNG XE · TỰ ĐỘNG THEO DÕI", "VEHICLE STATUS · AUTO-MONITORED")}</span>
                <h2>{!telemetry.connected ? t("Chưa có dữ liệu kết nối", "No connected data") : result?.title ?? (busy ? t("Đang kiểm tra chiếc xe…", "Checking your car…") : t("Xe có cần kiểm tra không?", "Does your car need a check?"))}</h2>
                <p>{result ? result.summary : t("Đối chiếu nhiều cảm biến để đánh giá trước khi đề xuất garage.", "Cross-checks several sensors before suggesting a garage.")}</p>
                <small>{backend ? `${t("Agent đánh giá từ dữ liệu mô phỏng · Cần kiểm tra kỹ thuật để xác nhận", "Agent assessment of simulated data · Needs a technical check to confirm")}${busy && result ? t(" · đang cập nhật…", " · updating…") : ""}` : result ? t("Quy tắc demo · chưa có xác suất tin cậy được hiệu chuẩn", "Demo rules · no calibrated confidence") : t("Chưa có kết luận chẩn đoán", "No diagnosis yet")}</small>
              </div>
              <button className="outline-button" disabled={busy} onClick={runAnalysis}>{t("Kiểm tra xe", "Check car")} <ArrowRight size={16} /></button>
            </section>
            {/* Two columns, two rows: [3D car | camera] over [blackbox readings | agent]. */}
            <div className="overview-grid overview-quad" data-camera={backend ? "on" : "off"}>
              <div className="overview-main quad-car">
                <section className="vehicle-card" aria-label="Garage 3D">
                  <CarViewer
                    key={vehicle.id}
                    vehicle={vehicle}
                    color={paints[paint].color}
                    scanning={busy}
                    telemetry={telemetry}
                    analysis={result}
                  />
                  <div className="vehicle-footer">
                    <div className="paint-selector">
                      <span>{t("Màu ngoại thất", "Paint")}</span>
                      <div className="paint-options">
                        {paints.map((p, i) => (
                          <button
                            key={p.name}
                            title={p.name}
                            aria-label={`${t("Màu", "Paint")} ${p.name}`}
                            aria-pressed={paint === i}
                            className={paint === i ? "paint active" : "paint"}
                            style={{ "--paint": p.color } as React.CSSProperties}
                            onClick={() => setPaint(i)}
                          >
                            {paint === i && <Check size={12} style={{ color: i > 1 ? "white" : "#293630" }} />}
                          </button>
                        ))}
                        <b>{paints[paint].name}</b>
                      </div>
                    </div>
                    <div className="model-credit">
                      <a href={vehicle.source} target="_blank" rel="noreferrer">{vehicle.author} ↗</a>
                      <span>{vehicle.license}</span>
                    </div>
                  </div>
                </section>
              </div>
              {backend && <aside className="insights-column quad-camera"><GarageCamera vehicleId={vehicle.id} vehicle={cameraVehicle} agentSlot={guardianSlot} factsSlot={factsSlot} onAlertSent={adapter.flushNow} /></aside>}
              <div className="overview-main quad-data">
                <div ref={setFactsSlot} className="guardian-facts-slot" />
                <section className="dash-section telemetry-section" aria-label={t("Thông số vận hành", "Operating data")}>
                  <div className="section-heading">
                    <h2>{t("Thông số vận hành", "Operating data")} <span>TELEMETRY</span></h2>
                    <button className="text-button" onClick={() => setTab("telemetry")}>{t("Bảng dữ liệu đầy đủ", "Full data table")} <ArrowRight size={15} /></button>
                  </div>
                  <BlackboxTransferStatus transfer={snapshot.blackbox} backend={backend} />
                  <OperatingMetrics telemetry={telemetry} samples={samples} />
                  <VehicleMetrics telemetry={telemetry} samples={samples} />
                </section>
              </div>
              <aside className="insights-column quad-agent">
                {backend && <AgentSettings />}
                <div ref={setGuardianSlot} className="guardian-agent-slot" />
                {backend ? <BackendAgentPanel compact state={backend} transfer={snapshot.blackbox} connected={telemetry.connected} onInject={() => switchScenario("engine")} onViewTelemetry={() => setTab("telemetry")} onFallback={() => setMode("mock")} /> : <SafetyAgentPanel agentCycle={snapshot.agentCycle} blackbox={snapshot.blackbox} onViewTelemetry={() => setTab("telemetry")} incident={incident} telemetry={telemetry} onCommand={adapter.command} onInject={() => switchScenario("engine")} failNext={failNext} onFailNext={adapter.setFailNext} />}
                <details className="vehicle-context">
                  <summary>{t("Kết nối & bối cảnh môi trường", "Connection & environment")}<ChevronDown size={15} /></summary>
                  <div className="context-grid">
                    <section className="connection-card">
                      <h3><Radio size={15} />{t("Kết nối blackbox", "Blackbox connection")}</h3>
                      <dl>
                        <div><dt>{t("Trạng thái", "Status")}</dt><dd><span className={`status-dot ${telemetry.connected ? "" : "off"}`} />{telemetry.connected ? t("Đã kết nối · mô phỏng", "Connected · simulated") : t("Mất kết nối", "Disconnected")}</dd></div>
                        <div><dt>{t("Thiết bị", "Device")}</dt><dd>AL–{vehicle.id.toUpperCase()}</dd></div>
                        <div><dt>{t("Giao thức", "Protocol")}</dt><dd>{vehicle.powertrain === "ev" ? "BMS / MCU / CAN" : "OBD-II / CAN"}</dd></div>
                      </dl>
                    </section>
                    <section className="location-card">
                      <h3><Sun size={15} />{t("Bối cảnh môi trường", "Environment")}</h3>
                      <div className="weather-line">
                        <span className="weather-value">{backend ? liveWeather?.outside_temperature_c ?? "—" : display(telemetry.ambient)}<small>°C</small></span>
                        <p>
                          {backend ? liveWeather ? t("Nhiệt độ tại vị trí xe", "Temperature at the car") : t("Chưa nhận được thời tiết", "No weather yet") : scenario === "environment" ? t("Nắng nóng", "Hot and sunny") : t("Trời nắng nhẹ", "Mild sunshine")}
                          <span>{backend ? t("Open-Meteo qua backend", "Open-Meteo via backend") : t("Mô phỏng", "Simulated")}</span>
                        </p>
                      </div>
                      <div className="location-line"><MapPin size={14} /><span>{telemetry.location.name}</span></div>
                    </section>
                  </div>
                </details>
              </aside>
            </div>
            <section className="analysis-section dash-section" aria-label={t("Báo cáo đánh giá", "Assessment report")}>
              <div className="section-heading">
                <h2>{t("Báo cáo đánh giá", "Assessment report")} <span>{backend ? "BACKEND" : "DEMO"}</span></h2>
                <button className="primary-button small" onClick={runAnalysis} disabled={busy}>
                  {busy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
                  <span>{busy ? t("Đang phân tích…", "Analysing…") : backend ? t("Theo dõi kết quả API", "Follow API results") : result ? t("Phân tích lại", "Analyse again") : t("Phân tích", "Analyse")}</span>
                </button>
              </div>
              {error && (
                <div className="analysis-error" role="alert">
                  <Unplug size={20} />
                  <div>
                    <b>{t("Chưa thể phân tích", "Cannot analyse yet")}</b>
                    <p>{error}</p>
                  </div>
                  <button className="outline-button" onClick={runAnalysis}>{t("Thử lại", "Retry")}</button>
                </div>
              )}
              {result && <AnalysisResult result={result} onExport={exportReport} />}
              {!busy && !result && !error && (
                <div className="analysis-idle">
                  <span><ShieldCheck size={14} /> {t("Phân tích theo bối cảnh", "Context-aware analysis")}</span>
                  <span><Thermometer size={14} /> {t("Phân biệt nguồn nhiệt", "Separates heat sources")}</span>
                  <span><Check size={14} /> {t("Đề xuất có cơ sở", "Evidence-based advice")}</span>
                  <small>{backend ? t("Đang chờ backend xử lý gói dữ liệu đầu tiên.", "Waiting for the backend to process the first batch.") : t("Dữ liệu & quy tắc đánh giá được mô phỏng.", "Data and assessment rules are simulated.")}</small>
                </div>
              )}
            </section>
          </div>
        )}
        {tab === "telemetry" && (
          <section className="data-panel dash-section">
            <div className="data-heading">
              <div>
                <h2>{t("Gói dữ liệu blackbox", "Blackbox data batch")}</h2>
                <p>{t(`Dữ liệu trực tiếp của ${vehicle.brand} ${vehicle.name}, cập nhật mỗi 1 giây. Nguồn blackbox và môi trường đang được mô phỏng.`, `Live data from the ${vehicle.brand} ${vehicle.name}, updated every second. The blackbox and environment are simulated.`)}</p>
              </div>
              <button className="outline-button" onClick={runAnalysis}>{t("Kiểm tra gói hiện tại", "Check current batch")}</button>
            </div>
            <BlackboxTransferStatus transfer={snapshot.blackbox} backend={backend} />
            <div className="table-wrap"><TelemetryReadings telemetry={telemetry} /></div>
            <p className="data-timestamp">{t("Cập nhật", "Updated")}: {timeLabel(telemetry.capturedAt)} · {t("Không phải dữ liệu xe thực.", "Not real vehicle data.")}</p>
          </section>
        )}
        {tab === "history" && (
          <section className="history-panel dash-section">
            <div className="data-heading">
              <div>
                <h2>{t("Các lần phân tích", "Past analyses")}</h2>
                <p>{t("Lưu trên trình duyệt theo từng xe · khôi phục sau khi tải lại trang.", "Stored in this browser per car · restored after reload.")}</p>
              </div>
              <span className="history-total">{visibleHistory.length} {t("báo cáo", "reports")}</span>
            </div>
            {visibleHistory.length === 0 ? (
              <div className="empty-state">
                <History size={32} />
                <h3>{t("Mỗi hành trình bắt đầu bằng sự thấu hiểu.", "Every journey starts with understanding.")}</h3>
                <p>{backend ? t("Kết quả sẽ được lưu trong phiên sau mỗi gói dữ liệu được backend xử lý.", "Results are kept in this session after each batch the backend processes.") : t("Bấm Phân tích ở trang Tổng quan để tạo báo cáo đầu tiên.", "Press Analyse on the Overview page to create the first report.")}</p>
                <button className="primary-button" onClick={() => setTab("overview")}>{t("Về tổng quan", "Back to overview")} <ArrowRight size={16} /></button>
              </div>
            ) : (
              <div className="history-list">
                {visibleHistory.map((h) => (
                  <article className={`history-row ${h.severity}`} key={h.id}>
                    <span className="history-score">{h.score ?? "—"}<small>{h.source === "backend" ? "API" : "/100"}</small></span>
                    <div>
                      <h3>{h.title}</h3>
                      <p>
                        {h.vehicleName} · {timeLabel(h.createdAt)} ·{" "}
                        {h.cause === "traction" ? t("Pin / motor", "Battery / motor") : h.cause === "engine" ? t("Động cơ", "Engine") : h.cause === "environment" ? t("Môi trường", "Environment") : h.cause === "unclassified" ? t("Nhận định backend", "Backend assessment") : t("Bình thường", "Normal")}
                      </p>
                      <details>
                        <summary>{t("Xem nhận định & đề xuất", "View assessment & advice")}</summary>
                        <p>{h.summary}</p>
                        <ul>{h.recommendations.map((r) => <li key={r}>{r}</li>)}</ul>
                      </details>
                    </div>
                    <span className="demo-pill">{h.source === "backend" ? "API" : "MOCK"}</span>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
        <footer className="page-footer">
          <span><b>Car Neuron.</b> {t("Kết nối dữ liệu. Thấu hiểu hành trình.", "Connected data. Understood journeys.")}</span>
          <span>{t("Dữ liệu ECU mô phỏng", "Simulated ECU data")} · Frontend v0.2</span>
        </footer>
      </main>
      {backend && <AgentDock session={vehicle.id} anchor="car-agent" quietOver="[data-testid=garage-camera]" quietRatio={0.1} />}
      <dialog
        ref={modalRef}
        className="modal"
        onCancel={() => setModal(null)}
        onClick={(e) => {
          if (e.target === modalRef.current) setModal(null);
        }}
      >
        <div className="modal-content">
          <button className="modal-close icon-button" aria-label={t("Đóng", "Close")} onClick={() => setModal(null)}>
            <X size={19} />
          </button>
          {modal === "settings" ? (
            <>
              <span className="section-kicker">YOUR WORKSPACE</span>
              <h2>{t("Cài đặt demo", "Demo settings")}</h2>
              <p>{t("Tùy chỉnh không gian garage và dữ liệu mô phỏng.", "Customise the garage and simulated data.")}</p>
              <label className="field-label">
                {t("Giao diện", "Theme")}
                <select aria-label={t("Giao diện", "Theme")} value={theme} onChange={(e) => setTheme(e.target.value)}>
                  <option value="studio">{t("Studio — Trắng & xanh rêu", "Studio — White & moss green")}</option>
                  <option value="midnight">{t("Midnight — Garage tối", "Midnight — Dark garage")}</option>
                  <option value="blueprint">{t("Blueprint — Xanh kỹ thuật", "Blueprint — Technical blue")}</option>
                </select>
              </label>
              <label className="field-label">
                {t("Nguồn agent", "Agent source")}
                <select value={mode} onChange={(e) => setMode(e.target.value === "mock" ? "mock" : e.target.value === "device" ? "device" : "backend")}>
                  <option value="device">{t("OBD — dữ liệu trực tiếp từ thiết bị", "OBD — live data from the device")}</option>
                  <option value="backend">{t("API — backend & AI thật", "API — backend & real AI")}</option>
                  <option value="mock">{t("Mô phỏng — chạy trong trình duyệt", "Mock — runs in the browser")}</option>
                </select>
              </label>
              <label className="field-label">
                {t("Ngôn ngữ", "Language")}
                <select value={lang} onChange={(e) => setLang(e.target.value === "en" ? "en" : "vi")}>
                  <option value="vi">Tiếng Việt</option>
                  <option value="en">English</option>
                </select>
              </label>
              <label className="field-label">
                {t("Tình huống mô phỏng", "Simulated situation")}
                <select value={scenario} onChange={(e) => switchScenario(e.target.value as ScenarioId)}>
                  {scenarios.map((s) => (
                    <option value={s.id} key={s.id}>
                      {vehicle.powertrain === "ev" && s.id === "engine" ? t("Pin / motor quá nhiệt", "Battery / motor overheating") : pick(s.label, lang)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="modal-note">
                <Cpu size={18} />
                <span>{backend ? t("Telemetry mô phỏng được gửi đến backend theo từng gói. Khóa API chỉ được cấu hình ở backend.", "Simulated telemetry is sent to the backend per batch. API keys live only in the backend.") : t("Chế độ local mock. Không gửi dữ liệu đến máy chủ.", "Local mock mode. No data is sent to a server.")}</span>
              </div>
              <button className="primary-button" onClick={() => setModal(null)}>{t("Hoàn tất", "Done")} <Check size={16} /></button>
            </>
          ) : (
            <>
              <span className="section-kicker">QUICK START</span>
              <h2>{t("Làm quen với Car Neuron", "Getting started with Car Neuron")}</h2>
              <ol className="help-steps">
                <li>
                  <b>{t("Khám phá chiếc xe", "Explore the car")}</b>
                  <p>{t("Kéo để xoay model 3D, cuộn để thu phóng. Chọn góc nhìn ở phía trên khung xe; thu phóng, tự xoay và toàn màn hình ở góc dưới bên phải.", "Drag to rotate the 3D model and scroll to zoom. Pick a view above the car; zoom, auto-rotate and fullscreen sit in the bottom-right corner.")}</p>
                </li>
                <li>
                  <b>{t("Chọn kịch bản", "Pick a scenario")}</b>
                  <p>{t("Đổi giữa bình thường, nắng nóng, quá nhiệt động cơ và mất kết nối ở ô Kịch bản cạnh tên xe, hoặc bấm Mô phỏng quá nhiệt trong panel agent.", "Switch between normal, hot weather, engine overheating and disconnected in the Scenario box next to the car name, or press Inject overheating in the agent panel.")}</p>
                </li>
                <li>
                  <b>{t("Xem agent phân tích", "Watch the agent")}</b>
                  <p>{t("Panel bên phải hiển thị nhận định, bằng chứng và các bước agent đã làm. Báo cáo chi tiết và file JSON nằm ở mục Báo cáo đánh giá; các lần trước nằm ở tab Lịch sử phân tích.", "The right-hand panel shows the assessment, evidence and the steps the agent took. The detailed report and JSON export live under Assessment report; earlier runs are in the Analysis history tab.")}</p>
                </li>
                <li>
                  <b>{t("Nguồn agent & ngôn ngữ", "Agent source & language")}</b>
                  <p>{t("Nút API / Mô phỏng trên thanh trên cùng chuyển giữa backend thật và agent chạy trong trình duyệt (dùng khi mất mạng). VI / EN đổi ngôn ngữ giao diện.", "The API / Mock switch in the top bar toggles between the real backend and the in-browser agent (useful offline). VI / EN changes the interface language.")}</p>
                </li>
              </ol>
              <p className="attribution">
                {t("Xe đang chọn", "Selected car")}:{" "}
                <a href={vehicle.source} target="_blank" rel="noreferrer">{vehicle.brand} {vehicle.name} — {vehicle.author}</a>
                . {vehicle.license}. {t("Model GLB được lưu và tải từ ứng dụng.", "The GLB model ships with the app.")}{" "}
                {backend ? t("Dữ liệu cảm biến mô phỏng; kết quả phân tích lấy từ backend.", "Sensor data is simulated; analysis comes from the backend.") : t("Dữ liệu và ngưỡng chẩn đoán chỉ là mô phỏng.", "Data and diagnostic thresholds are simulated.")}
              </p>
            </>
          )}
        </div>
      </dialog>
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
    </div>
  );
}

function AnalysisResult({
  result,
  onExport,
}: {
  result: Analysis;
  onExport: () => void;
}) {
  const {t} = useLang();
  return (
    <div className={`analysis-result ${result.severity}`} role="status">
      <div className="result-heading">
        <div className="health-score">
          <b>{result.score ?? "—"}</b>
          <span>{result.source === "backend" ? t("Chưa chấm điểm", "Not scored") : "/ 100"}</span>
        </div>
        <div>
          <span className="section-kicker">{result.source === "backend" ? t("KẾT QUẢ TỪ BACKEND", "BACKEND RESULT") : t("ĐÁNH GIÁ MÔ PHỎNG", "SIMULATED ASSESSMENT")}</span>
          <h3>{result.title}</h3>
          <p>{result.summary}</p>
        </div>
        <button className="icon-button" onClick={onExport} aria-label={t("Xuất báo cáo JSON", "Export JSON report")} title={t("Xuất báo cáo JSON", "Export JSON report")}>
          <ArrowDownToLine size={18} />
        </button>
      </div>
      <div className="result-columns">
        <div>
          <h4>{t("Cơ sở nhận định", "Evidence")}</h4>
          <ul>{result.evidence.map((e) => <li key={e}><Activity size={14} />{e}</li>)}</ul>
        </div>
        <div>
          <h4>{t("Đề xuất cho bạn", "Recommendations")}</h4>
          <ul>{result.recommendations.map((r) => <li key={r}><Check size={15} />{r}</li>)}</ul>
        </div>
      </div>
      <p className="result-disclaimer">
        {result.source === "backend" ? t("Nguồn cảm biến được mô phỏng. Kết quả từ agent và quy tắc an toàn backend, cần kiểm tra kỹ thuật để xác nhận.", "Sensor source is simulated. Result from the agent and backend safety rules; confirm with a technical check.") : t("Kết quả dựa trên quy tắc demo, cần backend và dữ liệu thực để xác thực chẩn đoán.", "Based on demo rules; a backend and real data are needed to validate the diagnosis.")}
      </p>
    </div>
  );
}
