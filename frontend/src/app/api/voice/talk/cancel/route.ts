import {backendBase, safeApiError, sameOrigin} from "@/lib/backend/proxy";

export const runtime = "nodejs";

/** Logical cancel for one conversation generation. It does not promise the provider stopped billing. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({error: "Origin không hợp lệ."}, {status: 403});
  const form = await request.formData();
  const conversationId = String(form.get("conversationId") ?? "");
  const generation = String(form.get("generation") ?? "");
  if (!/^[\w-]{1,64}$/.test(conversationId) || !/^\d{1,7}$/.test(generation)) {
    return Response.json({error: "Tham số không hợp lệ."}, {status: 400});
  }
  const forward = new FormData();
  forward.set("sessionId", String(form.get("sessionId") ?? "default"));
  forward.set("conversationId", conversationId);
  forward.set("generation", generation);
  try {
    const response = await fetch(`${backendBase()}/api/voice/talk/cancel`, {method: "POST", body: forward, signal: AbortSignal.timeout(10_000)});
    if (!response.ok) return Response.json({error: safeApiError(response.status)}, {status: response.status});
    return Response.json({ok: true});
  } catch {
    return Response.json({error: "Không kết nối được backend hoặc yêu cầu đã hết thời gian."}, {status: 502});
  }
}
