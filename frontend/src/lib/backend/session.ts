import {BlackboxBatchStream} from '../blackbox/batch-stream';
import {initialTransfer,type BlackboxBatch} from '../blackbox/types';
import {initialAgentCycle} from '../periodic-agent/mock';
import {getMockTelemetry,type Analysis,type ScenarioId} from '../telemetry';
import {liveSample} from '../live-telemetry';
import type {Vehicle} from '../vehicles';
import type {SessionSnapshot,VehicleSessionAdapter} from '../vehicle-session/types';
import {initialBackendState,isIncident,isAgentReply,type BatchReply,type Incident} from './contract';
import {vehicleApi} from './client';

export class BackendVehicleSessionAdapter implements VehicleSessionAdapter {
 readonly mode='backend' as const;
 private readonly initial:SessionSnapshot;
 private state:SessionSnapshot;
 private listeners=new Set<()=>void>();
 private running=false;private timer:ReturnType<typeof setInterval>|null=null;private tick=0;
 private generation=0;private request:AbortController|null=null;private health:AbortController|null=null;
 private busy=false;private handled:string|null=null;
 private stream:BlackboxBatchStream;
 constructor(private vehicle:Vehicle){
  this.initial={scenario:'normal',telemetry:{...getMockTelemetry('normal',vehicle.id),connected:false,capturedAt:'',operatingSource:'scenario'},samples:[],result:null,history:[],incident:null,blackbox:initialTransfer(),agentCycle:initialAgentCycle(),backend:initialBackendState(),failNext:false,restoring:true,recoveryNotice:'',storageError:''};
  this.state=this.initial;
  this.stream=new BlackboxBatchStream(vehicle.id,blackbox=>{
   this.state={...this.state,blackbox};this.emit();
   if(blackbox.lastBatch&&blackbox.lastBatch.batchId!==this.handled){this.handled=blackbox.lastBatch.batchId;void this.submit(blackbox.lastBatch);}
  });
 }
 getSnapshot=()=>this.state;getServerSnapshot=()=>this.initial;
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 private emit=()=>this.listeners.forEach(fn=>fn());
 private update(patch:Partial<NonNullable<SessionSnapshot['backend']>>){this.state={...this.state,backend:{...this.state.backend!,...patch}};this.emit();}
 start=()=>{
  if(this.running)return;this.running=true;this.generation++;this.tick=0;this.handled=null;
  this.state={...this.initial,restoring:false};this.stream.start();this.sample(false);
  this.timer=setInterval(()=>this.sample(true),1000);void this.checkConnection();void this.restoreIncident();
 };
 dispose=()=>{this.running=false;this.generation++;if(this.timer)clearInterval(this.timer);this.timer=null;this.request?.abort();this.health?.abort();this.request=null;this.busy=false;this.stream.dispose();};
 private sample(count:boolean){
  if(!this.running||this.state.scenario==='offline')return;
  const telemetry=liveSample(this.state.scenario,this.vehicle.id,this.tick++,new Date());
  this.state={...this.state,telemetry,samples:[...this.state.samples,telemetry].slice(-30)};this.emit();if(count)this.stream.push(telemetry);
 }
 setScenario=(scenario:ScenarioId)=>{
  if(!this.running||scenario===this.state.scenario)return;
  this.generation++;this.request?.abort();this.request=null;this.busy=false;this.tick=0;
  this.state={...this.state,scenario,result:null,samples:[],telemetry:{...this.state.telemetry,scenario,connected:false},backend:{...this.state.backend!,phase:scenario==='offline'?'paused':'collecting',error:'',reply:null}};
  this.stream.breakSequence();this.sample(false);
 };
 private async checkConnection(){
  this.health?.abort();const controller=new AbortController();this.health=controller;const generation=this.generation;
  try{const r=await vehicleApi<{status:string}>('health',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(5000)])});if(this.running&&generation===this.generation&&r.status==='ok')this.update({api:'online'});}
  catch{if(this.running&&generation===this.generation&&!controller.signal.aborted)this.update({api:'offline'});}
 }
 private saveIncident(incident:Incident){
  try{localStorage.setItem(`car-neuron.backend-incident.${this.vehicle.id}`,incident.id);}catch{this.state={...this.state,storageError:'Không lưu được mã sự cố để khôi phục khi tải lại.'};}
 }
 private async restoreIncident(){
  const generation=this.generation;
  try{
   const id=localStorage.getItem(`car-neuron.backend-incident.${this.vehicle.id}`);if(!id||!/^inc_[\w-]+$/.test(id))return;
   const incident=await vehicleApi<Incident>(`incidents/${id}`);
   if(!this.running||generation!==this.generation)return;
   if(!isIncident(incident,this.vehicle.id))throw new Error();
   // Only restore server-verified incident identity; never replay a confirmation.
   if(!this.state.backend?.incident)this.update({incident});
  }catch{if(this.running&&generation===this.generation){this.state={...this.state,recoveryNotice:'Chưa khôi phục được sự cố từ backend. Bản ghi đã lưu được giữ nguyên.'};this.emit();}}
 }
 private async submit(batch:BlackboxBatch){
  if(!this.running||this.state.scenario==='offline')return;
  if(this.busy){this.update({skipped:this.state.backend!.skipped+1});return;}
  this.busy=true;const generation=this.generation;const controller=new AbortController();this.request=controller;
  this.update({phase:'sending',error:''});
  try{
   const reply=await vehicleApi<BatchReply>('telemetry',{body:batch,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(125000)])});
   if(!this.running||controller.signal.aborted||generation!==this.generation)return;
   if(reply.vehicleId!==this.vehicle.id||reply.batchId!==batch.batchId||reply.accepted!==15||!isAgentReply(reply.latest,this.vehicle.id,batch.batchId)||(reply.incident&&!isIncident(reply.incident,this.vehicle.id)))throw new Error('Phản hồi không khớp gói dữ liệu của xe.');
   const incident=reply.incident??this.state.backend!.incident;
   if(reply.incident)this.saveIncident(reply.incident);
   const report=this.report(reply);
   this.state={...this.state,result:report,history:report?[report,...this.state.history].slice(0,20):this.state.history};
   this.update({phase:'ready',api:'online',reply,incident,history:[reply,...this.state.backend!.history].slice(0,5)});
  }catch(error){if(this.running&&!controller.signal.aborted&&generation===this.generation)this.update({phase:'error',api:'offline',error:error instanceof Error?error.message:'Chưa nhận được phản hồi backend.'});}
  finally{if(generation===this.generation){this.busy=false;this.request=null;}}
 }
 private report(reply:BatchReply):Analysis{
  const a=reply.latest.assessment;
  return {id:reply.batchId,vehicleId:this.vehicle.id,vehicleName:`${this.vehicle.brand} ${this.vehicle.name}`,powertrain:this.vehicle.powertrain,createdAt:reply.completedAt,source:'backend',score:null,cause:'unclassified',severity:a.severity==='normal'?'good':a.severity==='warning'?'watch':'critical',title:a.severity==='normal'?'Agent chưa ghi nhận bất thường':a.severity==='warning'?'Agent đề xuất kiểm tra xe':'Cảnh báo an toàn từ agent',summary:a.diagnosis,evidence:a.evidence,recommendations:a.recommendations};
 }

 check=()=>{if(!this.state.telemetry.connected)throw new Error('Blackbox đang ngoại tuyến.');if(this.busy)throw new Error('Backend đang xử lý gói trước.');throw new Error(`Đang gom ${this.state.blackbox.buffered}/15 mẫu; sẽ tự gửi khi đủ gói.`);};
 command=()=>{};setFailNext=()=>{};
 dismissRecovery=()=>{this.state={...this.state,recoveryNotice:''};this.emit();};
}
