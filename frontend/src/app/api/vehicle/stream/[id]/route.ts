import {backendBase, sameOrigin} from '@/lib/backend/proxy';
export const runtime='nodejs';
type Context={params:Promise<{id:string}>};
// Server-sent events pass through unchanged; the backend redacts every payload before publishing.
// No timeout here: the stream lives as long as the tab, and closing the tab aborts the upstream request.
export async function GET(request:Request,context:Context){
  const {id}=await context.params;
  if(!/^[\w-]{1,64}$/.test(id))return Response.json({error:'Xe không hợp lệ.'},{status:404});
  if(!sameOrigin(request))return Response.json({error:'Origin không hợp lệ.'},{status:403});
  let upstream:Response;
  try{upstream=await fetch(`${backendBase()}/api/vehicles/${id}/stream`,{headers:{Accept:'text/event-stream'},cache:'no-store',signal:request.signal});}
  catch{return Response.json({error:'Không kết nối được backend.'},{status:502});}
  if(!upstream.ok||!upstream.body)return Response.json({error:'Backend chưa mở được luồng dữ liệu.'},{status:502});
  return new Response(upstream.body,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'}});
}
