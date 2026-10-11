"use client";
import {Activity,ArrowRight,Check,CloudSun,Clock3,ExternalLink,FlaskConical,Gavel,History,ListChecks,LoaderCircle,MapPin,Radio,ShieldAlert,ShieldCheck,Sparkles,TriangleAlert,WifiOff,Wrench,X} from 'lucide-react';
import {useLang} from '@/hooks/use-preferences';
import type {AgentReply,BackendState,Severity} from '@/lib/backend/contract';
import {historyInsight,toolSteps,type HistoryInsight,type ToolStep} from '@/lib/backend/tool-insights';
import type {BlackboxTransfer} from '@/lib/blackbox/types';
type T=(vi:string,en:string)=>string;
const severityLabel=(s:Severity,t:T)=>s==='critical'?t('Nguy hiểm','Critical'):s==='warning'?t('Cảnh báo','Warning'):t('Bình thường','Normal');
const dateOf=(value:string|undefined,locale:string)=>{if(!value)return '—';const d=new Date(`${value}T00:00:00`);return Number.isFinite(d.getTime())?d.toLocaleDateString(locale):value;};
// `device` switches the panel to live OBD data (analysis on triggers instead of fixed batches).
export type DeviceAgentInfo={simulated:boolean;engine:'agent'|'rules';fallbackReason:string|null;findings:{rule:string;message:string}[]};
export default function BackendAgentPanel({state,transfer,connected,onInject,onViewTelemetry,onFallback,device}:{state:BackendState;transfer?:BlackboxTransfer;connected:boolean;onInject?:()=>void;onViewTelemetry:()=>void;onFallback?:()=>void;device?:DeviceAgentInfo}){
 const {t,time,lang}=useLang();
 const {reply,incident}=state;const busy=state.phase==='sending';const a=reply?.latest.assessment;
 const severity=a?.severity??'normal';const phase=!connected?'paused':state.phase;const alert=severity!=='normal';
 const nearbyGarages=reply?.latest.tool_trace.find(item=>item.tool==='search_nearby_garages')?.result.options??[];
 const history=reply?historyInsight(reply.latest):null;
 const target=transfer?.target??15;
 const status=!connected?t('Blackbox ngoại tuyến','Blackbox offline'):busy?t('Agent đang phân tích gói dữ liệu','Agent is analysing the batch'):phase==='error'?t('Chưa nhận được kết quả','No result yet'):reply?t('Đã nhận nhận định từ agent','Agent assessment received'):t('Đang thu thập dữ liệu','Collecting data');
 const unreachable=!!state.error||(state.api==='offline'&&!reply);
 const currentStep=!connected||phase==='error'||phase==='paused'?null:busy?1:phase==='ready'&&reply?2:0;
 return <section className={`safety-agent-panel periodic-agent backend-agent severity-${severity}`} data-phase={phase} aria-label="Vehicle Safety Agent">
  <header className="periodic-agent-heading"><span className="periodic-agent-avatar"><Sparkles size={22}/></span><div><span className="section-kicker">{t('ĐỒNG HÀNH CÙNG CHIẾC XE','YOUR CAR COMPANION')}</span><h2>Car Neuron Agent</h2></div><span className="agent-demo-badge">{device?device.simulated?t('MÔ PHỎNG','SIMULATED'):'OBD':'API'}</span></header>
  <div className="periodic-agent-status" data-testid="backend-agent-phase" data-phase={phase}>{busy?<LoaderCircle className="spin" size={14}/>:!connected||state.api==='offline'?<WifiOff size={14}/>:<span className="agent-live-dot"/>}{status}</div>
  <ol className="agent-cycle-steps">{[t('Thu thập','Collect'),'Agent',t('Đề xuất','Advise')].map((label,i)=><li key={i} className={currentStep!==null&&i<=currentStep?'active':''} data-state={currentStep===i?'current':currentStep!==null&&i<currentStep?'done':'pending'} aria-current={currentStep===i?'step':undefined}><span>{currentStep!==null&&i<currentStep?<Check size={12}/>:i+1}</span>{label}</li>)}</ol>
  {device?<p className="device-agent-cadence">{t('Agent phân tích khi bắt đầu chuyến, khi có dấu hiệu bất thường hoặc mã lỗi mới, và 5 phút một lần.','The agent runs at the start of a trip, on warning signs or new fault codes, and every 5 minutes.')}</p>:transfer&&<div className="agent-batch-progress"><div><span>{target<15?t('Lô đầu tiên của kịch bản mới','First batch of the new scenario'):t('Gói dữ liệu tiếp theo','Next data batch')}</span><b>{transfer.buffered}/{target} {t('mẫu','samples')}</b></div><div className="agent-sample-segments" style={{gridTemplateColumns:`repeat(${target},1fr)`}} role="progressbar" aria-label={t('Mẫu đã thu thập','Samples collected')} aria-valuemin={0} aria-valuemax={target} aria-valuenow={transfer.buffered}>{Array.from({length:target},(_,i)=><span key={i} className={i<transfer.buffered?'filled':''}/>)}</div><small>{!connected?t('Dừng gửi khi blackbox ngoại tuyến.','Sending pauses while the blackbox is offline.'):target<15?t(`Gửi sớm sau ${target} mẫu để agent phản ứng nhanh; các lô sau đủ 15 mẫu.`,`Sent early after ${target} samples so the agent reacts quickly; later batches have 15.`):t('1 mẫu/giây · gửi 15 mẫu mỗi lượt; chờ agent nếu lượt trước chưa xong.','1 sample/s · 15 samples per batch; waits if the agent is still busy.')}</small></div>}
  {unreachable&&<div className="backend-error" role="alert"><TriangleAlert size={17}/><div><p>{state.error||t('Không kết nối được backend. Kiểm tra dịch vụ Python ở cổng 8000.','Cannot reach the backend. Check the Python service on port 8000.')} {state.error&&t('Gói mới sẽ được thử ở chu kỳ tiếp theo.','The next batch will be tried on the following cycle.')}</p>{onFallback&&<button className="backend-fallback" onClick={onFallback}><FlaskConical size={13}/>{t('Chuyển sang chế độ mô phỏng','Switch to simulated mode')}</button>}</div></div>}
  <div className="periodic-agent-content" aria-live="polite" aria-busy={busy}>
   {reply&&a?<article className={`agent-response ${alert?'backend-incident':''} ${!connected||phase==='error'?'previous':''}`} data-testid="backend-response" data-batch-id={reply.batchId}>
    <div className="agent-response-meta"><span>{severity==='critical'?t('CẢNH BÁO NGUY HIỂM','SAFETY ALERT'):severity==='warning'?t('NÊN KIỂM TRA','INSPECTION ADVISED'):t('NHẬN ĐỊNH MỚI NHẤT','LATEST ASSESSMENT')}</span><time dateTime={reply.completedAt}>{time(reply.completedAt)}</time></div>
    <div className="agent-verdict">{alert?<TriangleAlert size={22}/>:<ShieldCheck size={22}/>}<h3>{alert?t('Agent ghi nhận dấu hiệu bất thường','The agent found warning signs'):t('Xe đang được theo dõi','Your car is being monitored')}</h3></div>
    {device?.engine==='rules'&&<p className="device-rules-badge" data-testid="device-rules-badge">{device.fallbackReason==='rules_mode'?t('Đánh giá theo luật · chế độ không dùng AI','Rule-based assessment · AI disabled'):t('Đánh giá theo luật · agent AI chưa phản hồi','Rule-based assessment · the AI agent did not answer')}</p>}
    <p key={reply.batchId} className="agent-diagnosis">{a.diagnosis}</p>
    {device&&device.findings.length>0&&<ul className="device-findings" aria-label={t('Luật đã kích hoạt','Rules triggered')}>{device.findings.map(f=><li key={f.rule}><b>{f.rule}</b>{f.message}</li>)}</ul>}
    {reply.incident&&<small data-testid="backend-incident" data-incident-id={reply.incident.id}>{t('Sự cố','Incident')}: {reply.incident.id}</small>}
    <details key={`evidence-${reply.batchId}`} className="agent-confidence" open={alert}><summary>{t('Cơ sở & mức độ chắc chắn','Evidence & confidence')}<b>{Math.round(a.confidence*100)}%</b></summary><div className="confidence-meter" aria-hidden="true"><span style={{width:`${Math.round(a.confidence*100)}%`}}/></div><p>{t('Độ tin cậy do agent tự đánh giá, chưa hiệu chuẩn.','Self-reported by the agent; not calibrated.')}</p><ul>{a.evidence.map((text,i)=><li key={i}>{text}</li>)}</ul>{a.suspected_faults.length>0&&<p><b>{t('Khả năng cần kiểm tra','Possible causes')}:</b> {a.suspected_faults.join('; ')}.</p>}{a.missing_data.length>0&&<p><b>{t('Dữ liệu còn thiếu','Missing data')}:</b> {a.missing_data.join('; ')}.</p>}</details>
    <div className="agent-recommendations"><h4>{t('Đề xuất cho bạn','Recommendations')}</h4>{a.recommendations.map((text,i)=><div className="agent-recommendation" key={i}><span>{i+1}</span><p>{text}</p></div>)}</div>
    {alert&&history&&<MaintenanceCard insight={history} t={t} lang={lang}/>}
    {alert&&nearbyGarages.length>0&&<section className="backend-nearby-garages" data-testid="backend-nearby-garages" aria-label={t('Garage gần xe','Nearby garages')}><div className="nearby-garages-heading"><div><h4><MapPin size={14}/>{t('Garage gần xe','Nearby garages')}</h4><p>{t('Trong bán kính 5 km · chỉ dẫn tham khảo, không đặt lịch','Within 5 km · for reference, no booking')}</p></div><span>{nearbyGarages.length} {t('địa điểm','places')}</span></div><ol>{nearbyGarages.map((garage,index)=>{const safeUrl=garage.osm_url&&/^https:\/\/www\.openstreetmap\.org\//.test(garage.osm_url)?garage.osm_url:null;return <li key={garage.place_id||`${garage.latitude}-${garage.longitude}`}><span className="garage-rank">{index+1}</span><div><strong>{garage.name}</strong>{garage.address&&<small>{garage.address}</small>}<b>{garage.distance_km.toLocaleString(lang==='en'?'en-GB':'vi-VN')} km</b></div>{safeUrl&&<a href={safeUrl} target="_blank" rel="noreferrer" aria-label={`${t('Mở trên bản đồ','Open on map')}: ${garage.name}`}><ExternalLink size={14}/></a>}</li>})}</ol><small className="garage-provider">{t('Dữ liệu LocationIQ và OpenStreetMap','Data from LocationIQ and OpenStreetMap')}</small></section>}
    <AgentTrace key={`trace-${reply.batchId}`} reply={reply.latest} open={alert} t={t} lang={lang}/>
    <footer><Check size={12}/>{reply.accepted} {device?t('mẫu gần nhất · phân tích dữ liệu từ thiết bị','latest samples · device data analysis'):t('mẫu · Phản hồi trực tiếp từ backend','samples · Live reply from the backend')}</footer>
   </article>:<div className="agent-listening"><Radio size={25}/><h3>{t('Đang lắng nghe chiếc xe','Listening to your car')}</h3><p>{t('Agent sẽ đọc gói dữ liệu, kiểm tra môi trường và lịch sử xe trước khi phản hồi.','The agent reads each batch and checks the weather and service history before replying.')}</p></div>}
  </div>
  {incident&&(!reply?.incident)&&<details className="agent-reply-history"><summary>{t('Sự cố trước đó','Previous incident')} · {incident.id}</summary><p>{incident.diagnosis}</p><small>{t('Đây là bối cảnh trước đó, không phải kết luận cho gói hiện tại.','Earlier context, not a conclusion for the current batch.')}</small></details>}
  <button className="agent-inspect-button" onClick={onViewTelemetry}>{device?t('Xem dữ liệu OBD','View OBD data'):t('Xem dữ liệu blackbox','View blackbox data')} <ArrowRight size={15}/></button>
  {state.history.length>0&&<details className="agent-reply-history"><summary><History size={14}/>{t('Các lượt kiểm tra gần đây','Recent checks')} <span>{state.history.length}</span></summary><ol>{state.history.map(r=><li key={r.batchId}><Clock3 size={12}/><div><time>{time(r.completedAt)}</time><p>{severityLabel(r.latest.assessment.severity,t)} · {r.accepted} {t('mẫu','samples')}</p></div></li>)}</ol></details>}
  {!device&&onInject&&<div className="periodic-demo-control"><span><Activity size={12}/>{t('Dữ liệu thử nghiệm · thời gian rút gọn','Test data · compressed time')}</span><button disabled={!connected||busy} onClick={onInject}>{t('Mô phỏng quá nhiệt','Inject overheating')} <ArrowRight size={12}/></button></div>}
  <p className="agent-boundary">{device?device.simulated?t('Thiết bị giả lập (mô phỏng) · Agent, thời tiết và kết quả công cụ từ backend.','Simulated device · agent, weather and tool results come from the backend.'):t('Dữ liệu đọc trực tiếp từ xe qua cổng OBD · Agent, thời tiết và kết quả công cụ từ backend.','Read live from the car through the OBD port · agent, weather and tool results come from the backend.'):t('Cảm biến và GPS mô phỏng · Agent, thời tiết và kết quả công cụ từ backend.','Sensors and GPS are simulated · agent, weather and tool results come from the backend.')}{lang==='en'?' Agent text is generated in Vietnamese by the backend.':''}{state.skipped>0?t(` Đã bỏ qua ${state.skipped} gói khi agent bận, không gửi dồn.`,` Skipped ${state.skipped} batches while the agent was busy (no backlog).`):''}</p>
 </section>;
}

function MaintenanceCard({insight:h,t,lang}:{insight:HistoryInsight;t:T;lang:string}){
 const locale=lang==='en'?'en-GB':'vi-VN';const match=h.similar[0];
 return <section className={`agent-history-card ${match?'matched':''}`} data-testid="backend-maintenance" aria-label={t('Lịch sử bảo dưỡng','Service history')}>
  <h4><Wrench size={14}/>{t('Lịch sử của xe','Vehicle history')}</h4>
  {match?<p><b>{t('Xe từng gặp tình trạng tương tự','This car had a similar issue')}</b> {t(`ngày ${dateOf(match.date,locale)}`,`on ${dateOf(match.date,locale)}`)}{match.garage?t(` tại ${match.garage}`,` at ${match.garage}`):''}: {match.fault_label??match.diagnosis}.{match.status==='resolved'?t(' Đã xử lý.',' Resolved.'):''}{h.similar.length>1?t(` Tổng cộng ${h.similar.length} lần.`,` ${h.similar.length} times in total.`):''}</p>
   :<p>{t(`Chưa ghi nhận sự cố tương tự trong ${h.total} lần bảo dưỡng trước đây.`,`No similar issue in ${h.total} previous service records.`)}</p>}
  <dl>{h.last&&<div><dt>{t('Lần gần nhất','Last visit')}</dt><dd>{dateOf(h.last.date,locale)}{h.last.garage?` · ${h.last.garage}`:''}</dd></div>}{h.last?.fault_label&&<div><dt>{t('Kết quả','Outcome')}</dt><dd>{h.last.fault_label}</dd></div>}{h.regularGarage&&<div><dt>{t('Garage quen','Regular garage')}</dt><dd>{h.regularGarage.name} · {h.regularGarage.visits} {t('lần','visits')}</dd></div>}</dl>
  <small>{t('Lịch sử bảo dưỡng mô phỏng, đọc qua tool của agent.','Simulated service history, read through the agent tool.')}</small>
 </section>;
}

function AgentTrace({reply,open,t,lang}:{reply:AgentReply;open:boolean;t:T;lang:string}){
 const locale=lang==='en'?'en-GB':'vi-VN';
 const unavailable=t('Chưa lấy được dữ liệu','Data unavailable');
 const view=(s:ToolStep):{icon:React.ReactNode;title:string;detail:string;ok:boolean;warn?:boolean}=>{
  switch(s.kind){
   case 'guardrail':return {icon:<ShieldAlert size={13}/>,title:t('Luật an toàn cứng (backend)','Hard safety rule (backend)'),detail:s.triggered?`${t('Kích hoạt · tối thiểu','Triggered · minimum')} ${severityLabel(s.minimum,t).toLowerCase()}${s.reasons.length?` · ${s.reasons.join(' ')}`:''}`:t('Không kích hoạt','Not triggered'),ok:true,warn:s.triggered};
   case 'weather':return {icon:<CloudSun size={13}/>,title:t('Thời tiết tại vị trí xe','Weather at the car'),detail:s.ok?`${s.temperature}°C · Open-Meteo`:unavailable,ok:s.ok};
   case 'history':return {icon:<Wrench size={13}/>,title:t('Lịch sử bảo dưỡng','Service history'),detail:s.ok?t(`${s.total??0} lần ghi nhận · gần nhất ${dateOf(s.lastDate,locale)}`,`${s.total??0} records · latest ${dateOf(s.lastDate,locale)}`):unavailable,ok:s.ok};
   case 'garages':return {icon:<MapPin size={13}/>,title:t('Tìm garage gần xe','Nearby garage search'),detail:s.ok?t(`${s.count??0} địa điểm${s.radiusKm?` trong ${s.radiusKm} km`:''}`,`${s.count??0} places${s.radiusKm?` within ${s.radiusKm} km`:''}`):unavailable,ok:s.ok};
   case 'other':return {icon:<ListChecks size={13}/>,title:s.name,detail:s.ok?'OK':unavailable,ok:s.ok};
   case 'verdict':return {icon:<Gavel size={13}/>,title:t('Kết luận của agent','Agent verdict'),detail:`${severityLabel(s.severity,t)} · ${t('độ tin cậy','confidence')} ${Math.round(s.confidence*100)}%`,ok:true,warn:s.severity!=='normal'};
  }
 };
 const steps=toolSteps(reply).map(view);
 return <details className="agent-trace" open={open} data-testid="backend-trace"><summary><ListChecks size={14}/>{t('Agent đã làm gì','What the agent did')}<span>{steps.length} {t('bước','steps')}</span></summary>
  <ol>{steps.map((s,i)=><li key={i} className={!s.ok?'failed':s.warn?'warn':''}><span className="trace-icon">{s.ok?s.icon:<X size={13}/>}</span><div><b>{s.title}</b><small>{s.detail}</small></div></li>)}</ol>
 </details>;
}
