import {backendBase} from '@/lib/backend/proxy';
export const runtime='nodejs';
const MAX_BODY=1_000_000;
// Gateway uploads through the public URL. The device token is checked by the backend;
// this route only forwards it. Browsers have no reason to call it.
export async function POST(request:Request){
  const authorization=request.headers.get('authorization');
  if(!authorization)return Response.json({detail:'Missing device token'},{status:401});
  const body=await request.text();
  if(body.length>MAX_BODY)return Response.json({detail:'Batch too large'},{status:413});
  try{
    const upstream=await fetch(`${backendBase()}/api/ingest/batch`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:authorization},body,cache:'no-store',signal:AbortSignal.timeout(20000)});
    return new Response(await upstream.text(),{status:upstream.status,headers:{'Content-Type':upstream.headers.get('content-type')??'application/json'}});
  }catch{return Response.json({detail:'Backend unavailable'},{status:502});}
}
