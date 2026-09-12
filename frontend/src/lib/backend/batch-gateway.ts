import {isAgentReply,validateBatch,type BatchReply} from './contract';
import {safeApiError,upstream,publicPayload} from './proxy';
type Outcome={body:BatchReply|{error:string};status:number};
// Local single-user helper: one backend request per batch, never automatic POST retries.
export class BatchGateway{
 private pending=new Map<string,Promise<Outcome>>();
 constructor(private send:typeof upstream=upstream){}
 async submit(value:unknown):Promise<Outcome>{
  let batch:ReturnType<typeof validateBatch>;
  try{batch=validateBatch(value);}catch(e){return {status:422,body:{error:e instanceof Error?e.message:'Gói không hợp lệ.'}};}
  const key=JSON.stringify(batch);const found=this.pending.get(key);if(found)return found;
  const result=(async():Promise<Outcome>=>{
   try{
    const response=await this.send('/api/telemetry/batch',batch);
    if(!response.ok)return {status:response.status,body:{error:safeApiError(response.status)}};
    const data=publicPayload(await response.json());
    if(!isAgentReply(data,batch.vehicleId,batch.batchId))throw new Error();
    return {status:200,body:{batchId:batch.batchId,vehicleId:batch.vehicleId,accepted:data.accepted_records,completedAt:new Date().toISOString(),latest:data,incident:data.incident??null}};
   }catch{return {status:502,body:{error:'Chưa nhận được kết quả hợp lệ từ backend. Không tự gửi lại gói này.'}};}
  })();
  this.pending.set(key,result);if(this.pending.size>30)this.pending.delete(this.pending.keys().next().value!);return result;
 }
}
export const batchGateway=new BatchGateway();
