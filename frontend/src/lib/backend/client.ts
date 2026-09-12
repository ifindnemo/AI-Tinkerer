export async function vehicleApi<T>(path:string, options:{body?:unknown;signal?:AbortSignal}={}):Promise<T>{
  const response=await fetch(`/api/vehicle/${path}`,{method:options.body===undefined?'GET':'POST',headers:options.body===undefined?undefined:{'Content-Type':'application/json'},body:options.body===undefined?undefined:JSON.stringify(options.body),signal:options.signal??AbortSignal.timeout(130000),cache:'no-store'});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(typeof data?.error==='string'?data.error:`API chưa hoàn tất yêu cầu (HTTP ${response.status}).`);
  return data as T;
}
