"use client";
import type {ComponentProps} from "react";
import {Activity, ArrowRight, Check, CircleCheck, Clock3, History, LoaderCircle, Radio, Sparkles, WifiOff} from "lucide-react";
import SafetyAgentPanel from "./safety-agent-panel";
import type {AgentCycle} from "@/lib/periodic-agent/mock";
import type {BlackboxTransfer} from "@/lib/blackbox/types";
const time=(iso:string)=>new Date(iso).toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
type Props=ComponentProps<typeof SafetyAgentPanel> & {agentCycle:AgentCycle;blackbox:BlackboxTransfer;onViewTelemetry:()=>void};

export default function VehicleAgentPanel({agentCycle:cycle,blackbox,onViewTelemetry,...safety}:Props){
  // Preserve the separate intervention workflow when a fault scenario is active.
  if(safety.incident || safety.telemetry.scenario==="environment")return <SafetyAgentPanel {...safety}/>;
  const connected=safety.telemetry.connected;
  const processing=connected && ["sending","analyzing"].includes(cycle.phase);
  const response=cycle.response;
  const current=connected && cycle.phase!=="paused" && cycle.phase!=="collecting";
  const step=processing ? 1 : response && current ? 2 : 0;
  const label=!connected ? "Tạm dừng theo dõi" : cycle.phase==="sending" ? "Đang gửi gói mô phỏng" : cycle.phase==="analyzing" ? "Agent đang phân tích" : response && current ? "Đã cập nhật nhận xét" : "Đang thu thập dữ liệu";
  return <section className={`safety-agent-panel periodic-agent ${!connected?"disconnected":""}`} aria-label="Vehicle Safety Agent">
    <header className="periodic-agent-heading"><span className="periodic-agent-avatar"><Sparkles size={22}/></span><div><span className="section-kicker">ĐỒNG HÀNH CÙNG CHIẾC XE</span><h2>Car Neuron Agent</h2></div><span className="agent-demo-badge">MÔ PHỎNG</span></header>
    <div className="periodic-agent-status" data-testid="periodic-agent-phase" data-phase={connected?cycle.phase:"paused"}>
      {!connected?<WifiOff size={14}/>:processing?<LoaderCircle size={14} className="spin"/>:<span className="agent-live-dot"/>}<span>{label}</span>
    </div>
    <ol className="agent-cycle-steps" aria-label="Chu kỳ agent">{["Thu thập","Phân tích","Đề xuất"].map((text,i)=><li key={text} className={i<=step&&connected?"active":""} aria-current={i===step?"step":undefined}><span>{i<step?<Check size={10}/>:i+1}</span>{text}</li>)}</ol>
    <div className="agent-batch-progress">
      <div><span>{processing?"Đang xử lý 15 mẫu vừa nhận":response?"Đang chuẩn bị lượt tiếp theo":"Chờ gói dữ liệu đầu tiên"}</span><b>{connected?`${blackbox.buffered}/15 mẫu`:"Đã tạm dừng"}</b></div>
      <div className="agent-sample-segments" role="progressbar" aria-label="Số mẫu trong gói tiếp theo" aria-valuemin={0} aria-valuemax={15} aria-valuenow={blackbox.buffered}>{Array.from({length:15},(_,i)=><span className={connected&&i<blackbox.buffered?"filled":""} key={i}/>)}</div>
      <small>{!connected?"Kết nối lại để tiếp tục nhận dữ liệu.":processing?"Phản hồi mới sẽ xuất hiện sau khi phân tích xong.":`Dự kiến kiểm tra tiếp sau ${15-blackbox.buffered} giây · 1 mẫu/giây`}</small>
    </div>
    <div className="periodic-agent-content" aria-live="polite" aria-atomic="true" aria-busy={processing}>
      {response ? <article className={`agent-response ${!current?"previous":""}`} data-testid="agent-response" data-response-id={response.id}>
        <div className="agent-response-meta"><span>{current?"NHẬN XÉT MỚI NHẤT":"PHẢN HỒI TRƯỚC ĐÓ"}</span><time dateTime={response.completedAt} data-testid="agent-response-time">{time(response.completedAt)}</time></div>
        <div className="agent-verdict"><CircleCheck size={21}/><h3>{response.title}</h3></div>
        <p>{response.summary}</p>
        <dl className="agent-observations">{response.observations.map(item=><div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
        <div className="agent-recommendations"><h4>Đề xuất cho bạn</h4>{response.recommendations.map((item,i)=><div className="agent-recommendation" key={item.title}><span>{i+1}</span><div><b>{item.title}</b><p>{item.detail}</p></div></div>)}</div>
        <footer><Check size={12}/>15 mẫu · {time(response.windowStart)}–{time(response.windowEnd)}</footer>
      </article> : <div className="agent-listening"><span className="agent-listening-icon">{connected?<Radio size={25}/>:<WifiOff size={25}/>}</span><h3>{connected?"Mình đang lắng nghe chiếc xe":"Đang chờ kết nối blackbox"}</h3><p>{connected?"Sau mỗi 15 mẫu, mình sẽ gửi lại nhận xét ngắn gọn cùng đề xuất cho bạn.":"Chưa có dữ liệu mới để đưa ra nhận xét."}</p><div className="agent-empty-tags"><span>Nhiệt độ</span><span>Hệ thống điện</span><span>Trạng thái lỗi</span></div></div>}
    </div>
    <button className="agent-inspect-button" onClick={onViewTelemetry}>Xem dữ liệu blackbox <ArrowRight size={15}/></button>
    {cycle.history.length>0 && <details className="agent-reply-history"><summary><History size={14}/>Các lượt kiểm tra gần đây <span>{cycle.history.length}</span></summary><ol>{cycle.history.map(reply=><li key={reply.id}><Clock3 size={12}/><div><time dateTime={reply.completedAt}>{time(reply.completedAt)} · Lượt {reply.cycle}</time><p>{reply.title}</p></div></li>)}</ol></details>}
    <div className="periodic-demo-control"><span><Activity size={12}/>Kịch bản thử nghiệm</span><button disabled={!connected} onClick={safety.onInject}>Inject Overheating <ArrowRight size={12}/></button></div>
    <p className="agent-boundary">Gửi và phản hồi đều được mô phỏng trong trình duyệt. Chưa gọi backend hay AI thật.</p>
  </section>;
}
