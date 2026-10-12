import {upstream} from "@/lib/backend/proxy";
export const runtime = "nodejs";

type Context = {params: Promise<{id: string}>};
const AUDIO = /^audio\/[\w.+-]+$/;

export async function GET(_request: Request, context: Context) {
  const {id} = await context.params;
  if (!/^clip_\d{1,9}$/.test(id)) return new Response(null, {status: 404});
  try {
    const response = await upstream(`/api/voice/clips/${id}/audio`, undefined, AbortSignal.timeout(10000));
    const type = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!response.ok || !AUDIO.test(type)) return new Response(null, {status: response.ok ? 502 : response.status});
    return new Response(await response.arrayBuffer(), {headers: {"Content-Type": type, "Cache-Control": "private, max-age=3600"}});
  } catch {
    return new Response(null, {status: 502});
  }
}
