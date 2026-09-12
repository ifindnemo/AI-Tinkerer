"use client";
import {Activity,ArrowRight,Check,Clock3,ExternalLink,History,LoaderCircle,MapPin,Radio,ShieldCheck,Sparkles,TriangleAlert,WifiOff} from 'lucide-react';
import type {BackendState} from '@/lib/backend/contract';
import type {BlackboxTransfer} from '@/lib/blackbox/types';
const time=(value:string)=>new Date(value).toLocaleTimeString('vi-VN');
export default function BackendAgentPanel({state,transfer,connected,onInject,onViewTelemetry}:{state:BackendState;transfer:BlackboxTransfer;connected:boolean;onInject:()=>void;onViewTelemetry:()=>void}){
 const {reply,incident}=state;const busy=state.phase==='sending';const a=reply?.latest.assessment;
 const severity=a?.severity??'normal';const phase=!connected?'paused':state.phase;
 const environment=reply?.latest.tool_trace.find(t=>t.tool==='get_external_environment_context')?.result;
 const nearbyGarages=reply?.latest.tool_trace.find(t=>t.tool==='search_nearby_garages')?.result.options??[];
 const status=!connected?'Blackbox ngoại tuyến':busy?'Agent đang phân tích 15 mẫu':phase==='error'?'Chưa nhận được kết quả':reply?'Đã nhận nhận định từ agent':'Đang thu thập dữ liệu';
 return <section className={`safety-agent-panel periodic-agent backend-agent severity-${severity}`} aria-label="Vehicle Safety Agent">
  <header className="periodic-agent-heading"><span className="periodic-agent-avatar"><Sparkles size={22}/></span><div><span className="section-kicker">ĐỒNG HÀNH CÙNG CHIẾC XE</span><h2>Car Neuron Agent</h2></div><span className="agent-demo-badge">API</span></header>
  <div className="periodic-agent-status" data-testid="backend-agent-phase" data-phase={phase}>{busy?<LoaderCircle className="spin" size={14}/>:!connected||state.api==='offline'?<WifiOff size={14}/>:<span className="agent-live-dot"/>}{status}</div>
  <ol className="agent-cycle-steps">{['Thu thập','Agent','Đề xuất'].map((label,i)=><li key={label} className={connected&&(i===0||busy&&i===1||!!reply)?'active':''}><span>{i+1}</span>{label}</li>)}</ol>
  <div className="agent-batch-progress"><div><span>Gói dữ liệu tiếp theo</span><b>{transfer.buffered}/15 mẫu</b></div><div className="agent-sample-segments" role="progressbar" aria-label="Mẫu đã thu thập" aria-valuemin={0} aria-valuemax={15} aria-valuenow={transfer.buffered}>{Array.from({length:15},(_,i)=><span key={i} className={i<transfer.buffered?'filled':''}/>)}</div><small>{connected?'1 mẫu/giây · gửi 15 mẫu mỗi lượt; chờ agent nếu lượt trước chưa xong.':'Dừng gửi khi blackbox ngoại tuyến.'}</small></div>
  {state.error&&<div className="backend-error" role="alert"><TriangleAlert size={17}/><p>{state.error} Gói mới sẽ được thử ở chu kỳ tiếp theo.</p></div>}
  <div className="periodic-agent-content" aria-live="polite" aria-busy={busy}>
   {reply&&a?<article className={`agent-response ${severity!=='normal'?'backend-incident':''} ${!connected||phase==='error'?'previous':''}`} data-testid="backend-response" data-batch-id={reply.batchId}>
    <div className="agent-response-meta"><span>{severity==='critical'?'CẢNH BÁO NGUY HIỂM':severity==='warning'?'NÊN KIỂM TRA':'NHẬN ĐỊNH MỚI NHẤT'}</span><time dateTime={reply.completedAt}>{time(reply.completedAt)}</time></div>
    <div className="agent-verdict">{severity==='normal'?<ShieldCheck size={22}/>:<TriangleAlert size={22}/>}<h3>{severity==='normal'?'Xe đang được theo dõi':'Agent ghi nhận dấu hiệu bất thường'}</h3></div>
    <p>{a.diagnosis}</p>
    {reply.incident&&<small data-testid="backend-incident" data-incident-id={reply.incident.id}>Sự cố: {reply.incident.id}</small>}
    <div className="agent-recommendations"><h4>Đề xuất cho bạn</h4>{a.recommendations.map((text,i)=><div className="agent-recommendation" key={i}><span>{i+1}</span><p>{text}</p></div>)}</div>
    {nearbyGarages.length>0&&<section className="backend-nearby-garages" data-testid="backend-nearby-garages" aria-label="Garage gần xe"><div className="nearby-garages-heading"><div><h4><MapPin size={14}/>Garage gần xe</h4><p>Trong bán kính 5 km · chỉ dẫn tham khảo, không đặt lịch</p></div><span>{nearbyGarages.length} địa điểm</span></div><ol>{nearbyGarages.map((garage,index)=>{const safeUrl=garage.osm_url&&/^https:\/\/www\.openstreetmap\.org\//.test(garage.osm_url)?garage.osm_url:null;return <li key={garage.place_id||`${garage.latitude}-${garage.longitude}`}><span className="garage-rank">{index+1}</span><div><strong>{garage.name}</strong>{garage.address&&<small>{garage.address}</small>}<b>{garage.distance_km.toLocaleString('vi-VN')} km</b></div>{safeUrl&&<a href={safeUrl} target="_blank" rel="noreferrer" aria-label={`Mở ${garage.name} trên bản đồ`}><ExternalLink size={14}/></a>}</li>})}</ol><small className="garage-provider">Dữ liệu LocationIQ và OpenStreetMap</small></section>}
    {environment?.success&&environment.data&&<dl className="agent-observations"><div><dt>Ngoài trời · Open-Meteo</dt><dd>{environment.data.outside_temperature_c}°C</dd></div><div><dt>Quan sát lúc</dt><dd>{time(environment.data.observed_at)}</dd></div></dl>}
    <details><summary>Cơ sở & mức độ chắc chắn</summary><p>Độ tin cậy do agent tự đánh giá: {Math.round(a.confidence*100)}% · chưa hiệu chuẩn.</p><ul>{a.evidence.map((text,i)=><li key={i}>{text}</li>)}</ul>{a.suspected_faults.length>0&&<p>Khả năng cần kiểm tra: {a.suspected_faults.join('; ')}.</p>}{a.missing_data.length>0&&<p>Dữ liệu còn thiếu: {a.missing_data.join('; ')}.</p>}</details>
    <footer><Check size={12}/>{reply.accepted}/15 mẫu · Phản hồi trực tiếp từ backend</footer>
   </article>:<div className="agent-listening"><Radio size={25}/><h3>Đang lắng nghe chiếc xe</h3><p>Agent sẽ đọc gói 15 mẫu, kiểm tra môi trường và lịch sử xe trước khi phản hồi.</p></div>}
  </div>
  {incident&&(!reply?.incident)&&<details className="agent-reply-history"><summary>Sự cố trước đó · {incident.id}</summary><p>{incident.diagnosis}</p><small>Đây là bối cảnh trước đó, không phải kết luận cho gói hiện tại.</small></details>}
  <button className="agent-inspect-button" onClick={onViewTelemetry}>Xem dữ liệu blackbox <ArrowRight size={15}/></button>
  {state.history.length>0&&<details className="agent-reply-history"><summary><History size={14}/>Các lượt kiểm tra gần đây <span>{state.history.length}</span></summary><ol>{state.history.map(r=><li key={r.batchId}><Clock3 size={12}/><div><time>{time(r.completedAt)}</time><p>{r.latest.assessment.severity} · {r.accepted}/15 mẫu</p></div></li>)}</ol></details>}
  <div className="periodic-demo-control"><span><Activity size={12}/>Dữ liệu thử nghiệm</span><button disabled={!connected||busy} onClick={onInject}>Inject Overheating <ArrowRight size={12}/></button></div>
  <p className="agent-boundary">Cảm biến và GPS mô phỏng · Agent, thời tiết và kết quả công cụ từ backend.{state.skipped>0?` Đã bỏ qua ${state.skipped} gói khi agent bận, không gửi dồn.`:''}</p>
 </section>;
}
