"use client";

import { Activity, ArrowRight, Check, ChevronRight, Clock3, LifeBuoy, LoaderCircle, MapPin, ShieldCheck, Sparkles, X } from "lucide-react";
import { statusLabels, type SafetyIncident } from "@/lib/safety-agent";
import type { DriverCommand } from "@/lib/vehicle-session/types";
import {operatingUnit} from "@/lib/telemetry-profile";
import type { Telemetry } from "@/lib/telemetry";
import { useLang } from "@/hooks/use-preferences";
import { pick } from "@/lib/preferences";

export default function SafetyAgentPanel({incident: s, telemetry: t, onCommand, onInject, failNext, onFailNext}: {
  incident: SafetyIncident | null; telemetry: Telemetry;
  onCommand: (command: DriverCommand) => void; onInject: () => void;
  failNext: boolean; onFailNext: (value: boolean) => void;
}) {
  const {t: tx, lang, time} = useLang();
  const action = s?.action;
  const isNav = action?.kind === "NAVIGATE_SAFE_STOP";
  const connected = t.connected;
  let message: string;
  if (!s) message = connected ? tx("Mình đang theo dõi chiếc xe. Chưa có sự cố nóng máy cần xử lý.", "I'm watching your car. No overheating incident to handle.") : tx("Chưa nhận được gói dữ liệu. Chờ kết nối blackbox để đánh giá.", "No data batch yet. Waiting for the blackbox to connect.");
  else if (!connected) message = tx("Mất kết nối blackbox. Chưa thể xác nhận tình trạng mới hoặc thực hiện hành động.", "Blackbox disconnected. Cannot confirm the new state or take action.");
  else if (s.status === "RESOLVED") message = tx("Nhiệt đã ổn định. Kết thúc xử lý khẩn cấp; nguyên nhân và mã lỗi vẫn cần được kiểm tra.", "Temperature is stable. Emergency handling ended; the cause and fault code still need checking.");
  else if (s.status === "STABILIZING") message = tx("Nhiệt độ đang giảm. Giữ xe tại vị trí an toàn, mình tiếp tục theo dõi.", "Temperature is falling. Keep the car in a safe place; I'm still watching.");
  else if (s.rescueDone) message = tx("Cứu hộ demo đã xác nhận. Giữ xe tại nơi an toàn và chờ hỗ trợ.", "Demo assistance confirmed. Stay in a safe place and wait for help.");
  else if (s.phase === "stopped") message = tx("Xe đã dừng, nhưng nhiệt độ vẫn cao. Bạn có muốn yêu cầu cứu hộ?", "The car has stopped but is still hot. Request roadside assistance?");
  else if (s.phase === "slowing") message = s.navigationDone ? tx("Hướng dẫn dừng đã sẵn sàng. Mình đang chờ dữ liệu xác nhận xe đã dừng.", "Stop directions are ready. Waiting for data confirming the car has stopped.") : tx("Xe đã giảm tốc nhưng nhiệt vẫn tăng. Ưu tiên tìm nơi dừng an toàn.", "The car slowed down but is still heating up. Find a safe place to stop.");
  else message = s.driverAcknowledged ? tx("Đã nhận phản hồi. Mình đang kiểm tra tốc độ, tải động cơ và nhiệt độ của xe.", "Got it. I'm checking speed, engine load and temperature.") : tx("Nhiệt động cơ tăng nhanh. Hãy giảm tốc phù hợp và chuẩn bị dừng tại vị trí an toàn.", "Engine temperature is rising fast. Slow down and prepare to stop in a safe place.");
  return <section className={`safety-agent-panel ${s?.severity.toLowerCase() ?? "low"}`} aria-label="Vehicle Safety Agent">
    <div className="agent-heading"><span className="agent-avatar"><Sparkles size={20} /></span><div><span className="section-kicker">{tx("ĐỒNG HÀNH CÙNG CHIẾC XE", "YOUR CAR COMPANION")}</span><h2>Safety Agent</h2></div><span className="agent-demo-badge">MOCK</span></div>
    <div className="agent-state-row"><span className={`agent-state ${s?.severity.toLowerCase() ?? "low"}`} data-testid="incident-status">{pick(s ? statusLabels[s.status] : statusLabels.MONITORING, lang)}</span><span>{!connected ? tx("Ngoại tuyến", "Offline") : t.speed > 0 ? `${tx("Đang chạy", "Driving")} · ${t.speed} ${operatingUnit(t,"speed")}` : tx("Xe đã dừng", "Stopped")}</span></div>
    <div className="agent-message" aria-live="polite"><p>{message}</p></div>
    <div className="agent-risk-line"><span>{tx("Mức nguy cơ", "Risk level")}: <b>{s ? s.severity === "CRITICAL" ? tx("Nghiêm trọng", "Critical") : s.severity === "HIGH" ? tx("Cao", "High") : tx("Đã giảm", "Reduced") : tx("Chưa phát hiện nóng máy", "No overheating detected")}</b></span><small>{tx("Độ tin cậy: chưa có từ backend", "Confidence: not available without the backend")}</small></div>
    {s && <>
      <details className="agent-evidence"><summary><Activity size={14} /> {tx("Bằng chứng từ gói hiện tại", "Evidence from the current batch")} <ChevronRight size={13} /></summary>
        {connected ? <dl><div><dt>{tx("Nước làm mát", "Coolant")}</dt><dd>{t.coolant}°C</dd></div><div><dt>{tx("RPM / tải", "RPM / load")}</dt><dd>{t.rpm} / {t.engineLoad}%</dd></div><div><dt>{tx("Quạt làm mát", "Cooling fan")}</dt><dd>{t.fan === 0 ? "OFF" : `${t.fan}%`}</dd></div><div><dt>DTC</dt><dd>{t.dtc.join(", ") || "—"}</dd></div></dl> : <p>{tx("Đang chờ dữ liệu mới.", "Waiting for fresh data.")}</p>}
        <p>{tx("Nhận định từ quy tắc mô phỏng. Chưa xác định bộ phận bị hỏng.", "Based on simulated rules. No failed part identified.")}</p>
      </details>
      {s.phase === "moving" && !s.driverAcknowledged && <button className="agent-button secondary" disabled={!connected} onClick={() => onCommand({type:"ACKNOWLEDGE"})}>{tx("Tôi đang giảm tốc", "I'm slowing down")} <Check size={15} /></button>}
      {s.phase === "moving" && s.driverAcknowledged && <div className="agent-monitor"><Activity size={15} /> {tx("Đang theo dõi phản ứng qua telemetry", "Watching the response through telemetry")}</div>}
      {action && s.status !== "RESOLVED" && s.status !== "STABILIZING" && <div className="agent-action-card" aria-label={isNav ? tx("Xác nhận điều hướng", "Confirm directions") : tx("Xác nhận cứu hộ", "Confirm assistance")}>
        <div className="agent-action-title">{isNav ? <MapPin size={18} /> : <LifeBuoy size={18} />}<h3>{isNav ? tx("Điểm dừng an toàn đề xuất", "Suggested safe stop") : tx("Yêu cầu hỗ trợ cứu hộ", "Request roadside assistance")}</h3></div>
        {isNav ? <><strong>{tx("Bãi dừng mô phỏng", "Simulated stopping area")}</strong><p>{tx("650 m · khoảng 2 phút · dữ liệu địa điểm minh họa, chưa xác minh tuyến đường thực tế.", "650 m · about 2 min · illustrative place data, route not verified.")}</p></> : <p>{tx("Gửi yêu cầu kèm vị trí và thông tin sự cố để đơn vị hỗ trợ nắm tình trạng xe.", "Send the request with location and incident details so the provider knows the situation.")}</p>}
        {action.status === "proposed" && <>
          <details className="agent-share-details"><summary>{tx("Dữ liệu bạn sẽ cho phép sử dụng", "Data you will share")}</summary><dl><div><dt>{tx("Xe", "Car")}</dt><dd>{action.payload.vehicleName}</dd></div><div><dt>{tx("Tọa độ", "Coordinates")}</dt><dd>{action.payload.latitude}, {action.payload.longitude}</dd></div>{!isNav && <><div><dt>{tx("Nhiệt độ / DTC", "Temperature / DTC")}</dt><dd>{action.payload.coolant}°C / {action.payload.dtc.join(", ")}</dd></div><div><dt>{tx("Sự cố", "Incident")}</dt><dd>{action.payload.incidentId.slice(0,8)}</dd></div></>}</dl><small>{tx("Gói chụp lúc", "Captured at")} {time(action.payload.capturedAt)}. {tx("Dữ liệu chỉ được xử lý trong demo này.", "Data is only processed in this demo.")}</small></details>
          <p className="agent-confirm-note">{isNav ? tx("Xác nhận để dùng vị trí xe và mở hướng dẫn mô phỏng.", "Confirm to use the car location and open simulated directions.") : tx("Xác nhận cả yêu cầu cứu hộ và việc chia sẻ vị trí, thông tin xe, dữ liệu sự cố trong mô phỏng.", "Confirm the assistance request and sharing of location, car and incident data in the simulation.")}</p>
          <button className="agent-button" disabled={!connected} onClick={() => onCommand({type:"CONFIRM", actionId:action.id})}>{isNav ? tx("Xác nhận hướng dẫn dừng (demo)", "Confirm stop directions (demo)") : tx("Xác nhận cứu hộ & chia sẻ (demo)", "Confirm assistance & sharing (demo)")}<ArrowRight size={15} /></button>
          <button className="agent-button quiet" disabled={!connected} onClick={() => onCommand({type:"DECLINE",actionId:action.id})}><X size={14} /> {tx("Chưa đồng ý", "Not now")}</button>
        </>}
        {action.status === "pending" && <div className="agent-monitor" role="status"><LoaderCircle size={16} className="spin" /> {tx("Đang xử lý yêu cầu mô phỏng…", "Processing the simulated request…")}</div>}
        {action.status === "declined" && <><p role="status">{tx("Chưa gửi yêu cầu. Mình tiếp tục theo dõi xe.", "Request not sent. I keep watching the car.")}</p><button className="agent-button secondary" disabled={!connected} onClick={() => onCommand({type:"REOPEN",actionId:action.id})}>{tx("Xem lại đề xuất", "Review the suggestion")}</button></>}
        {action.status === "failed" && <><p className="agent-tool-error" role="alert">{action.error}</p><button className="agent-button" disabled={!connected} onClick={() => onCommand({type:"CONFIRM",actionId:action.id})}>{tx("Thử lại yêu cầu đã xác nhận", "Retry the confirmed request")}</button></>}
        {action.status === "succeeded" && <div className="agent-tool-success" role="status"><Check size={17} /><div><b>{isNav ? tx("Hướng dẫn demo đã sẵn sàng", "Demo directions ready") : tx("Cứu hộ demo đã xác nhận", "Demo assistance confirmed")}</b><p>{action.result?.message}</p><small>{action.result?.requestId}</small></div></div>}
      </div>}
      {s.status === "RESOLVED" && <div className="agent-resolution"><ShieldCheck size={21} /><div><b>{tx("Đã hoàn tất luồng an toàn", "Safety flow completed")}</b><p>{tx("Xe đã dừng, nhiệt ổn định, yêu cầu hỗ trợ demo đã được ghi nhận. Chưa xác nhận xe đã được sửa hoặc an toàn để tiếp tục chạy.", "The car stopped, temperature is stable and the demo assistance request was logged. Not confirmed as repaired or safe to drive.")}</p></div></div>}
      <details className="agent-timeline"><summary><Clock3 size={14} /> {tx("Tiến trình sự cố", "Incident timeline")} <span>{s.timeline.length}</span></summary><ol>{s.timeline.map(item => <li key={item.id}><time>{time(item.at)}</time><p>{item.message}</p></li>)}</ol><small>Incident {s.id.slice(0,8)} · {tx("cùng chiếc xe", "same car")}</small></details>
    </>}
    <details className="agent-simulator" open={!s}>
      <summary>{tx("Kịch bản demo", "Demo controls")}</summary>
      <p>{tx("Các nút bên dưới chỉ đổi dữ liệu mô phỏng, không điều khiển phương tiện. Chuỗi theo dõi và hạ nhiệt được rút gọn thời gian.", "These buttons only change simulated data; they do not control the car. Monitoring and cool-down are time-compressed.")}</p>
      {!s ? <button className="agent-button" disabled={!connected} onClick={onInject}>{tx("Mô phỏng quá nhiệt", "Inject overheating")} <ArrowRight size={15} /></button> : <div className="agent-sim-buttons">
        <button disabled={!connected || s.phase !== "moving"} onClick={() => onCommand({type:"SIMULATE",phase:"slowing"})}>{tx("Mô phỏng xe giảm tốc", "Simulate slowing down")}</button>
        <button disabled={!connected || !["moving","slowing"].includes(s.phase)} onClick={() => onCommand({type:"SIMULATE",phase:"stopped"})}>{tx("Mô phỏng xe đã dừng", "Simulate stopped")}</button>
        <button disabled={!connected || s.phase !== "stopped" || !s.rescueDone} onClick={() => onCommand({type:"SIMULATE",phase:"cooling"})}>{tx("Mô phỏng chuỗi hạ nhiệt", "Simulate cool-down")}</button>
      </div>}
      <label className="agent-failure-toggle"><input type="checkbox" checked={failNext} onChange={event => onFailNext(event.target.checked)} /> {tx("Giả lập lỗi ở lần gọi hành động tiếp theo", "Fail the next action call")}</label>
    </details>
    <p className="agent-boundary">{tx("Agent và tool đang mô phỏng · không gửi vị trí, mở bản đồ hay gọi cứu hộ thật.", "Agent and tools are simulated · no location is sent, no map opened and no real assistance called.")}</p>
  </section>;
}
