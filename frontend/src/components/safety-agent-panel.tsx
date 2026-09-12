"use client";

import { Activity, ArrowRight, Check, ChevronRight, Clock3, LifeBuoy, LoaderCircle, MapPin, ShieldCheck, Sparkles, X } from "lucide-react";
import { statusLabels, type SafetyIncident } from "@/lib/safety-agent";
import type { DriverCommand } from "@/lib/vehicle-session/types";
import {operatingUnit} from "@/lib/telemetry-profile";
import type { Telemetry } from "@/lib/telemetry";

export default function SafetyAgentPanel({incident: s, telemetry: t, onCommand, onInject, failNext, onFailNext}: {
  incident: SafetyIncident | null; telemetry: Telemetry;
  onCommand: (command: DriverCommand) => void; onInject: () => void;
  failNext: boolean; onFailNext: (value: boolean) => void;
}) {
  const action = s?.action;
  const isNav = action?.kind === "NAVIGATE_SAFE_STOP";
  const connected = t.connected;
  let message: string;
  if (!s) message = connected ? "Mình đang theo dõi chiếc xe. Chưa có sự cố nóng máy cần xử lý." : "Chưa nhận được gói dữ liệu. Chờ kết nối blackbox để đánh giá.";
  else if (!connected) message = "Mất kết nối blackbox. Chưa thể xác nhận tình trạng mới hoặc thực hiện hành động.";
  else if (s.status === "RESOLVED") message = "Nhiệt đã ổn định. Kết thúc xử lý khẩn cấp; nguyên nhân và mã lỗi vẫn cần được kiểm tra.";
  else if (s.status === "STABILIZING") message = "Nhiệt độ đang giảm. Giữ xe tại vị trí an toàn, mình tiếp tục theo dõi.";
  else if (s.rescueDone) message = "Cứu hộ demo đã xác nhận. Giữ xe tại nơi an toàn và chờ hỗ trợ.";
  else if (s.phase === "stopped") message = "Xe đã dừng, nhưng nhiệt độ vẫn cao. Bạn có muốn yêu cầu cứu hộ?";
  else if (s.phase === "slowing") message = s.navigationDone ? "Hướng dẫn dừng đã sẵn sàng. Mình đang chờ dữ liệu xác nhận xe đã dừng." : "Xe đã giảm tốc nhưng nhiệt vẫn tăng. Ưu tiên tìm nơi dừng an toàn.";
  else message = s.driverAcknowledged ? "Đã nhận phản hồi. Mình đang kiểm tra tốc độ, tải động cơ và nhiệt độ của xe." : "Nhiệt động cơ tăng nhanh. Hãy giảm tốc phù hợp và chuẩn bị dừng tại vị trí an toàn.";
  return <section className={`safety-agent-panel ${s?.severity.toLowerCase() ?? "low"}`} aria-label="Vehicle Safety Agent">
    <div className="agent-heading"><span className="agent-avatar"><Sparkles size={20} /></span><div><span className="section-kicker">ĐỒNG HÀNH CÙNG CHIẾC XE</span><h2>Safety Agent</h2></div><span className="agent-demo-badge">MOCK</span></div>
    <div className="agent-state-row"><span className={`agent-state ${s?.severity.toLowerCase() ?? "low"}`} data-testid="incident-status">{s ? statusLabels[s.status] : statusLabels.MONITORING}</span><span>{!connected ? "Ngoại tuyến" : t.speed > 0 ? `Đang chạy · ${t.speed} ${operatingUnit(t,"speed")}` : "Xe đã dừng"}</span></div>
    <div className="agent-message" aria-live="polite"><p>{message}</p></div>
    <div className="agent-risk-line"><span>Mức nguy cơ: <b>{s ? s.severity === "CRITICAL" ? "Nghiêm trọng" : s.severity === "HIGH" ? "Cao" : "Đã giảm" : "Chưa phát hiện nóng máy"}</b></span><small>Độ tin cậy: chưa có từ backend</small></div>
    {s && <>
      <details className="agent-evidence"><summary><Activity size={14} /> Bằng chứng từ gói hiện tại <ChevronRight size={13} /></summary>
        {connected ? <dl><div><dt>Nước làm mát</dt><dd>{t.coolant}°C</dd></div><div><dt>RPM / tải</dt><dd>{t.rpm} / {t.engineLoad}%</dd></div><div><dt>Quạt làm mát</dt><dd>{t.fan === 0 ? "OFF" : `${t.fan}%`}</dd></div><div><dt>DTC</dt><dd>{t.dtc.join(", ") || "—"}</dd></div></dl> : <p>Đang chờ dữ liệu mới.</p>}
        <p>Nhận định từ quy tắc mô phỏng. Chưa xác định bộ phận bị hỏng.</p>
      </details>
      {s.phase === "moving" && !s.driverAcknowledged && <button className="agent-button secondary" disabled={!connected} onClick={() => onCommand({type:"ACKNOWLEDGE"})}>Tôi đang giảm tốc <Check size={15} /></button>}
      {s.phase === "moving" && s.driverAcknowledged && <div className="agent-monitor"><Activity size={15} /> Đang theo dõi phản ứng qua telemetry</div>}
      {action && s.status !== "RESOLVED" && s.status !== "STABILIZING" && <div className="agent-action-card" aria-label={isNav ? "Xác nhận điều hướng" : "Xác nhận cứu hộ"}>
        <div className="agent-action-title">{isNav ? <MapPin size={18} /> : <LifeBuoy size={18} />}<h3>{isNav ? "Điểm dừng an toàn đề xuất" : "Yêu cầu hỗ trợ cứu hộ"}</h3></div>
        {isNav ? <><strong>Bãi dừng mô phỏng</strong><p>650 m · khoảng 2 phút · dữ liệu địa điểm minh họa, chưa xác minh tuyến đường thực tế.</p></> : <p>Gửi yêu cầu kèm vị trí và thông tin sự cố để đơn vị hỗ trợ nắm tình trạng xe.</p>}
        {action.status === "proposed" && <>
          <details className="agent-share-details"><summary>Dữ liệu bạn sẽ cho phép sử dụng</summary><dl><div><dt>Xe</dt><dd>{action.payload.vehicleName}</dd></div><div><dt>Tọa độ</dt><dd>{action.payload.latitude}, {action.payload.longitude}</dd></div>{!isNav && <><div><dt>Nhiệt độ / DTC</dt><dd>{action.payload.coolant}°C / {action.payload.dtc.join(", ")}</dd></div><div><dt>Sự cố</dt><dd>{action.payload.incidentId.slice(0,8)}</dd></div></>}</dl><small>Gói chụp lúc {new Date(action.payload.capturedAt).toLocaleTimeString("vi-VN")}. Dữ liệu chỉ được xử lý trong demo này.</small></details>
          <p className="agent-confirm-note">{isNav ? "Xác nhận để dùng vị trí xe và mở hướng dẫn mô phỏng." : "Xác nhận cả yêu cầu cứu hộ và việc chia sẻ vị trí, thông tin xe, dữ liệu sự cố trong mô phỏng."}</p>
          <button className="agent-button" disabled={!connected} onClick={() => onCommand({type:"CONFIRM", actionId:action.id})}>{isNav ? "Xác nhận hướng dẫn dừng (demo)" : "Xác nhận cứu hộ & chia sẻ (demo)"}<ArrowRight size={15} /></button>
          <button className="agent-button quiet" disabled={!connected} onClick={() => onCommand({type:"DECLINE",actionId:action.id})}><X size={14} /> Chưa đồng ý</button>
        </>}
        {action.status === "pending" && <div className="agent-monitor" role="status"><LoaderCircle size={16} className="spin" /> Đang xử lý yêu cầu mô phỏng…</div>}
        {action.status === "declined" && <><p role="status">Chưa gửi yêu cầu. Mình tiếp tục theo dõi xe.</p><button className="agent-button secondary" disabled={!connected} onClick={() => onCommand({type:"REOPEN",actionId:action.id})}>Xem lại đề xuất</button></>}
        {action.status === "failed" && <><p className="agent-tool-error" role="alert">{action.error}</p><button className="agent-button" disabled={!connected} onClick={() => onCommand({type:"CONFIRM",actionId:action.id})}>Thử lại yêu cầu đã xác nhận</button></>}
        {action.status === "succeeded" && <div className="agent-tool-success" role="status"><Check size={17} /><div><b>{isNav ? "Hướng dẫn demo đã sẵn sàng" : "Cứu hộ demo đã xác nhận"}</b><p>{action.result?.message}</p><small>{action.result?.requestId}</small></div></div>}
      </div>}
      {s.status === "RESOLVED" && <div className="agent-resolution"><ShieldCheck size={21} /><div><b>Đã hoàn tất luồng an toàn</b><p>Xe đã dừng, nhiệt ổn định, yêu cầu hỗ trợ demo đã được ghi nhận. Chưa xác nhận xe đã được sửa hoặc an toàn để tiếp tục chạy.</p></div></div>}
      <details className="agent-timeline"><summary><Clock3 size={14} /> Tiến trình sự cố <span>{s.timeline.length}</span></summary><ol>{s.timeline.map(item => <li key={item.id}><time>{new Date(item.at).toLocaleTimeString("vi-VN")}</time><p>{item.message}</p></li>)}</ol><small>Incident {s.id.slice(0,8)} · cùng chiếc xe</small></details>
    </>}
    <details className="agent-simulator" open={!s}>
      <summary>Kịch bản demo</summary>
      <p>Các nút bên dưới chỉ đổi dữ liệu mô phỏng, không điều khiển phương tiện. Chuỗi theo dõi và hạ nhiệt được rút gọn thời gian.</p>
      {!s ? <button className="agent-button" disabled={!connected} onClick={onInject}>Inject Overheating <ArrowRight size={15} /></button> : <div className="agent-sim-buttons">
        <button disabled={!connected || s.phase !== "moving"} onClick={() => onCommand({type:"SIMULATE",phase:"slowing"})}>Mô phỏng xe giảm tốc</button>
        <button disabled={!connected || !["moving","slowing"].includes(s.phase)} onClick={() => onCommand({type:"SIMULATE",phase:"stopped"})}>Mô phỏng xe đã dừng</button>
        <button disabled={!connected || s.phase !== "stopped" || !s.rescueDone} onClick={() => onCommand({type:"SIMULATE",phase:"cooling"})}>Mô phỏng chuỗi hạ nhiệt</button>
      </div>}
      <label className="agent-failure-toggle"><input type="checkbox" checked={failNext} onChange={event => onFailNext(event.target.checked)} /> Giả lập lỗi ở lần gọi hành động tiếp theo</label>
    </details>
    <p className="agent-boundary">Agent và tool đang mô phỏng · không gửi vị trí, mở bản đồ hay gọi cứu hộ thật.</p>
  </section>;
}
