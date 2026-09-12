import {sameOrigin,safeApiError,upstream,publicPayload} from '@/lib/backend/proxy';
export const runtime='nodejs';
type Context={params:Promise<{path:string[]}>};
async function handle(request:Request,context:Context){
  const path=(await context.params).path.join('/');
  const allowed=request.method==='GET'&&/^(health|incidents\/inc_[\w-]+(?:\/memory)?)$/.test(path);
  if(!allowed)return Response.json({error:'Endpoint không được hỗ trợ.'},{status:404});
  if(!sameOrigin(request))return Response.json({error:'Origin không hợp lệ.'},{status:403});
  try{
    const response=await upstream(path==='health'?'/health':`/api/${path}`);
    if(!response.ok)return Response.json({error:safeApiError(response.status)},{status:response.status});
    return Response.json(publicPayload(await response.json()));
  }catch{return Response.json({error:'Không kết nối được backend hoặc yêu cầu đã hết thời gian.'},{status:502});}
}
export const GET=handle;
