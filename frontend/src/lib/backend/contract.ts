import type {BlackboxBatch,BlackboxRecord} from '../blackbox/types';
export type Severity='normal'|'warning'|'critical';
export type Assessment={severity:Severity;diagnosis:string;suspected_faults:string[];evidence:string[];confidence:number;missing_data:string[];recommendations:string[]};
export type GarageOption={place_id:string;name:string;address?:string;latitude:number;longitude:number;distance_km:number};
export type ToolTrace={tool:string;result:{options?:GarageOption[];error?:unknown;success?:boolean;source?:string;data?:{outside_temperature_c:number;observed_at:string;latitude:number;longitude:number;weather_grid_distance_km:number}}};
export type Incident={id:string;vehicle_id:string;severity:Severity;status:string;diagnosis:string;assessment:Assessment;reasons:string[];recommendations:string[];created_at:string;tool_trace:ToolTrace[]};
export type AgentReply={status:'normal'|'incident_created';vehicle_id:string;batch_id:string;accepted_records:number;assessment:Assessment;hard_safety_guardrail:{triggered:boolean;minimum_severity:Severity;reasons:string[]};tool_trace:ToolTrace[];incident?:Incident;memory:{id:string;status:string;expires_at:string}|null;sanitization:{removed_fields:string[];removed_values:number}};
export type BatchReply={batchId:string;vehicleId:string;accepted:number;completedAt:string;latest:AgentReply;incident:Incident|null};
export type PendingAction={id:string;incident_id:string;action_type:'book_appointment'|'remind_later';payload:{garage_id?:string;slot?:string;scheduled_for?:string};status:string};
export type PreparedAction={requires_confirmation:boolean;pending_action?:PendingAction};
export type BackendState={phase:'collecting'|'sending'|'ready'|'error'|'paused';api:'checking'|'online'|'offline';error:string;reply:BatchReply|null;incident:Incident|null;history:BatchReply[];skipped:number};
export const initialBackendState=():BackendState=>({phase:'collecting',api:'checking',error:'',reply:null,incident:null,history:[],skipped:0});
const finite=(v:unknown,low:number,high:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=low&&v<=high;
const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(x=>typeof x==='string');
const severity=(v:unknown)=>['normal','warning','critical'].includes(String(v));
// Keep the frontend blackbox schema, including units. No derived diagnosis or weather is sent.
export function validateBatch(value:unknown):BlackboxBatch{
 const b=value as BlackboxBatch;
 if(!b||b.schemaVersion!==1||b.source!=='simulated'||b.recordCount!==15||b.sampleIntervalMs!==1000||!Array.isArray(b.records)||b.records.length!==15||typeof b.vehicleId!=='string'||!/^[\w-]{1,64}$/.test(b.vehicleId)||typeof b.batchId!=='string'||!/^[\w-]{1,128}$/.test(b.batchId))throw new Error('Gói dữ liệu phải chứa 15 mẫu và mã xe hợp lệ.');
 const records=b.records.map((r,i):BlackboxRecord=>{
  if(!r||!r.units||!['raw','km/h'].includes(r.units.speed)||!['raw','kPa'].includes(r.units.map)||!['raw','%'].includes(r.units.tps)||r.units.temperature!=='°C'||r.units.engineLoad!=='%'||r.units.battery!=='V'||r.units.rpm!=='rpm')throw new Error('Đơn vị dữ liệu không hợp lệ.');
  const delta=i>0?Date.parse(r.capturedAt)-Date.parse(b.records[i-1].capturedAt):1000;
  if(!Number.isFinite(Date.parse(r.capturedAt))||!finite(delta,800,2000))throw new Error('Thời gian các mẫu không liên tục.');
  if(!finite(r.coolant,-40,180)||!finite(r.rpm,0,12000)||!finite(r.speed,0,350)||!finite(r.intake,-40,100)||!finite(r.engineLoad,0,100)||!finite(r.battery,0,30)||!finite(r.oil,-40,220)||!finite(r.fuel,0,100)||!finite(r.fan,0,100)||!finite(r.location?.lat,-90,90)||!finite(r.location?.lon,-180,180)||!strings(r.dtc)||(r.map!==null&&!finite(r.map,0,10000))||(r.tps!==null&&!finite(r.tps,0,10000))||(r.consumption!==null&&!finite(r.consumption,0,10000))||![null,0,1,2,3].includes(r.fault))throw new Error('Chỉ số cảm biến không hợp lệ.');
  return {capturedAt:r.capturedAt,rpm:r.rpm,map:r.map,tps:r.tps,engineLoad:r.engineLoad,consumption:r.consumption,speed:r.speed,coolant:r.coolant,oil:r.oil,intake:r.intake,battery:r.battery,fuel:r.fuel,fan:r.fan,fault:r.fault,dtc:[...r.dtc],location:{lat:r.location.lat,lon:r.location.lon},units:{rpm:'rpm',map:r.units.map,tps:r.units.tps,speed:r.units.speed,temperature:'°C',engineLoad:'%',battery:'V',consumption:'L/h',fuel:'%',fan:'%'}};
 });
 return {schemaVersion:1,batchId:b.batchId,vehicleId:b.vehicleId,source:'simulated',sampleIntervalMs:1000,recordCount:15,records};
}
export function isAssessment(value:unknown):value is Assessment{const a=value as Assessment;return !!a&&severity(a.severity)&&typeof a.diagnosis==='string'&&finite(a.confidence,0,1)&&strings(a.evidence)&&strings(a.recommendations)&&strings(a.suspected_faults)&&strings(a.missing_data);}
export function isIncident(value:unknown,vehicleId?:string):value is Incident{
 const i=value as Incident;return !!i&&typeof i.id==='string'&&/^inc_[\w-]+$/.test(i.id)&&typeof i.vehicle_id==='string'&&(!vehicleId||i.vehicle_id===vehicleId)&&severity(i.severity)&&typeof i.status==='string'&&typeof i.diagnosis==='string'&&typeof i.created_at==='string'&&strings(i.reasons)&&strings(i.recommendations)&&Array.isArray(i.tool_trace);
}
export function isAgentReply(value:unknown,vehicleId:string,batchId:string):value is AgentReply{
 const r=value as AgentReply;return !!r&&r.vehicle_id===vehicleId&&r.batch_id===batchId&&r.accepted_records===15&&['normal','incident_created'].includes(r.status)&&isAssessment(r.assessment)&&!!r.hard_safety_guardrail&&severity(r.hard_safety_guardrail.minimum_severity)&&strings(r.hard_safety_guardrail.reasons)&&Array.isArray(r.tool_trace)&&(r.status!=='incident_created'||isIncident(r.incident,vehicleId));
}
