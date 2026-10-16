import {sameOrigin,safeApiError,upstream,publicPayload} from '@/lib/backend/proxy';
export const runtime='nodejs';
type Context={params:Promise<{path:string[]}>};
async function handle(request:Request,context:Context){
  const path=(await context.params).path.join('/');
  const confirming=/^incidents\/inc_[\w-]+\/confirm$/.test(path);
  const allowed=request.method==='GET'?/^(health|incidents\/inc_[\w-]+(?:\/memory)?|vehicles\/[\w-]{1,64}\/(?:profile|dtc))$/.test(path):/^vehicles\/[\w-]{1,64}\/profile$/.test(path)||confirming;
  if(!allowed)return Response.json({error:'Endpoint không được hỗ trợ.'},{status:404});
  if(!sameOrigin(request))return Response.json({error:'Origin không hợp lệ.'},{status:403});
  let body:unknown;
  if(request.method==='POST'){
    const text=await request.text();
    if(text.length>10000)return Response.json({error:'Yêu cầu quá lớn.'},{status:413});
    try{body=JSON.parse(text);}catch{return Response.json({error:'JSON không hợp lệ.'},{status:400});}
    // The only write: the driver's confirmation of a pending booking, by its id and nothing else.
    if(confirming&&!(body&&typeof body==='object'&&Object.keys(body).join()==='pending_action_id'&&/^act_[0-9a-f]{12}$/.test(String((body as {pending_action_id:unknown}).pending_action_id))))return Response.json({error:'Yêu cầu xác nhận không hợp lệ.'},{status:400});
  }
  try{
    const response=await upstream(path==='health'?'/health':`/api/${path}`,body);
    if(!response.ok)return Response.json({error:safeApiError(response.status)},{status:response.status});
    return Response.json(publicPayload(await response.json()));
  }catch{return Response.json({error:'Không kết nối được backend hoặc yêu cầu đã hết thời gian.'},{status:502});}
}
export const GET=handle;export const POST=handle;
