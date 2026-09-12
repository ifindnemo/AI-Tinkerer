import {MockPeriodicAgent, initialAgentCycle} from "../periodic-agent/mock";
import {BlackboxBatchStream} from "../blackbox/batch-stream";
import {BLACKBOX_SAMPLE_MS, initialTransfer} from "../blackbox/types";
import { getMockTelemetry, analyzeTelemetry, type ScenarioId } from "../telemetry";
import type { Vehicle } from "../vehicles";
import {liveSample} from "../live-telemetry";
import {createIncident, incidentReport, observeIncident, simulateIncidentPacket, transitionIncident} from "../safety-agent";
import {executeMockSafetyTool} from "../mock-safety-tools";
import type {DriverCommand, SessionRepository, SessionSnapshot, VehicleSessionAdapter} from "./types";

export class MockVehicleSessionAdapter implements VehicleSessionAdapter {
  readonly mode = "mock" as const;
  private readonly initial: SessionSnapshot;
  private state: SessionSnapshot;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private task: AbortController | null = null;
  private running = false;
  private writeBlocked = false;
  private readonly periodicAgent: MockPeriodicAgent;
  private handledBatchId: string | null = null;
  private readonly blackbox: BlackboxBatchStream;
  private tick = 0;
  private episodeId = "";
  constructor(private vehicle: Vehicle, private repository: SessionRepository) {
    this.initial = {scenario:"normal", telemetry:{...getMockTelemetry("normal",vehicle.id),capturedAt:"",connected:false},
      samples:[], result:null, history:[], incident:null, blackbox:initialTransfer(), agentCycle:initialAgentCycle(), failNext:false, restoring:true, recoveryNotice:"", storageError:""};
    this.state=this.initial;
    this.periodicAgent=new MockPeriodicAgent(vehicle.id,agentCycle=>{this.state={...this.state,agentCycle};this.emit(false);});
    this.blackbox=new BlackboxBatchStream(vehicle.id,blackbox=>{
      this.state={...this.state,blackbox};this.emit(false);
      if(blackbox.lastBatch && blackbox.lastBatch.batchId!==this.handledBatchId){
        this.handledBatchId=blackbox.lastBatch.batchId;
        if(this.state.scenario==="normal")this.periodicAgent.submit(blackbox.lastBatch);
      }
    });
  }
  getSnapshot = () => this.state;
  getServerSnapshot = () => this.initial;
  subscribe = (listener: () => void) => {this.listeners.add(listener);return () => {this.listeners.delete(listener);};};
  private emit(save = true) {
    if (save && !this.writeBlocked && this.episodeId) {
      try {
        this.repository.save({version:1,vehicleId:this.vehicle.id,savedAt:new Date().toISOString(),scenario:this.state.scenario,
          tick:this.tick,episodeId:this.episodeId,telemetry:this.state.telemetry,history:this.state.history,incident:this.state.incident});
        this.state={...this.state,storageError:""};
      } catch {this.state={...this.state,storageError:"Không lưu được phiên trên trình duyệt. Tiến trình hiện tại có thể mất khi tải lại trang."};}
    }
    this.listeners.forEach(listener=>listener());
  }
  start = () => {
    if(this.running)return;
    this.running=true;
    this.episodeId=crypto.randomUUID();
    this.writeBlocked=false;
    try {
      const saved=this.repository.load(this.vehicle.id);
      if(saved){
        this.tick=saved.tick;this.episodeId=saved.episodeId;
        let incident=saved.incident;
        const interrupted=incident?.action?.status==="pending";
        if(incident?.action?.status==="pending")incident=transitionIncident(incident,{type:"TOOL_FAILURE",actionId:incident.action.id,error:"Tác vụ bị gián đoạn khi tải lại trang. Chưa xác định kết quả; chưa tự gửi lại yêu cầu."});
        this.state={...this.initial,scenario:saved.scenario,telemetry:{...saved.telemetry,connected:false},history:saved.history,incident,
          restoring:false,recoveryNotice:interrupted ? "Đã khôi phục sự cố. Hành động bị gián đoạn chưa được xác nhận; cần bạn chủ động thử lại trong demo." : saved.incident ? "Đã khôi phục sự cố và tiến trình đã lưu của xe. Đang nhận lại dữ liệu mới." : "Đã khôi phục phiên theo dõi và lịch sử của xe."};
      }else this.state={...this.initial,restoring:false};
    }catch{
      // Do not overwrite an incompatible/corrupt record with a fresh empty session.
      this.writeBlocked=true;
      this.state={...this.initial,restoring:false,storageError:"Không đọc được phiên đã lưu hoặc dữ liệu không hợp lệ. Bản lưu được giữ nguyên; phiên này chỉ chạy trong bộ nhớ."};
    }
    this.emit();
    this.handledBatchId=null;
    this.periodicAgent.start();
    if(this.state.scenario!=="normal")this.periodicAgent.pause();
    this.blackbox.start();
    this.initialTimer=setTimeout(()=>this.receive(),0);
    this.timer=setInterval(()=>this.receive(true),BLACKBOX_SAMPLE_MS);
  };
  dispose = () => {
    this.running=false;
    this.blackbox.dispose();
    this.periodicAgent.dispose();
    if(this.timer)clearInterval(this.timer);
    if(this.initialTimer)clearTimeout(this.initialTimer);
    this.timer=null;this.initialTimer=null;
    this.task?.abort();this.task=null;
    // Pending is already saved synchronously before tool execution. Restore will
    // mark it interrupted; disposal must never invent a success/failure outcome.
  };
  private receive = (sampleForBackend = false) => {
    if(!this.running || this.state.scenario==="offline")return;
    let packet=liveSample(this.state.scenario,this.vehicle.id,this.tick++);
    let incident=this.state.incident;
    let report;
    if(this.state.scenario==="engine"){
      incident=incident??createIncident(this.episodeId,this.vehicle.id,`${this.vehicle.brand} ${this.vehicle.name}`);
      packet=simulateIncidentPacket(packet,incident);
      incident=observeIncident(incident,packet);
      report=incidentReport(packet,incident);
    }else report={...analyzeTelemetry(packet),id:this.episodeId};
    const exists=this.state.history.some(item=>item.id===report.id);
    const history=exists?this.state.history.map(item=>item.id===report.id?report:item):[report,...this.state.history].slice(0,20);
    this.state={...this.state,telemetry:packet,incident,result:report,history,samples:[...this.state.samples,packet].slice(-30)};
    this.emit();
    if(sampleForBackend)this.blackbox.push(packet);
  };
  setScenario = (scenario: ScenarioId) => {
    if(!this.running || this.state.restoring || scenario===this.state.scenario)return;
    this.task?.abort();this.task=null;
    this.periodicAgent.pause();
    this.blackbox.breakSequence();
    let incident=this.state.incident;
    if(scenario==="offline" && incident?.action?.status==="pending")incident=transitionIncident(incident,{type:"TOOL_FAILURE",actionId:incident.action.id,error:"Kết nối bị gián đoạn. Chưa xác nhận hành động thành công."});
    else if(scenario!=="offline" && !(scenario==="engine" && this.state.scenario==="offline"))incident=null;
    if(scenario!=="offline"){
      this.episodeId=incident?.id??crypto.randomUUID();
      this.tick=0;
    }
    this.state={...this.state,scenario,incident,result:null,samples:[],recoveryNotice:"",
      telemetry:{...this.state.telemetry,scenario,connected:false}};
    this.emit();
    if(scenario==="normal")this.periodicAgent.resume();
    this.receive();
  };
  command = (command: DriverCommand) => {
    const current=this.state.incident;
    if(!this.running || !current || !this.state.telemetry.connected)return;
    const next=transitionIncident(current,command);
    if(next===current)return;
    if(next.action?.id!==current.action?.id)this.task?.abort();
    this.state={...this.state,incident:next};
    if(command.type==="SIMULATE"){this.receive();return;}
    if(command.type!=="CONFIRM" || next.action?.status!=="pending"){this.emit();return;}
    const action=next.action;
    const shouldFail=this.state.failNext;
    this.state={...this.state,failNext:false};
    // Commit pending and the exact approved payload before asynchronous work.
    this.emit();
    this.task?.abort();
    const controller=new AbortController();this.task=controller;
    executeMockSafetyTool(action,controller.signal,shouldFail).then(result=>{
      const latest=this.state.incident;
      if(!this.running || controller.signal.aborted || latest?.id!==next.id)return;
      this.state={...this.state,incident:transitionIncident(latest,{type:"TOOL_SUCCESS",actionId:action.id,result})};this.emit();
    }).catch(error=>{
      const latest=this.state.incident;
      if(!this.running || controller.signal.aborted || latest?.id!==next.id)return;
      this.state={...this.state,incident:transitionIncident(latest,{type:"TOOL_FAILURE",actionId:action.id,error:error instanceof Error?error.message:"Chưa hoàn tất hành động."})};this.emit();
    });
  };
  check = () => {
    if(!this.state.telemetry.connected)throw new Error("Blackbox đang ngoại tuyến. Chưa thể đánh giá chiếc xe.");
    this.state={...this.state,result:this.state.incident?incidentReport(this.state.telemetry,this.state.incident):{...analyzeTelemetry(this.state.telemetry),id:this.episodeId}};
    this.emit();
  };
  setFailNext = (value: boolean) => {this.state={...this.state,failNext:value};this.emit(false);};
  dismissRecovery = () => {this.state={...this.state,recoveryNotice:""};this.emit(false);};
}
