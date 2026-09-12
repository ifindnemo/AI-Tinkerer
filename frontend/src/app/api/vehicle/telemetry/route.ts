import {batchGateway} from '@/lib/backend/batch-gateway';
import {sameOrigin} from '@/lib/backend/proxy';
export const runtime='nodejs';
export async function POST(request:Request){
  if(!sameOrigin(request))return Response.json({error:'Origin không hợp lệ.'},{status:403});
  let body:unknown;
  try{const text=await request.text();if(text.length>100000)throw new Error();body=JSON.parse(text);}catch{return Response.json({error:'JSON không hợp lệ hoặc vượt giới hạn.'},{status:400});}
  const result=await batchGateway.submit(body);return Response.json(result.body,{status:result.status});
}
