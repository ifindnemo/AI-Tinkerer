"use client";
import type {ComponentProps} from "react";
import {Activity, ArrowRight, Check, CircleCheck, Clock3, History, LoaderCircle, Radio, Sparkles, WifiOff} from "lucide-react";
import SafetyAgentPanel from "./safety-agent-panel";
import type {AgentCycle} from "@/lib/periodic-agent/mock";
import type {BlackboxTransfer} from "@/lib/blackbox/types";
import {useLang} from "@/hooks/use-preferences";
type Props=ComponentProps<typeof SafetyAgentPanel> & {agentCycle:AgentCycle;blackbox:BlackboxTransfer;onViewTelemetry:()=>void};

export default function VehicleAgentPanel({agentCycle:cycle,blackbox,onViewTelemetry,...safety}:Props){
  const {t,time}=useLang();
  // Preserve the separate intervention workflow when a fault scenario is active.
  if(safety.incident || safety.telemetry.scenario==="environment")return <SafetyAgentPanel {...safety}/>;
  const connected=safety.telemetry.connected;
  const processing=connected && ["sending","analyzing"].includes(cycle.phase);
  const response=cycle.response;
  const current=connected && cycle.phase!=="paused" && cycle.phase!=="collecting";
  const step=processing ? 1 : response && current ? 2 : 0;
  const label=!connected ? t("Tạm dừng theo dõi","Monitoring paused") : cycle.phase==="sending" ? t("Đang gửi gói mô phỏng","Sending simulated batch") : cycle.phase==="analyzing" ? t("Agent đang phân tích","Agent is analysing") : response && current ? t("Đã cập nhật nhận xét","Assessment updated") : t("Đang thu thập dữ liệu","Collecting data");
  return <section className={`safety-agent-panel periodic-agent ${!connected?"disconnected":""}`} aria-label="Vehicle Safety Agent">
    <header className="periodic-agent-heading"><span className="periodic-agent-avatar"><Sparkles size={22}/></span><div><span className="section-kicker">{t("ĐỒNG HÀNH CÙNG CHIẾC XE","YOUR CAR COMPANION")}</span><h2>Car Neuron Agent</h2></div><span className="agent-demo-badge">{t("MÔ PHỎNG","SIMULATED")}</span></header>
    <div className="periodic-agent-status" data-testid="periodic-agent-phase" data-phase={connected?cycle.phase:"paused"}>
      {!connected?<WifiOff size={14}/>:processing?<LoaderCircle size={14} className="spin"/>:<span className="agent-live-dot"/>}<span>{label}</span>
    </div>
    <ol className="agent-cycle-steps" aria-label={t("Chu kỳ agent","Agent cycle")}>{[t("Thu thập","Collect"),t("Phân tích","Analyse"),t("Đề xuất","Advise")].map((text,i)=><li key={i} className={i<=step&&connected?"active":""} aria-current={i===step?"step":undefined}><span>{i<step?<Check size={10}/>:i+1}</span>{text}</li>)}</ol>
    <div className="agent-batch-progress">
      <div><span>{processing?t("Đang xử lý 15 mẫu vừa nhận","Processing the 15 new samples"):response?t("Đang chuẩn bị lượt tiếp theo","Preparing the next cycle"):t("Chờ gói dữ liệu đầu tiên","Waiting for the first batch")}</span><b>{connected?`${blackbox.buffered}/15 ${t("mẫu","samples")}`:t("Đã tạm dừng","Paused")}</b></div>
      <div className="agent-sample-segments" role="progressbar" aria-label={t("Số mẫu trong gói tiếp theo","Samples in the next batch")} aria-valuemin={0} aria-valuemax={15} aria-valuenow={blackbox.buffered}>{Array.from({length:15},(_,i)=><span className={connected&&i<blackbox.buffered?"filled":""} key={i}/>)}</div>
      <small>{!connected?t("Kết nối lại để tiếp tục nhận dữ liệu.","Reconnect to keep receiving data."):processing?t("Phản hồi mới sẽ xuất hiện sau khi phân tích xong.","A new reply appears once analysis finishes."):t(`Dự kiến kiểm tra tiếp sau ${15-blackbox.buffered} giây · 1 mẫu/giây`,`Next check in about ${15-blackbox.buffered} s · 1 sample/s`)}</small>
    </div>
    <div className="periodic-agent-content" aria-live="polite" aria-atomic="true" aria-busy={processing}>
      {response ? <article className={`agent-response ${!current?"previous":""}`} data-testid="agent-response" data-response-id={response.id}>
        <div className="agent-response-meta"><span>{current?t("NHẬN XÉT MỚI NHẤT","LATEST ASSESSMENT"):t("PHẢN HỒI TRƯỚC ĐÓ","PREVIOUS REPLY")}</span><time dateTime={response.completedAt} data-testid="agent-response-time">{time(response.completedAt)}</time></div>
        <div className="agent-verdict"><CircleCheck size={21}/><h3>{response.title}</h3></div>
        <p>{response.summary}</p>
        <dl className="agent-observations">{response.observations.map(item=><div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
        <div className="agent-recommendations"><h4>{t("Đề xuất cho bạn","Recommendations")}</h4>{response.recommendations.map((item,i)=><div className="agent-recommendation" key={item.title}><span>{i+1}</span><div><b>{item.title}</b><p>{item.detail}</p></div></div>)}</div>
        <footer><Check size={12}/>15 {t("mẫu","samples")} · {time(response.windowStart)}–{time(response.windowEnd)}</footer>
      </article> : <div className="agent-listening"><span className="agent-listening-icon">{connected?<Radio size={25}/>:<WifiOff size={25}/>}</span><h3>{connected?t("Mình đang lắng nghe chiếc xe","Listening to your car"):t("Đang chờ kết nối blackbox","Waiting for the blackbox")}</h3><p>{connected?t("Sau mỗi 15 mẫu, mình sẽ gửi lại nhận xét ngắn gọn cùng đề xuất cho bạn.","After every 15 samples I send a short assessment and recommendations."):t("Chưa có dữ liệu mới để đưa ra nhận xét.","No fresh data to assess yet.")}</p><div className="agent-empty-tags"><span>{t("Nhiệt độ","Temperature")}</span><span>{t("Hệ thống điện","Electrical")}</span><span>{t("Trạng thái lỗi","Fault status")}</span></div></div>}
    </div>
    <button className="agent-inspect-button" onClick={onViewTelemetry}>{t("Xem dữ liệu blackbox","View blackbox data")} <ArrowRight size={15}/></button>
    {cycle.history.length>0 && <details className="agent-reply-history"><summary><History size={14}/>{t("Các lượt kiểm tra gần đây","Recent checks")} <span>{cycle.history.length}</span></summary><ol>{cycle.history.map(reply=><li key={reply.id}><Clock3 size={12}/><div><time dateTime={reply.completedAt}>{time(reply.completedAt)} · {t("Lượt","Cycle")} {reply.cycle}</time><p>{reply.title}</p></div></li>)}</ol></details>}
    <div className="periodic-demo-control"><span><Activity size={12}/>{t("Kịch bản thử nghiệm","Test scenario")}</span><button disabled={!connected} onClick={safety.onInject}>{t("Mô phỏng quá nhiệt","Inject overheating")} <ArrowRight size={12}/></button></div>
    <p className="agent-boundary">{t("Gửi và phản hồi đều được mô phỏng trong trình duyệt. Chưa gọi backend hay AI thật.","Sending and replies are simulated in the browser. No backend or real AI is called.")}</p>
  </section>;
}
