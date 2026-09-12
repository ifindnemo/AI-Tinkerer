"use client";
import {useEffect,useRef,useState} from 'react';
import {CalendarDays,Check,LoaderCircle,TriangleAlert} from 'lucide-react';
import type {GarageOption,Incident,PendingAction,PreparedAction} from '@/lib/backend/contract';
import {vehicleApi} from '@/lib/backend/client';
const garagesFrom=(value:unknown):GarageOption[]=>Array.isArray(value)?value.filter((g):g is GarageOption=>!!g&&typeof g.place_id==='string'&&!!g.place_id&&typeof g.name==='string'&&Number.isFinite(g.distance_km)):[];
type Receipt={status:string;action_type:string;result:{id:string;slot?:string;scheduled_for?:string;calendar_event?:{event_id:string;html_link?:string}}};
export default function BackendServicePlanner({incident}:{incident:Incident|null}){
 if(!incident)return <section id="service-planner" tabIndex={-1} className="backend-service"><h3><CalendarDays size={19}/>Lịch kiểm tra & nhắc nhở</h3><p>Khi agent ghi nhận sự cố, garage phù hợp và lựa chọn đặt lịch sẽ xuất hiện tại đây.</p></section>;
 return <IncidentPlanner key={incident.id} incident={incident}/>;
}
function IncidentPlanner({incident}:{incident:Incident}){
 const garages=garagesFrom(incident.tool_trace.find(t=>t.tool==='search_nearby_garages')?.result?.options);
 const [garage,setGarage]=useState('');const [date,setDate]=useState('');const [kind,setKind]=useState<'book_appointment'|'remind_later'>('book_appointment');
 const [pending,setPending]=useState<PendingAction|null>(null);const [consent,setConsent]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [receipt,setReceipt]=useState<Receipt|null>(null);const [uncertain,setUncertain]=useState(false);const [recovering,setRecovering]=useState(true);
 const alive=useRef(true),lock=useRef(false);const key=`car-neuron.confirmation.${incident.id}`;
 useEffect(()=>{alive.current=true;const timer=setTimeout(()=>{
  try{const value=localStorage.getItem(key);if(value){const saved=JSON.parse(value);if(saved.receipt?.status==='executed')setReceipt(saved.receipt);else setUncertain(true);}}catch{setUncertain(true);}setRecovering(false);
 },0);return()=>{clearTimeout(timer);alive.current=false;};},[key]);
 async function run(task:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await task();}catch(e){if(alive.current)setError(e instanceof Error?e.message:'Yêu cầu chưa hoàn tất.');}finally{lock.current=false;if(alive.current)setBusy(false);}}
 const prepare=()=>run(async()=>{
  const instant=new Date(date);if(!date||!Number.isFinite(instant.getTime())||instant.getTime()<=Date.now())throw new Error('Chọn thời gian trong tương lai.');
  if(kind==='book_appointment'&&!garages.some(g=>g.place_id===garage))throw new Error('Chọn garage từ kết quả agent.');
  const r=await vehicleApi<PreparedAction>(`incidents/${incident.id}/action`,{body:kind==='book_appointment'?{action:kind,garage_id:garage,slot:instant.toISOString()}:{action:kind,scheduled_for:instant.toISOString()}});
  if(!r.requires_confirmation||!r.pending_action||r.pending_action.incident_id!==incident.id||r.pending_action.status!=='pending_confirmation'||r.pending_action.action_type!==kind)throw new Error('Backend chưa trả phiếu xác nhận hợp lệ.');
  if(!alive.current)return;setPending(r.pending_action);setConsent(false);setReceipt(null);
 });
 const confirm=()=>run(async()=>{
  if(!pending||!consent||uncertain)return;
  // Remember an attempted confirmation before sending; a reload must never retry calendar writes.
  try{localStorage.setItem(key,JSON.stringify({pendingId:pending.id}));}catch{throw new Error('Không lưu được trạng thái xác nhận trên trình duyệt. Chưa gửi yêu cầu.');}
  try{
   const r=await vehicleApi<Receipt>(`incidents/${incident.id}/confirm`,{body:{pending_action_id:pending.id}});
   if(r.status!=='executed'||!r.result?.id)throw new Error('Chưa xác nhận được kết quả.');
   localStorage.setItem(key,JSON.stringify({receipt:r}));if(!alive.current)return;setReceipt(r);setConsent(false);setPending(null);
  }catch(e){if(alive.current){setUncertain(true);setConsent(false);}throw e;}
 });
 const calendarLink=receipt?.result.calendar_event?.html_link;
 const safeCalendarLink=calendarLink&&/^https:\/\/(?:calendar\.google\.com|www\.google\.com)\//.test(calendarLink)?calendarLink:null;
 return <section id="service-planner" tabIndex={-1} className="backend-service" aria-label="Đặt lịch qua backend">
  <h3><CalendarDays size={19}/>Lịch kiểm tra & nhắc nhở <span className="agent-demo-badge">API</span></h3>
  <p>Lên lịch từ sự cố {incident.id}. Garage được lấy từ kết quả tìm kiếm của agent.</p>
  {incident.severity==='critical'&&<p className="backend-urgent"><TriangleAlert size={17}/>Ưu tiên xử lý cảnh báo an toàn trước khi lên lịch.</p>}
  <p>Xác nhận đặt lịch sẽ tạo sự kiện một giờ trên Google Calendar và lưu lịch ở backend. Đây chưa phải xác nhận tiếp nhận của garage. Nhắc nhở hiện được lưu trong hệ thống.</p>
  {error&&<p className="backend-error" role="alert">{error}</p>}
  {recovering?<p role="status">Đang đọc trạng thái lịch…</p>:receipt?<div className="backend-receipt" role="status"><Check size={20}/><div><b>{receipt.action_type==='book_appointment'?'Đã tạo lịch trên Google Calendar':'Đã lưu nhắc nhở trên backend'}</b><p>Mã: {receipt.result.id}</p><p>{new Date(receipt.result.slot??receipt.result.scheduled_for??'').toLocaleString('vi-VN')}</p>{safeCalendarLink&&<a href={safeCalendarLink} target="_blank" rel="noreferrer">Mở Google Calendar ↗</a>}</div></div>:uncertain?<p className="backend-error">Yêu cầu xác nhận trước đó chưa có kết quả rõ ràng. Hãy kiểm tra Google Calendar hoặc liên hệ người phụ trách backend trước khi đặt lại; giao diện sẽ không tự gửi lại.</p>:pending?<div className="backend-review">
   <h4>Kiểm tra trước khi xác nhận</h4><dl><div><dt>Xe</dt><dd>{incident.vehicle_id}</dd></div><div><dt>Hành động</dt><dd>{pending.action_type==='book_appointment'?'Tạo lịch Google Calendar (1 giờ)':'Lưu nhắc nhở'}</dd></div>{pending.payload.garage_id&&<div><dt>Garage</dt><dd>{garages.find(g=>g.place_id===pending.payload.garage_id)?.name??pending.payload.garage_id}</dd></div>}<div><dt>Thời gian</dt><dd>{new Date(pending.payload.slot??pending.payload.scheduled_for??'').toLocaleString('vi-VN')}</dd></div></dl>
   <label className="backend-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} disabled={busy}/>{pending.action_type==='book_appointment'?'Tôi đồng ý tạo lịch Google Calendar với thông tin xe, garage và thời gian trên.':'Tôi đồng ý lưu nhắc nhở theo nội dung trên.'}</label><div className="backend-actions"><button className="outline-button" disabled={busy} onClick={()=>{setPending(null);setConsent(false);}}>Sửa lựa chọn</button><button className="primary-button" disabled={!consent||busy} onClick={confirm}>{busy?<LoaderCircle className="spin" size={16}/>:<Check size={16}/>}Xác nhận lưu trên hệ thống</button></div>
  </div>:<>
   <div className="backend-action-tabs"><button aria-pressed={kind==='book_appointment'} onClick={()=>setKind('book_appointment')} disabled={busy}>Đặt lịch kiểm tra</button><button aria-pressed={kind==='remind_later'} onClick={()=>setKind('remind_later')} disabled={busy}>Nhắc tôi sau</button></div>
   {kind==='book_appointment'&&<div className="backend-garages">{garages.length?garages.map(g=><label key={g.place_id}><input type="radio" name={`garage-${incident.id}`} value={g.place_id} checked={garage===g.place_id} onChange={()=>setGarage(g.place_id)} disabled={busy}/><span><b>{g.name}</b><small>{g.address??'Chưa có địa chỉ'} · {g.distance_km} km</small></span></label>):<p>Agent chưa trả danh sách garage. Chờ lượt phân tích tiếp theo hoặc chọn nhắc lại.</p>}</div>}
   <label className="backend-date">{kind==='book_appointment'?'Thời gian mong muốn':'Thời gian nhắc lại'}<input type="datetime-local" value={date} onChange={e=>setDate(e.target.value)} disabled={busy}/></label>
   <button className="primary-button" disabled={busy||!date||(kind==='book_appointment'&&!garage)} onClick={prepare}>{busy?<LoaderCircle className="spin" size={16}/>:<CalendarDays size={16}/>}Xem lại & xác nhận</button>
  </>}
 </section>;
}
