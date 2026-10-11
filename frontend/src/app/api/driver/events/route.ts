import {publicPayload, safeApiError, sameOrigin, upstream} from '@/lib/backend/proxy';
export const runtime='nodejs';
const MAX_BODY=50_000;
// Structured driver-attention events only. The backend schema rejects any extra field,
// so an image or video payload cannot pass through here.
export async function POST(request:Request){
  if(!sameOrigin(request))return Response.json({error:'Origin không hợp lệ.'},{status:403});
  const text=await request.text();
  if(text.length>MAX_BODY)return Response.json({error:'Yêu cầu quá lớn.'},{status:413});
  let body:unknown;
  try{body=JSON.parse(text);}catch{return Response.json({error:'JSON không hợp lệ.'},{status:400});}
  try{
    const response=await upstream('/api/driver/events',body,AbortSignal.timeout(20000));
    if(!response.ok)return Response.json({error:safeApiError(response.status)},{status:response.status});
    return Response.json(publicPayload(await response.json()));
  }catch{return Response.json({error:'Không kết nối được backend hoặc yêu cầu đã hết thời gian.'},{status:502});}
}
