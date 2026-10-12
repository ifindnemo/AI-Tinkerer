import {publicPayload, safeApiError, upstream} from "@/lib/backend/proxy";
export const runtime = "nodejs";

// Spoken alerts (Blaze audio) for one session: on the garage page the session is the vehicle id.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const session = url.searchParams.get("session") ?? "";
  const after = url.searchParams.get("after") ?? "0";
  if (!/^[\w-]{1,64}$/.test(session) || !/^\d{1,9}$/.test(after)) return Response.json({error: "Tham số không hợp lệ."}, {status: 400});
  try {
    const response = await upstream(`/api/voice/clips?session=${session}&after=${after}`, undefined, AbortSignal.timeout(5000));
    if (!response.ok) return Response.json({error: safeApiError(response.status)}, {status: response.status});
    return Response.json(publicPayload(await response.json()));
  } catch {
    return Response.json({error: "Không kết nối được backend."}, {status: 502});
  }
}
