import {langStore,tr} from '../preferences';
export class ApiError extends Error{constructor(message:string,readonly status:number){super(message);}}
export async function vehicleApi<T>(path:string, options:{body?:unknown;signal?:AbortSignal}={}):Promise<T>{
  const response=await fetch(`/api/vehicle/${path}`,{method:options.body===undefined?'GET':'POST',headers:options.body===undefined?undefined:{'Content-Type':'application/json'},body:options.body===undefined?undefined:JSON.stringify(options.body),signal:options.signal??AbortSignal.timeout(130000),cache:'no-store'});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw new ApiError(typeof data?.error==='string'?data.error:`API chưa hoàn tất yêu cầu (HTTP ${response.status}).`,response.status);
  return data as T;
}
// Server messages are Vietnamese; translate by status so the selected UI language is kept.
export function apiFailureMessage(error:unknown):string{
  if(error instanceof ApiError){
    if(langStore.get()==='vi')return error.message;
    return error.status===422?'The backend rejected the data format.':error.status===403?'Request origin is not allowed.':error.status===404?'Record not found on the backend.':'No valid result from the backend yet. This batch is not resent automatically.';
  }
  if(error instanceof DOMException&&error.name==='TimeoutError')return tr('Backend phản hồi quá thời gian chờ.','The backend timed out.');
  if(error instanceof TypeError)return tr('Không kết nối được tới máy chủ Next.js.','Could not reach the Next.js server.');
  return error instanceof Error&&error.message?error.message:tr('Chưa nhận được phản hồi backend.','No reply from the backend yet.');
}
