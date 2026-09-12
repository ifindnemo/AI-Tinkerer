import type {BlackboxBatch} from "../blackbox/types";
export type AgentReply = {
  id: string; batchId: string; vehicleId: string; cycle: number;
  completedAt: string; windowStart: string; windowEnd: string;
  title: string; summary: string; recommendations: {title: string; detail: string}[];
  observations: {label: string; value: string}[];
};
export type AgentCycle = {
  phase: "collecting" | "sending" | "analyzing" | "ready" | "paused";
  batchId: string | null; response: AgentReply | null; history: AgentReply[];
};
export const initialAgentCycle = (): AgentCycle => ({phase:"collecting",batchId:null,response:null,history:[]});

// Canned normal-operation response requested for the frontend demo. Only its
// evidence/window metadata comes from the batch; no backend/LLM is invoked.
export function normalReply(batch: BlackboxBatch, cycle: number, completedAt = new Date().toISOString()): AgentReply {
  const variants = [
    {title:"Chiếc xe đang vận hành ổn định",summary:"Trong lượt theo dõi này, xe chưa ghi nhận lỗi và nhiệt độ làm mát không tăng bất thường. Mình sẽ tiếp tục kiểm tra ở lượt tiếp theo."},
    {title:"Chưa ghi nhận dấu hiệu bất thường",summary:"Lượt kiểm tra mới vẫn cho thấy trạng thái vận hành bình thường. Hiện chưa có đề xuất sửa chữa từ agent mô phỏng."},
    {title:"Các chỉ số tiếp tục ổn định",summary:"Gói dữ liệu vừa cập nhật không ghi nhận mã lỗi. Mình tiếp tục theo dõi nhiệt độ và hệ thống điện của xe mỗi 15 giây."},
  ];
  const last=batch.records.at(-1)!;
  const temperatures=batch.records.map(r=>r.coolant);
  return {id:`reply:${batch.batchId}`,batchId:batch.batchId,vehicleId:batch.vehicleId,cycle,completedAt,
    windowStart:batch.records[0].capturedAt,windowEnd:last.capturedAt,...variants[(cycle-1)%variants.length],
    observations:[{label:"Nước làm mát",value:`${Math.min(...temperatures)}–${Math.max(...temperatures)}°C`},{label:"Ắc quy 12V",value:`${last.battery} V`},{label:"Trạng thái lỗi",value:"Không ghi nhận · Fault 0"}],
    recommendations:[{title:"Tiếp tục theo dõi",detail:"Chưa cần đặt lịch sửa chữa từ lượt kiểm tra mô phỏng này."},{title:cycle%2 ? "Duy trì lịch bảo dưỡng" : "Theo dõi cảnh báo mới",detail:cycle%2 ? "Kiểm tra lịch bảo dưỡng định kỳ của xe khi thuận tiện." : "Mình sẽ cập nhật nhận xét sau gói dữ liệu tiếp theo."}],
  };
}

export class MockPeriodicAgent {
  private state=initialAgentCycle();
  private active=false;
  private seen=new Set<string>();
  private phaseTimer: ReturnType<typeof setTimeout> | null=null;
  private replyTimer: ReturnType<typeof setTimeout> | null=null;
  private generation=0;
  private count=0;
  constructor(private vehicleId: string, private changed: (state: AgentCycle)=>void, private latencyMs=900) {}
  start(){this.cancel();this.active=true;this.count=0;this.seen.clear();this.state=initialAgentCycle();this.changed(this.state);}
  private cancel(){this.generation++;if(this.phaseTimer)clearTimeout(this.phaseTimer);if(this.replyTimer)clearTimeout(this.replyTimer);this.phaseTimer=null;this.replyTimer=null;}
  pause(){this.cancel();this.active=false;this.state={...this.state,phase:"paused",batchId:null};this.changed(this.state);}
  resume(){this.active=true;this.state={...this.state,phase:"collecting",batchId:null};this.changed(this.state);}
  submit(batch: BlackboxBatch){
    if(!this.active || batch.vehicleId!==this.vehicleId || this.seen.has(batch.batchId))return;
    // Never place a canned healthy response on an incomplete or hot/faulted batch.
    if(batch.records.length!==15 || batch.recordCount!==15 || batch.records.some(r=>r.fault!==0 || r.dtc.length>0 || !Number.isFinite(r.coolant) || r.coolant>=100))return;
    this.cancel();const generation=this.generation;this.seen.add(batch.batchId);
    if(this.seen.size>50)this.seen.delete(this.seen.values().next().value!);
    const snapshot=structuredClone(batch);
    this.state={...this.state,phase:"sending",batchId:batch.batchId};this.changed(this.state);
    this.phaseTimer=setTimeout(()=>{
      if(!this.active || generation!==this.generation)return;
      this.state={...this.state,phase:"analyzing"};this.changed(this.state);
    },Math.round(this.latencyMs/3));
    this.replyTimer=setTimeout(()=>{
      if(!this.active || generation!==this.generation)return;
      const response=normalReply(snapshot,++this.count);
      this.state={phase:"ready",batchId:batch.batchId,response,history:[response,...this.state.history].slice(0,5)};this.changed(this.state);
    },this.latencyMs);
  }
  dispose(){this.cancel();this.active=false;}
}
