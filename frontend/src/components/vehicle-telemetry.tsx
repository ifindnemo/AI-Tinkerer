import { AlertTriangle, Fuel, Gauge, Thermometer, Zap } from "lucide-react";
import {operatingUnit, type OperatingChannel} from "@/lib/telemetry-profile";
import {thermalLevel, thermalLabels, type ThermalLevel} from "@/lib/thermal-status";
import type { Telemetry } from "@/lib/telemetry";
function Sparkline({values, warm = false}: {values: number[]; warm?: boolean}) {
  if (values.length < 2) return <span className="sparkline-pending">Đang lấy mẫu</span>;
  const low = Math.min(...values) - 0.2;
  const range = Math.max(...values) + 0.2 - low;
  const path = values.map((value, index) => `${index === 0 ? "M" : "L"}${index / (values.length - 1) * 110} ${32 - (value - low) / range * 26}`).join(" ");
  return <svg className={`sparkline ${warm ? "warm" : ""}`} viewBox="0 0 110 38" aria-label={`Xu hướng ${values.length} mẫu gần nhất`} role="img"><path d={path} fill="none" stroke="currentColor" strokeWidth="1.7" /></svg>;
}


export function OperatingMetrics({telemetry: t, samples}: {telemetry: Telemetry; samples: Telemetry[]}) {
  const excel = t.operatingSource === "excel-range";
  const channels: {key: OperatingChannel | "engineLoad"; label: string}[] = [
    {key:"rpm", label:"Vòng tua"}, {key:"map", label:"MAP"}, {key:"tps", label:"TPS"},
    {key:"speed", label:"Tốc độ"}, {key:"consumption", label:"Tiêu thụ"}, {key:"engineLoad", label:"Tải động cơ"},
  ];
  return <>
    <div className="telemetry-source-note">
      <span>{excel ? "Mô phỏng theo khoảng dữ liệu thật - Chưa hiệu chuẩn" : "Mô phỏng theo kịch bản vận hành"}</span>
      <span>{t.connected ? "Cập nhật mỗi 1 giây" : "Đang chờ kết nối"}</span>
    </div>
    {excel && <details className="telemetry-source-details"><summary>Về dữ liệu mô phỏng</summary><p>RPM, MAP, TPS, tốc độ và tiêu thụ tham khảo khoảng đã lọc từ Excel. MAP, TPS và tốc độ giữ thang gốc (raw), chưa xác định đơn vị. Tải động cơ, nhiệt độ, điện áp và mức nhiên liệu dùng mô phỏng riêng. Đây không phải số đo hay ngưỡng an toàn đã hiệu chuẩn cho xe.</p></details>}
    <div className="live-driving-metrics" aria-label="Thông số vận hành hiện tại">
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
        {connected ? sub : "Không có dữ liệu"}
      </div>
    </article>
  );
}

export function VehicleMetrics({ telemetry: t, samples = [] }: { telemetry: Telemetry; samples?: Telemetry[] }) {
  const ev = t.powertrain === "ev";
  const display = (value: number | undefined) =>
    t.connected && value !== undefined ? String(value) : "—";
  const temperature = ev ? t.traction?.batteryTemp : t.coolant;
  const secondary = ev ? t.traction?.motorTemp : t.oil;
  return (
    <div className="metrics-grid">
      <Metric
        label={ev ? "Nhiệt độ pin" : "Nước làm mát"}
        value={display(temperature)}
        unit="°C"
        icon={<Thermometer size={18} />}
        sub={thermalLabels[thermalLevel(t,"cooling")]}
        level={thermalLevel(t,"cooling")}
        warm={["watch","danger"].includes(thermalLevel(t,"cooling"))}
        values={samples.map(s => ev ? s.traction?.batteryTemp ?? 0 : s.coolant)}
        connected={t.connected}
      />
      <Metric
        label={ev ? "Nhiệt độ motor" : "Nhiệt độ dầu"}
        value={display(secondary)}
        unit="°C"
        icon={<Gauge size={18} />}
        sub={thermalLabels[thermalLevel(t,"engine")]}
        level={thermalLevel(t,"engine")}
        warm={["watch","danger"].includes(thermalLevel(t,"engine"))}
        values={samples.map(s => ev ? s.traction?.motorTemp ?? 0 : s.oil)}
        connected={t.connected}
      />
      <Metric
        label="Điện áp ắc quy 12V"
        value={display(t.battery)}
        unit="V"
        icon={<Zap size={18} />}
        sub="Hệ thống điện phụ trợ"
        values={samples.map(s => s.battery)}
        connected={t.connected}
      />
      <Metric
        label={ev ? "Dung lượng pin (SOC)" : "Nhiên liệu"}
        value={display(ev ? t.traction?.soc : t.fuel)}
        unit="%"
        icon={ev ? <Zap size={18} /> : <Fuel size={18} />}
        sub="Dung lượng còn lại"
        values={samples.map(s => ev ? s.traction?.soc ?? 0 : s.fuel)}
        connected={t.connected}
      />
    </div>
  );
}
export function TelemetryReadings({ telemetry: t }: { telemetry: Telemetry }) {
  const ev = t.powertrain === "ev";
  const display = (value: number | undefined, unit: string) =>
    t.connected && value !== undefined ? `${value}${unit}` : "—";
  const rangeSource = t.operatingSource === "excel-range" ? "Khoảng Excel đã lọc · chưa hiệu chuẩn" : "Kịch bản mock";
  const rows = ev
    ? [
        ["Nhiệt độ pin", display(t.traction?.batteryTemp, " °C"), "BMS mock"],
        ["Nhiệt độ motor", display(t.traction?.motorTemp, " °C"), "MCU mock"],
        ["Dung lượng pin (SOC)", display(t.traction?.soc, " %"), "BMS mock"],
        ["Sức khỏe pin (SOH)", display(t.traction?.soh, " %"), "BMS mock"],
        [
          "Xu hướng nhiệt pin",
          display(t.traction?.batteryTrend, " °C/phút"),
          "Chuỗi BMS mock",
        ],
        [
          "Nhiệt độ môi trường",
          display(t.ambient, " °C"),
          "Weather mock / GPS",
        ],
        ["Điện áp ắc quy 12V", display(t.battery, " V"), "CAN mock"],
        ["Quạt làm mát", display(t.fan, " %"), "CAN mock"],
        ["Vận tốc", display(t.speed, " km/h"), "GPS mock"],
        [
          "Cảnh báo BMS",
          t.connected ? t.dtc.join(", ") || "Không có" : "—",
          "BMS mock",
        ],
      ]
    : [
        ["Trạng thái Fault", t.connected && t.fault !== undefined ? `${t.fault} · ${t.fault === 0 ? "Không lỗi" : "Có lỗi"}` : "—", "Blackbox mock"],
        ["Áp suất đường nạp (MAP)", display(t.map, ` ${operatingUnit(t,"map")}`), rangeSource],
        ["Vị trí bướm ga (TPS)", display(t.tps, ` ${operatingUnit(t,"tps")}`), rangeSource],
        ["Tải động cơ", display(t.engineLoad, " %"), "Blackbox mock"],
        ["Tiêu thụ nhiên liệu", display(t.consumption, " L/h"), rangeSource],
        ["Nước làm mát", display(t.coolant, " °C"), "OBD-II mock"],
        ["Nhiệt độ dầu", display(t.oil, " °C"), "OBD-II"],
        ["Nhiệt độ khí nạp", display(t.intake, " °C"), "OBD-II"],
        [
          "Nhiệt độ môi trường",
          display(t.ambient, " °C"),
          "Weather mock / GPS",
        ],
        [
          "Tốc độ tăng nhiệt",
          display(t.coolantTrend, " °C/phút"),
          "Chuỗi cảm biến mô phỏng",
        ],
        ["Quạt làm mát", display(t.fan, " %"), "CAN"],
        ["Vòng tua động cơ", display(t.rpm, " rpm"), rangeSource],
        ["Vận tốc", display(t.speed, ` ${operatingUnit(t,"speed")}`), rangeSource],
        ["Điện áp ắc quy", display(t.battery, " V"), "OBD-II"],
        ["Nhiên liệu", display(t.fuel, " %"), "OBD-II"],
        [
          "Mã lỗi DTC",
          t.connected ? t.dtc.join(", ") || "Không có" : "—",
          "OBD-II",
        ],
      ];
  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Cảm biến</th>
            <th>Giá trị</th>
            <th>Nguồn</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]} className={["Nước làm mát","Nhiệt độ pin"].includes(row[0]) ? `thermal-row ${thermalLevel(t,"cooling")}` : ["Nhiệt độ dầu","Nhiệt độ motor"].includes(row[0]) ? `thermal-row ${thermalLevel(t,"engine")}` : undefined}>
              {row.map((value, i) => (
                <td key={i}>{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {t.powertrain === "hybrid" && (
        <p className="data-timestamp">
          Bản mock hybrid hiện chỉ mô phỏng nhóm cảm biến động cơ xăng; chưa
          đánh giá pin hybrid.
        </p>
      )}
    </>
  );
}
