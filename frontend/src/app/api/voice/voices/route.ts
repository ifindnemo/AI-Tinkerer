import {backendBase, publicPayload, safeApiError, sameOrigin, upstream} from "@/lib/backend/proxy";
export const runtime = "nodejs";

const LANG = /^(vi|en)$/;
const VOICE_ID = /^[\w.-]{1,80}$/;

// The Blaze voices the person can choose from for one language, and the one in use.
export async function GET(request: Request) {
  const lang = new URL(request.url).searchParams.get("lang") ?? "vi";
  if (!LANG.test(lang)) return Response.json({error: "Tham số không hợp lệ."}, {status: 400});
  try {
    const response = await upstream(`/api/voice/voices?lang=${lang}`, undefined, AbortSignal.timeout(15000));
    if (!response.ok) return Response.json({error: safeApiError(response.status)}, {status: response.status});
    return Response.json(publicPayload(await response.json()));
  } catch {
    return Response.json({error: "Không kết nối được backend."}, {status: 502});
  }
}

// Choose a voice (`voiceId` null: back to the default). The backend accepts only voices it lists for that language.
export async function PUT(request: Request) {
  if (!sameOrigin(request)) return Response.json({error: "Origin không hợp lệ."}, {status: 403});
  let body: {lang?: unknown; voiceId?: unknown};
  try {
    body = await request.json();
  } catch {
    return Response.json({error: "JSON không hợp lệ."}, {status: 400});
  }
  const {lang, voiceId} = body ?? {};
  if (typeof lang !== "string" || !LANG.test(lang) || !(voiceId === null || (typeof voiceId === "string" && VOICE_ID.test(voiceId)))) {
    return Response.json({error: "Tham số không hợp lệ."}, {status: 400});
  }
  try {
    const response = await fetch(`${backendBase()}/api/voice/voice`, {
      method: "PUT",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({lang, voice_id: voiceId}),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return Response.json({error: safeApiError(response.status)}, {status: response.status});
    return Response.json(publicPayload(await response.json()));
  } catch {
    return Response.json({error: "Không kết nối được backend."}, {status: 502});
  }
}
