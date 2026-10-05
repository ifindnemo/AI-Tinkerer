import { AlertTriangle, Fuel, Gauge, Thermometer, Zap } from "lucide-react";
import {operatingUnit, type OperatingChannel} from "@/lib/telemetry-profile";
import {thermalLevel, thermalLabels, type ThermalLevel} from "@/lib/thermal-status";
import type { Telemetry } from "@/lib/telemetry";
import { useLang } from "@/hooks/use-preferences";
import { pick } from "@/lib/preferences";
export function Sparkline({values, warm = false}: {values: number[]; warm?: boolean}) {
  const {t} = useLang();
  if (values.length < 2) return <span className="sparkline-pending">{t("Đang lấy mẫu", "Sampling")}</span>;
  const low = Math.min(...values) - 0.2;
  const range = Math.max(...values) + 0.2 - low;
  const path = values.map((value, index) => `${index === 0 ? "M" : "L"}${index / (values.length - 1) * 110} ${32 - (value - low) / range * 26}`).join(" ");
  return <svg className={`sparkline ${warm ? "warm" : ""}`} viewBox="0 0 110 38" aria-label={t(`Xu hướng ${values.length} mẫu gần nhất`, `Trend of the last ${values.length} samples`)} role="img"><path d={path} fill="none" stroke="currentColor" strokeWidth="1.7" /></svg>;
}


export function OperatingMetrics({telemetry: t, samples}: {telemetry: Telemetry; samples: Telemetry[]}) {
  const {t: tx} = useLang();
  const excel = t.operatingSource === "excel-range";
  const channels: {key: OperatingChannel | "engineLoad"; label: string}[] = [
    {key:"rpm", label:tx("Vòng tua","Engine speed")}, {key:"map", label:"MAP"}, {key:"tps", label:"TPS"},
    {key:"speed", label:tx("Tốc độ","Speed")}, {key:"consumption", label:tx("Tiêu thụ","Fuel use")}, {key:"engineLoad", label:tx("Tải động cơ","Engine load")},
  ];
  return <>
    <div className="telemetry-source-note">
      <span>{excel ? tx("Mô phỏng theo khoảng dữ liệu thật - Chưa hiệu chuẩn","Simulated from real data ranges - Not calibrated") : tx("Mô phỏng theo kịch bản vận hành","Simulated from the driving scenario")}</span>
      <span>{t.connected ? tx("Cập nhật mỗi 1 giây","Updated every second") : tx("Đang chờ kết nối","Waiting for connection")}</span>
    </div>
    {excel && <details className="telemetry-source-details"><summary>{tx("Về dữ liệu mô phỏng","About the simulated data")}</summary><p>{tx("RPM, MAP, TPS, tốc độ và tiêu thụ tham khảo khoảng đã lọc từ Excel. MAP, TPS và tốc độ giữ thang gốc (raw), chưa xác định đơn vị. Tải động cơ, nhiệt độ, điện áp và mức nhiên liệu dùng mô phỏng riêng. Đây không phải số đo hay ngưỡng an toàn đã hiệu chuẩn cho xe.","RPM, MAP, TPS, speed and fuel use follow ranges filtered from the Excel workbook. MAP, TPS and speed keep their raw scale; units are unknown. Engine load, temperatures, voltage and fuel level are simulated separately. These are not calibrated measurements or safety limits for the car.")}</p></details>}
    <div className="live-driving-metrics" aria-label={tx("Thông số vận hành hiện tại","Current operating readings")}>
      {channels.map(({key,label}) => {
        const unit = key === "engineLoad" ? "%" : operatingUnit(t,key);
        return <div key={key} data-channel={key}>
          <span>{label}</span>
          <strong data-testid={`live-${key}`}>{t.connected && t[key] !== undefined ? t[key] : "—"}<small>{unit}</small></strong>
          <div className="operating-trend">{t.connected && <Sparkline values={samples.flatMap(s=>s[key] === undefined ? [] : [s[key]])} />}</div>
        </div>;
      })}
    </div>
  </>;
}

function Metric({
  label,
  value,
  unit,
  icon,
  sub,
  warm = false,
  level = "normal",
  values = [],
  connected,
}: {
  label: string;
  value: string;
  unit: string;
  icon: React.ReactNode;
  sub: string;
  warm?: boolean;
  level?: ThermalLevel;
  values?: number[];
  connected: boolean;
}) {
  const {t} = useLang();
  return (
    <article className={`metric-card ${connected ? level : "unknown"} ${connected && warm ? "warm" : ""}`}>
      <div className="metric-label">
        {label}
        {connected && level === "danger" ? <AlertTriangle size={18} /> : icon}
      </div>
      <div className="metric-middle">
        <span className="metric-value">
          {value}
          <small>{unit}</small>
        </span>
        {connected && <Sparkline values={values} warm={warm} />}
      </div>
      <div className="metric-sub">
        <span className={`tiny-dot ${connected ? "" : "off"}`} />
        {connected ? sub : t("Không có dữ liệu", "No data")}
      </div>
    </article>
  );
}

export function VehicleMetrics({ telemetry: t, samples = [] }: { telemetry: Telemetry; samples?: Telemetry[] }) {
  const {t: tx, lang} = useLang();
  const ev = t.powertrain === "ev";
  const display = (value: number | undefined) =>
    t.connected && value !== undefined ? String(value) : "—";
  const temperature = ev ? t.traction?.batteryTemp : t.coolant;
  const secondary = ev ? t.traction?.motorTemp : t.oil;
  return (
    <div className="metrics-grid">
      <Metric
        label={ev ? tx("Nhiệt độ pin","Battery temp") : tx("Nước làm mát","Coolant")}
        value={display(temperature)}
        unit="°C"
        icon={<Thermometer size={18} />}
        sub={pick(thermalLabels[thermalLevel(t,"cooling")], lang)}
        level={thermalLevel(t,"cooling")}
        warm={["watch","danger"].includes(thermalLevel(t,"cooling"))}
        values={samples.map(s => ev ? s.traction?.batteryTemp ?? 0 : s.coolant)}
        connected={t.connected}
      />
      <Metric
        label={ev ? tx("Nhiệt độ motor","Motor temp") : tx("Nhiệt độ dầu","Oil temp")}
        value={display(secondary)}
        unit="°C"
        icon={<Gauge size={18} />}
        sub={pick(thermalLabels[thermalLevel(t,"engine")], lang)}
        level={thermalLevel(t,"engine")}
        warm={["watch","danger"].includes(thermalLevel(t,"engine"))}
        values={samples.map(s => ev ? s.traction?.motorTemp ?? 0 : s.oil)}
        connected={t.connected}
      />
      <Metric
        label={tx("Điện áp ắc quy 12V","12V battery voltage")}
        value={display(t.battery)}
        unit="V"
        icon={<Zap size={18} />}
        sub={tx("Hệ thống điện phụ trợ","Auxiliary electrical system")}
        values={samples.map(s => s.battery)}
        connected={t.connected}
      />
      <Metric
        label={ev ? tx("Dung lượng pin (SOC)","Battery charge (SOC)") : tx("Nhiên liệu","Fuel")}
        value={display(ev ? t.traction?.soc : t.fuel)}
        unit="%"
        icon={ev ? <Zap size={18} /> : <Fuel size={18} />}
        sub={tx("Dung lượng còn lại","Remaining")}
        values={samples.map(s => ev ? s.traction?.soc ?? 0 : s.fuel)}
        connected={t.connected}
      />
    </div>
  );
}
export function TelemetryReadings({ telemetry: t }: { telemetry: Telemetry }) {
  const {t: tx} = useLang();
  const ev = t.powertrain === "ev";
  const display = (value: number | undefined, unit: string) =>
    t.connected && value !== undefined ? `${value}${unit}` : "—";
  const perMinute = tx(" °C/phút", " °C/min");
  const none = tx("Không có", "None");
  const rangeSource = t.operatingSource === "excel-range" ? tx("Khoảng Excel đã lọc · chưa hiệu chuẩn", "Filtered Excel range · uncalibrated") : tx("Kịch bản mock", "Mock scenario");
  // `thermal` ties a row to the matching sensor highlight, independent of the label language.
  type Row = {label: string; value: string; source: string; thermal?: "cooling" | "engine"};
  const rows: Row[] = ev
    ? [
        {label: tx("Nhiệt độ pin", "Battery temperature"), value: display(t.traction?.batteryTemp, " °C"), source: "BMS mock", thermal: "cooling"},
        {label: tx("Nhiệt độ motor", "Motor temperature"), value: display(t.traction?.motorTemp, " °C"), source: "MCU mock", thermal: "engine"},
        {label: tx("Dung lượng pin (SOC)", "Battery charge (SOC)"), value: display(t.traction?.soc, " %"), source: "BMS mock"},
        {label: tx("Sức khỏe pin (SOH)", "Battery health (SOH)"), value: display(t.traction?.soh, " %"), source: "BMS mock"},
        {label: tx("Xu hướng nhiệt pin", "Battery temperature trend"), value: display(t.traction?.batteryTrend, perMinute), source: tx("Chuỗi BMS mock", "BMS mock series")},
        {label: tx("Nhiệt độ môi trường", "Ambient temperature"), value: display(t.ambient, " °C"), source: "Weather mock / GPS"},
        {label: tx("Điện áp ắc quy 12V", "12V battery voltage"), value: display(t.battery, " V"), source: "CAN mock"},
        {label: tx("Quạt làm mát", "Cooling fan"), value: display(t.fan, " %"), source: "CAN mock"},
        {label: tx("Vận tốc", "Vehicle speed"), value: display(t.speed, " km/h"), source: "GPS mock"},
        {label: tx("Cảnh báo BMS", "BMS warnings"), value: t.connected ? t.dtc.join(", ") || none : "—", source: "BMS mock"},
      ]
    : [
        {label: tx("Trạng thái Fault", "Fault status"), value: t.connected && t.fault !== undefined ? `${t.fault} · ${t.fault === 0 ? tx("Không lỗi", "No fault") : tx("Có lỗi", "Fault")}` : "—", source: "Blackbox mock"},
        {label: tx("Áp suất đường nạp (MAP)", "Manifold pressure (MAP)"), value: display(t.map, ` ${operatingUnit(t,"map")}`), source: rangeSource},
        {label: tx("Vị trí bướm ga (TPS)", "Throttle position (TPS)"), value: display(t.tps, ` ${operatingUnit(t,"tps")}`), source: rangeSource},
        {label: tx("Tải động cơ", "Engine load"), value: display(t.engineLoad, " %"), source: "Blackbox mock"},
        {label: tx("Tiêu thụ nhiên liệu", "Fuel consumption"), value: display(t.consumption, " L/h"), source: rangeSource},
        {label: tx("Nước làm mát", "Coolant"), value: display(t.coolant, " °C"), source: "OBD-II mock", thermal: "cooling"},
        {label: tx("Nhiệt độ dầu", "Oil temperature"), value: display(t.oil, " °C"), source: "OBD-II", thermal: "engine"},
        {label: tx("Nhiệt độ khí nạp", "Intake air temperature"), value: display(t.intake, " °C"), source: "OBD-II"},
        {label: tx("Nhiệt độ môi trường", "Ambient temperature"), value: display(t.ambient, " °C"), source: "Weather mock / GPS"},
        {label: tx("Tốc độ tăng nhiệt", "Heating rate"), value: display(t.coolantTrend, perMinute), source: tx("Chuỗi cảm biến mô phỏng", "Simulated sensor series")},
        {label: tx("Quạt làm mát", "Cooling fan"), value: display(t.fan, " %"), source: "CAN"},
        {label: tx("Vòng tua động cơ", "Engine speed"), value: display(t.rpm, " rpm"), source: rangeSource},
        {label: tx("Vận tốc", "Vehicle speed"), value: display(t.speed, ` ${operatingUnit(t,"speed")}`), source: rangeSource},
        {label: tx("Điện áp ắc quy", "Battery voltage"), value: display(t.battery, " V"), source: "OBD-II"},
        {label: tx("Nhiên liệu", "Fuel"), value: display(t.fuel, " %"), source: "OBD-II"},
        {label: tx("Mã lỗi DTC", "DTC codes"), value: t.connected ? t.dtc.join(", ") || none : "—", source: "OBD-II"},
      ];
  return (
    <>
      <table>
        <thead>
          <tr>
            <th>{tx("Cảm biến", "Sensor")}</th>
            <th>{tx("Giá trị", "Value")}</th>
            <th>{tx("Nguồn", "Source")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className={row.thermal ? `thermal-row ${thermalLevel(t,row.thermal)}` : undefined}>
              <td>{row.label}</td>
              <td>{row.value}</td>
              <td>{row.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {t.powertrain === "hybrid" && (
        <p className="data-timestamp">
          {tx("Bản mock hybrid hiện chỉ mô phỏng nhóm cảm biến động cơ xăng; chưa đánh giá pin hybrid.", "The hybrid mock only simulates petrol-engine sensors; the hybrid battery is not assessed.")}
        </p>
      )}
    </>
  );
}
