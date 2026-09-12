// Server-only: browser requests never contain service API keys.
export async function upstream(path:string,body?:unknown,signal?:AbortSignal):Promise<Response>{
  const base=process.env.BACKEND_URL||'http://127.0.0.1:8000';
  return fetch(`${base.replace(/\/$/,'')}${path}`,{method:body===undefined?'GET':'POST',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:signal??AbortSignal.timeout(120000)});
}
export function sameOrigin(request:Request){
  const origin=request.headers.get('origin');if(!origin)return true;
  try{return new URL(origin).host===(request.headers.get('host')??new URL(request.url).host);}catch{return false;}
}
export function safeApiError(status:number){return status===422?'Backend từ chối định dạng dữ liệu.':status===404?'Không tìm thấy bản ghi trên backend.':status===409?'Hành động đã được xử lý hoặc trạng thái đã thay đổi.':'Backend chưa xử lý được yêu cầu. Kiểm tra dịch vụ và cấu hình API của backend.';}

// Tool failures may contain vendor request URLs. Do not expose credentials embedded in them.
export function publicPayload(value:unknown):unknown {
  if(typeof value==='string')return value.replace(/([?&](?:key|access_token|api_key)=)[^&\s"<>]+/gi,'$1[redacted]').replace(/\bsk-[\w-]{16,}/g,'[redacted]');
  if(Array.isArray(value))return value.map(publicPayload);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,key==='error'&&item!==null?'Dịch vụ chưa trả được dữ liệu.':publicPayload(item)]));
  return value;
}
