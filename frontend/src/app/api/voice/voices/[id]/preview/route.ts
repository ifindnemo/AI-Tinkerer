import {upstream} from "@/lib/backend/proxy";
export const runtime = "nodejs";

type Context = {params: Promise<{id: string}>};
const AUDIO = /^audio\/[\w.+-]+$/;

// A few seconds of a voice so the person can hear it before choosing. The backend checks the id is a listed voice.
export async function GET(request: Request, context: Context) {
  const {id} = await context.params;
  const lang = new URL(request.url).searchParams.get("lang") ?? "vi";
  if (!/^[\w.-]{1,80}$/.test(id) || !/^(vi|en)$/.test(lang)) return new Response(null, {status: 404});
  try {
    const response = await upstream(`/api/voice/voices/${encodeURIComponent(id)}/preview?lang=${lang}`, undefined, AbortSignal.timeout(20000));
    const type = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!response.ok || !AUDIO.test(type)) return new Response(null, {status: response.ok ? 502 : response.status});
    return new Response(await response.arrayBuffer(), {headers: {"Content-Type": type, "Cache-Control": "private, max-age=3600"}});
  } catch {
    return new Response(null, {status: 502});
  }
}
