"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import Image from "next/image";
import { useVehicleSession } from "@/hooks/use-vehicle-session";
import {thermalLevel} from "@/lib/thermal-status";
import BlackboxTransferStatus from "./blackbox-transfer";
import BackendAgentPanel from "./backend-agent-panel";
import VehicleLibrary from "./vehicle-library";
import { VehicleMetrics, TelemetryReadings, OperatingMetrics } from "./vehicle-telemetry";
import { vehicles, powertrainLabels, type Vehicle } from "@/lib/vehicles";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Cpu,
  Gauge,
  History,
  LayoutDashboard,
  LoaderCircle,
  MapPin,
  Radio,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Thermometer,
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
const SafetyAgentPanel = dynamic(() => import("./vehicle-agent-panel"), {
  ssr: false,
  loading: () => (
    <section className="safety-agent-panel agent-loading" aria-label="Vehicle Safety Agent" aria-busy="true">
      <span className="section-kicker">ĐỒNG HÀNH CÙNG CHIẾC XE</span>
      <h2>Car Neuron Agent</h2>
      <p role="status">Đang chuẩn bị giao diện agent…</p>
    </section>
  ),
});
const CarViewer = dynamic(() => import("./car-viewer"), {
  ssr: false,
  loading: () => (
    <div className="viewer viewer-loading">Chuẩn bị garage 3D…</div>
  ),
});
const paints = [
  { name: "Alpine White", color: "#e9eded" },
  { name: "Zandvoort Blue", color: "#7ea8b9" },
  { name: "Brooklyn Grey", color: "#777e80" },
  { name: "Black Sapphire", color: "#22282c" },
];
type Tab = "overview" | "telemetry" | "history";
const timeLabel = (iso: string) =>
  iso ? new Date(iso).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }) : "—";

export default function Garage() {
  const [vehicle, setVehicle] = useState<Vehicle>(vehicles[0]);
  const [tab, setTab] = useState<Tab>("overview");
  const {snapshot, adapter} = useVehicleSession(vehicle);
  const {scenario, telemetry, samples, result, history, incident, failNext, restoring, recoveryNotice, storageError} = snapshot;
  const [paint, setPaint] = useState(0);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"settings" | "help" | null>(null);
  const [notice, setNotice] = useState("");
  const [theme, setTheme] = useState("studio");
  const modalRef = useRef<HTMLDialogElement>(null);
  const backend = snapshot.backend;
  const busy = backend?.phase === "sending";
  const weatherResult = backend?.reply?.latest.tool_trace.find(t => t.tool === "get_external_environment_context")?.result;
  const liveWeather = weatherResult?.success ? weatherResult.data : null;
  const thermalDanger = thermalLevel(telemetry,"engine") === "danger" || thermalLevel(telemetry,"cooling") === "danger";
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
    if (backend) {setTab("overview");setNotice(`Tự gửi mỗi 15 mẫu · Đang gom ${snapshot.blackbox.buffered}/15 mẫu.`);return;}
    try {adapter.check();setError("");setNotice("Đã kiểm tra gói dữ liệu mới nhất của xe.");}
    catch(error){setError(error instanceof Error?error.message:"Chưa thể phân tích.");}
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
    setNotice("Đã xuất báo cáo JSON.");
  };
  const display = (value: number, suffix = "") =>
    telemetry.connected ? `${value}${suffix}` : "—";
  const visibleHistory = history.filter(item => item.vehicleId === vehicle.id);
  return (
    <div className={`app theme-${theme}`}>
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="Car Neuron trang chủ">
          <span className="brand-symbol brand-logo">
            <Image src="/brand/car-neuron-logo.png" alt="" width={36} height={36} priority />
          </span>
          <span>
            Car Neuron<span className="brand-period">.</span>
          </span>
        </Link>
        <div className="workspace-label">
          WORKSPACE <span>01</span>
        </div>
        <nav aria-label="Điều hướng chính">
          <button
            className={tab === "overview" ? "nav-item active" : "nav-item"}
            onClick={() => setTab("overview")}
          >
            <LayoutDashboard size={19} />
            Tổng quan
            <ChevronRight className="nav-arrow" size={16} />
          </button>
          <button
            className={tab === "telemetry" ? "nav-item active" : "nav-item"}
            onClick={() => setTab("telemetry")}
          >
            <Activity size={19} />
            Dữ liệu blackbox
          </button>
          <button
            className={tab === "history" ? "nav-item active" : "nav-item"}
            onClick={() => setTab("history")}
          >
            <History size={19} />
            Lịch sử phân tích
            {visibleHistory.length > 0 && (
              <span className="nav-count">{visibleHistory.length}</span>
            )}
          </button>
        </nav>
        <div className="sidebar-vehicle">
          <div className="sidebar-car-symbol">
            <Gauge size={21} />
          </div>
          <div>
            <strong>
              {vehicle.brand} {vehicle.name}
            </strong>
            <span>
              {vehicles.length} xe · {powertrainLabels[vehicle.powertrain]}
            </span>
          </div>
          <span className="tiny-dot" />
        </div>
        <div className="sidebar-bottom">
          <div className="agent-mini">
            <span className="agent-orb">
              <Sparkles size={16} />
            </span>
            <div>
              <b>Car Neuron Agent</b>
              <span>Sẵn sàng phân tích</span>
            </div>
            <span className="tiny-dot" />
          </div>
          <button className="nav-item" onClick={() => setModal("settings")}>
            <Settings2 size={18} />
            Cài đặt demo
          </button>
          <button className="nav-item" onClick={() => setModal("help")}>
            <CircleHelp size={18} />
            Hướng dẫn
          </button>
          <div className="profile">
            <span className="avatar">N</span>
            <div>
              <strong>My garage</strong>
              <span>Không gian cá nhân</span>
            </div>
            <span className="profile-tag">DEMO</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            My garage <ChevronRight size={14} />
            <b>
              {tab === "overview"
                ? "Tổng quan"
                : tab === "telemetry"
                  ? "Dữ liệu blackbox"
                  : "Lịch sử phân tích"}
            </b>
          </div>
          <div className="topbar-right">
            <span className="demo-pill">DEMO MODE</span>
            <span className="topbar-divider" />
            <span className="system-status">
              <span
                className={`tiny-dot ${telemetry.connected ? "" : "off"}`}
              />
              {telemetry.connected
                ? "Hệ thống sẵn sàng"
                : "Blackbox ngoại tuyến"}
            </span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR CAR. UNDERSTOOD.</div>
              <h1>
                {tab === "history"
                  ? "Lịch sử phân tích"
                  : tab === "telemetry"
                    ? "Dữ liệu chiếc xe"
                    : "Hiểu xe hơn. An tâm hơn."}
              </h1>
              <p>
                Một góc nhìn toàn diện về chiếc xe, từ dữ liệu đến hành trình.
              </p>
            </div>
            <button
              className="outline-button"
              onClick={() => setModal("settings")}
            >
              <Settings2 size={16} />
              <span>Tùy chỉnh mô phỏng</span>
            </button>
          </div>
          <VehicleLibrary selected={vehicle} onSelect={switchVehicle} />
          {restoring && <div className="session-notice" role="status">Đang khôi phục phiên theo dõi của xe…</div>}
          {recoveryNotice && <div className="session-notice" role="status"><span>{recoveryNotice}</span><button aria-label="Ẩn thông báo khôi phục" onClick={adapter.dismissRecovery}><X size={15} /></button></div>}
          {storageError && <div className="session-notice session-error" role="alert">{storageError}</div>}
          <div className="demo-strip">
            <div>
              <span className="demo-icon">
                <Radio size={15} />
              </span>
              <span>
                Blackbox realtime · mô phỏng <span className="strip-separator">/</span>
                <b> Dữ liệu riêng của xe · cập nhật mỗi 1 giây.</b>
              </span>
            </div>
            <label className="scenario-select">
              <select
                aria-label="Kịch bản mô phỏng"
                value={scenario}
                onChange={(e) => switchScenario(e.target.value as ScenarioId)}
              >
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {vehicle.powertrain === "ev" && s.id === "engine"
                      ? "Pin / motor quá nhiệt"
                      : s.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={15} />
            </label>
          </div>
          {tab === "overview" && (
            <>
              <section className={`health-overview ${thermalDanger ? "critical" : busy ? "pending" : result?.severity ?? "pending"}`} aria-label="Tình trạng xe">
                <div className="health-overview-icon"><ShieldCheck size={26} /></div>
                <div className="health-overview-copy"><span className="section-kicker">TÌNH TRẠNG XE · TỰ ĐỘNG THEO DÕI</span>
                  <h2>{busy ? "Đang kiểm tra chiếc xe…" : !telemetry.connected ? "Chưa có dữ liệu kết nối" : result?.title ?? "Xe có cần kiểm tra không?"}</h2>
                  <p>{result ? result.summary : "Đối chiếu nhiều cảm biến để đánh giá trước khi đề xuất garage."}</p>
                  <small>{backend ? "Agent đánh giá từ dữ liệu mô phỏng · Cần kiểm tra kỹ thuật để xác nhận" : result ? "Quy tắc demo · chưa có xác suất tin cậy được hiệu chuẩn" : "Chưa có kết luận chẩn đoán"}</small>
                </div>
                <div className="health-actions">
                  <button className="outline-button" disabled={busy} onClick={runAnalysis}>Kiểm tra xe <ArrowRight size={16} /></button>
                </div>
              </section>
              <div className="live-vehicle-strip" aria-label="Trạng thái luồng dữ liệu">
                <span><span className={`status-dot ${telemetry.connected ? "" : "off"}`} />{telemetry.connected ? "LIVE · mô phỏng" : "Mất kết nối"}</span>
                <span>{vehicle.brand} {vehicle.name} · AL–{vehicle.id.toUpperCase()}</span>
                <span data-testid="live-timestamp">Gói cuối: {timeLabel(telemetry.capturedAt)}</span>
                <strong>{!telemetry.connected ? "Fault —" : telemetry.fault === undefined ? "Đang nhận dữ liệu…" : telemetry.fault === 0 ? "Fault 0 · không ghi nhận lỗi" : `Fault ${telemetry.fault} · có lỗi`}</strong>
              </div>
              <div className="overview-grid">
                <section className="vehicle-card" aria-label="Garage 3D">
                  <div className="vehicle-heading">
                    <div>
                      <span className="section-kicker">XE CỦA BẠN</span>
                      <h2>
                        {vehicle.brand} <span>{vehicle.name}</span>
                      </h2>
                      <div className="vehicle-meta">
                        <span>{vehicle.year ?? "Đời xe chưa xác minh"}</span>
                        <span className="meta-dot">·</span>
                        <span>{powertrainLabels[vehicle.powertrain]}</span>
                        <span className="meta-dot">·</span>
                        <span>{vehicle.description}</span>
                      </div>
                    </div>
                    <span className="vehicle-badge">
                      <ShieldCheck size={14} /> Digital garage
                    </span>
                  </div>
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
                        <span>MÀU NGOẠI THẤT</span>
                        <div className="paint-options">
                          {paints.map((p, i) => (
                            <button
                              key={p.name}
                              title={p.name}
                              aria-label={`Màu ${p.name}`}
                              aria-pressed={paint === i}
                              className={paint === i ? "paint active" : "paint"}
                              style={
                                { "--paint": p.color } as React.CSSProperties
                              }
                              onClick={() => setPaint(i)}
                            >
                              {paint === i && (
                                <Check
                                  size={12}
                                  style={{ color: i > 1 ? "white" : "#293630" }}
                                />
                              )}
                            </button>
                          ))}
                          <b>{paints[paint].name}</b>
                        </div>
                      </div>
                    <div className="model-credit">
                      <a href={vehicle.source} target="_blank" rel="noreferrer">
                        {vehicle.author} ↗
                      </a>
                      <span>{vehicle.license}</span>
                    </div>
                  </div>
                </section>
                <aside className="insights-column">
                  {backend ? <BackendAgentPanel state={backend} transfer={snapshot.blackbox} connected={telemetry.connected} onInject={() => switchScenario("engine")} onViewTelemetry={() => setTab("telemetry")} /> : <SafetyAgentPanel agentCycle={snapshot.agentCycle} blackbox={snapshot.blackbox} onViewTelemetry={() => setTab("telemetry")} incident={incident} telemetry={telemetry} onCommand={adapter.command} onInject={() => switchScenario("engine")} failNext={failNext} onFailNext={adapter.setFailNext} />}
                  <details className="vehicle-context"><summary>Kết nối & bối cảnh môi trường</summary>
                  <section className="connection-card">
                    <div className="card-top">
                      <h3>Kết nối blackbox</h3>
                      <Radio size={18} />
                    </div>
                    <div className="connection-status">
                      <span
                        className={`status-dot ${telemetry.connected ? "" : "off"}`}
                      />
                      <strong>
                        {telemetry.connected ? "Đã kết nối" : "Mất kết nối"}
                      </strong>
                      <span>MOCK</span>
                    </div>
                    <div className="device-line">
                      <span>Thiết bị</span>
                      <b>AL–{vehicle.id.toUpperCase()}</b>
                    </div>
                    <div className="device-line">
                      <span>Giao thức</span>
                      <b>
                        {vehicle.powertrain === "ev"
                          ? "BMS / MCU / CAN"
                          : "OBD-II / CAN"}
                      </b>
                    </div>
                    <div className="connection-foot">
                      <span className="tiny-dot" />{" "}
                      {telemetry.connected
                        ? "Gói dữ liệu mẫu sẵn sàng"
                        : "Đang chờ dữ liệu từ thiết bị"}
                    </div>
                  </section>
                  <section className="location-card">
                    <div className="card-top">
                      <h3>Bối cảnh môi trường</h3>
                      <ArrowUpRight size={17} />
                    </div>
                    <div className="weather-line">
                      <div>
                        <span className="weather-value">
                          {backend ? liveWeather?.outside_temperature_c ?? "—" : display(telemetry.ambient)}
                          <small>°C</small>
                        </span>
                        <p>
                          {backend ? liveWeather ? "Nhiệt độ tại vị trí xe" : "Chưa nhận được thời tiết" : scenario === "environment" ? "Nắng nóng" : "Trời nắng nhẹ"}{" "}
                          <span>{backend ? "· Open-Meteo qua backend" : "· Mô phỏng"}</span>
                        </p>
                      </div>
                      <Sun className="sun-icon" size={43} strokeWidth={1.3} />
                    </div>
                    <div className="location-line">
                      <MapPin size={15} />
                      <span>{telemetry.location.name}</span>
                    </div>
                    <div
                      className="map-art"
                      aria-label="Sơ đồ vị trí minh họa, không phải bản đồ trực tiếp"
                    >
                      <div className="map-river" />
                      <div className="map-road road-one" />
                      <div className="map-road road-two" />
                      <div className="map-road road-three" />
                      <span className="map-place">THẢO ĐIỀN</span>
                      <span className="map-pin">
                        <span />
                      </span>
                      <span className="map-coordinate">
                        10.8023° N · 106.7328° E
                      </span>
                    </div>
                  </section>
                  </details>
                </aside>
              </div>
              <div className="section-heading">
                <h3>
                  Thông số vận hành <span>TELEMETRY</span>
                </h3>
                <button onClick={() => setTab("telemetry")}>
                  Dữ liệu của xe <ArrowRight size={15} />
                </button>
              </div>
              <BlackboxTransferStatus transfer={snapshot.blackbox} backend={backend} />
              <OperatingMetrics telemetry={telemetry} samples={samples} />
              <VehicleMetrics telemetry={telemetry} samples={samples} />
              <section
                className="analysis-section"
                aria-label="Phân tích chiếc xe"
              >
                <div className="analysis-intro">
                  <span className="analysis-symbol">
                    <Sparkles size={23} />
                  </span>
                  <div>
                    <div className="analysis-kicker">
                      CAR NEURON INTELLIGENCE <span>{backend ? "BACKEND" : "DEMO"}</span>
                    </div>
                    <h2>Dữ liệu kể gì về chiếc xe của bạn?</h2>
                    <p>
                      {backend ? "Nhận đánh giá và đề xuất trực tiếp từ agent theo từng gói 15 mẫu." : "Đối chiếu cảm biến, thời tiết và điều kiện vận hành để tìm nguyên nhân."}
                    </p>
                  </div>
                  <button
                    className="primary-button"
                    onClick={runAnalysis}
                    disabled={busy}
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={18} />
                    ) : (
                      <Sparkles size={18} />
                    )}
                    <span>
                      {busy
                        ? "Đang phân tích…"
                        : backend ? "Theo dõi kết quả API" : result
                          ? "Analysis lại"
                          : "Analysis"}
                    </span>
                    {!busy && <ArrowUpRight size={17} />}
                  </button>
                </div>
                {error && (
                  <div className="analysis-error" role="alert">
                    <Unplug size={20} />
                    <div>
                      <b>Chưa thể phân tích</b>
                      <p>{error}</p>
                    </div>
                    <button onClick={runAnalysis}>Thử lại</button>
                  </div>
                )}
                {result && (
                  <AnalysisResult result={result} onExport={exportReport} />
                )}
                {!busy && !result && !error && (
                  <div className="analysis-idle">
                    <span>
                      <ShieldCheck size={14} /> Phân tích theo bối cảnh
                    </span>
                    <span>
                      <Thermometer size={14} /> Phân biệt nguồn nhiệt
                    </span>
                    <span>
                      <Check size={14} /> Đề xuất có cơ sở
                    </span>
                    <small>{backend ? "Đang chờ backend xử lý gói dữ liệu đầu tiên." : "Dữ liệu & quy tắc đánh giá được mô phỏng."}</small>
                  </div>
                )}
              </section>
            </>
          )}
          {tab === "telemetry" && (
            <section className="data-panel">
              <div className="data-heading">
                <div>
                  <h2>Gói dữ liệu blackbox</h2>
                  <p>
                    Dữ liệu trực tiếp của {vehicle.brand} {vehicle.name}, cập nhật mỗi 1 giây. Nguồn blackbox và môi trường đang được mô phỏng.
                  </p>
                </div>
                <button
                  className="outline-button"
                  onClick={() => {
                    runAnalysis();
                  }}
                >
                  Kiểm tra gói hiện tại
                </button>
              </div>
              <TelemetryReadings telemetry={telemetry} />
              <p className="data-timestamp">
                Cập nhật: {timeLabel(telemetry.capturedAt)} · Không phải dữ liệu
                xe thực.
              </p>
            </section>
          )}
          {tab === "history" && (
            <section className="history-panel">
              <div className="data-heading">
                <div>
                  <h2>Các lần phân tích</h2>
                  <p>Lưu trên trình duyệt theo từng xe · khôi phục sau khi tải lại trang.</p>
                </div>
                <span className="history-total">{visibleHistory.length} báo cáo</span>
              </div>
              {visibleHistory.length === 0 ? (
                <div className="empty-state">
                  <History size={35} />
                  <h3>Mỗi hành trình bắt đầu bằng sự thấu hiểu.</h3>
                  <p>{backend ? "Kết quả sẽ được lưu trong phiên sau mỗi gói 15 mẫu được backend xử lý." : "Bấm Analysis ở trang Tổng quan để tạo báo cáo đầu tiên."}</p>
                  <button
                    className="primary-button"
                    onClick={() => setTab("overview")}
                  >
                    Về garage <ArrowRight size={16} />
                  </button>
                </div>
              ) : (
                visibleHistory.map((h) => (
                  <article className={`history-row ${h.severity}`} key={h.id}>
                    <span className="history-score">
                      {h.score ?? "—"}
                      <small>{h.source === "backend" ? "API" : "/100"}</small>
                    </span>
                    <div>
                      <h3>{h.title}</h3>
                      <p>
                        {h.vehicleName} · {timeLabel(h.createdAt)} ·{" "}
                        {h.cause === "traction"
                          ? "Pin / motor"
                          : h.cause === "engine"
                            ? "Động cơ"
                            : h.cause === "environment"
                              ? "Môi trường"
                              : h.cause === "unclassified" ? "Nhận định backend" : "Bình thường"}
                      </p>
                      <details>
                        <summary>Xem nhận định & đề xuất</summary>
                        <p>{h.summary}</p>
                        <ul>
                          {h.recommendations.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                      </details>
                    </div>
                    <span className="demo-pill">MOCK</span>
                  </article>
                ))
              )}
            </section>
          )}
          <footer className="page-footer">
            <span>
              <span className="brand-small">Car Neuron.</span> Kết nối dữ liệu.
              Thấu hiểu hành trình.
            </span>
            <span>
              Frontend concept <span className="footer-dot">·</span> v0.1
            </span>
          </footer>
        </main>
      </div>
      <dialog
        ref={modalRef}
        className="modal"
        onCancel={() => setModal(null)}
        onClick={(e) => {
          if (e.target === modalRef.current) setModal(null);
        }}
      >
        <div className="modal-content">
          <button
            className="modal-close"
            aria-label="Đóng"
            onClick={() => setModal(null)}
          >
            <X size={21} />
          </button>
          {modal === "settings" ? (
            <>
              <span className="section-kicker">YOUR WORKSPACE</span>
              <h2>Cài đặt demo</h2>
              <p>Tùy chỉnh không gian garage và dữ liệu mô phỏng.</p>
              <label className="field-label">
                Giao diện
                <select
                  aria-label="Giao diện"
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                >
                  <option value="studio">Studio — Trắng & xanh rêu</option>
                  <option value="midnight">Midnight — Garage tối</option>
                  <option value="blueprint">Blueprint — Xanh kỹ thuật</option>
                </select>
              </label>
              <label className="field-label">
                Tình huống mô phỏng
                <select
                  value={scenario}
                  onChange={(e) => switchScenario(e.target.value as ScenarioId)}
                >
                  {scenarios.map((s) => (
                    <option value={s.id} key={s.id}>
                      {vehicle.powertrain === "ev" && s.id === "engine"
                        ? "Pin / motor quá nhiệt"
                        : s.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="modal-note">
                <Cpu size={18} />
                <span>
                  {backend ? "Telemetry mô phỏng được gửi đến backend mỗi 15 mẫu. Khóa API chỉ được cấu hình ở backend." : "Chế độ local mock. Không gửi dữ liệu đến máy chủ."}
                </span>
              </div>
              <button className="primary-button" onClick={() => setModal(null)}>
                Hoàn tất <Check size={16} />
              </button>
            </>
          ) : (
            <>
              <span className="section-kicker">QUICK START</span>
              <h2>Làm quen với Car Neuron</h2>
              <ol className="help-steps">
                <li>
                  <b>Khám phá chiếc xe</b>
                  <p>
                    Kéo để xoay model 3D, cuộn để thu phóng. Dùng các nút bên
                    dưới để tự xoay, đặt lại góc nhìn hoặc mở toàn màn hình.
                  </p>
                </li>
                <li>
                  <b>Chọn tình huống</b>
                  <p>
                    Chuyển giữa bình thường, nắng nóng, quá nhiệt động cơ và mất
                    kết nối ở thanh mô phỏng.
                  </p>
                </li>
                <li>
                  <b>Chạy Analysis</b>
                  <p>
                    Xem nguyên nhân, bằng chứng và đề xuất. Xuất báo cáo JSON
                    hoặc xem lại trong Lịch sử phân tích.
                  </p>
                </li>
              </ol>
              <p className="attribution">
                Xe đang chọn:{" "}
                <a href={vehicle.source} target="_blank" rel="noreferrer">
                  {vehicle.brand} {vehicle.name} — {vehicle.author}
                </a>
                . {vehicle.license}. Model GLB được lưu và tải từ ứng dụng.
                {backend ? "Dữ liệu cảm biến mô phỏng; kết quả phân tích lấy từ backend." : "Dữ liệu và ngưỡng chẩn đoán chỉ là mô phỏng."}
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
  return (
    <div className={`analysis-result ${result.severity}`} role="status">
      <div className="result-heading">
        <div className="health-score">
          <b>{result.score ?? "—"}</b>
          <span>{result.source === "backend" ? "Chưa chấm điểm" : "/ 100"}</span>
        </div>
        <div>
          <span className="section-kicker">{result.source === "backend" ? "KẾT QUẢ TỪ BACKEND" : "ĐÁNH GIÁ MÔ PHỎNG"}</span>
          <h3>{result.title}</h3>
          <p>{result.summary}</p>
        </div>
        <button
          className="icon-button"
          onClick={onExport}
          aria-label="Xuất báo cáo JSON"
          title="Xuất báo cáo JSON"
        >
          <ArrowDownToLine size={19} />
        </button>
      </div>
      <div className="result-columns">
        <div>
          <h4>Cơ sở nhận định</h4>
          <ul>
            {result.evidence.map((e) => (
              <li key={e}>
                <Activity size={14} />
                {e}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4>Đề xuất cho bạn</h4>
          <ul>
            {result.recommendations.map((r) => (
              <li key={r}>
                <Check size={15} />
                {r}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="result-disclaimer">
        {result.source === "backend" ? "Nguồn cảm biến được mô phỏng. Kết quả từ agent và quy tắc an toàn backend, cần kiểm tra kỹ thuật để xác nhận." : "Kết quả dựa trên quy tắc demo, cần backend và dữ liệu thực để xác thực chẩn đoán."}
      </p>
    </div>
  );
}
