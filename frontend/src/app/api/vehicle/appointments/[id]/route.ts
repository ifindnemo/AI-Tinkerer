import {backendBase} from '@/lib/backend/proxy';
export const runtime='nodejs';
// The confirmed appointment as an .ics file: the backend builds it, this only passes it on.
export async function GET(_request:Request,context:{params:Promise<{id:string}>}){
  const {id}=await context.params;
  if(!/^apt_[0-9a-f]{12}$/.test(id))return Response.json({error:'Không tìm thấy lịch hẹn.'},{status:404});
  try{
    const response=await fetch(`${backendBase()}/api/appointments/${id}/calendar.ics`,{cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!response.ok)return Response.json({error:'Không tìm thấy lịch hẹn.'},{status:response.status===404?404:502});
    return new Response(await response.text(),{headers:{'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':`attachment; filename="${id}.ics"`,'Cache-Control':'no-store'}});
  }catch{return Response.json({error:'Không kết nối được backend.'},{status:502});}
}
