import {backendBase, publicPayload, safeApiError, sameOrigin} from "@/lib/backend/proxy";

export const runtime = "nodejs";

const MAX_AUDIO = 15 * 1024 * 1024;

/** One microphone clip for the vehicle agent. Audio stays a file upload; no camera frame is accepted here. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({error: "Origin không hợp lệ."}, {status: 403});
  const form = await request.formData();
  const file = form.get("file");
  const text = String(form.get("text") ?? "").trim();
  const session = String(form.get("sessionId") ?? "");
  const lang = String(form.get("lang") ?? "vi");
  const hasFile = file instanceof File && file.size > 0;
  if (!hasFile && !text) return Response.json({error: "Tệp âm thanh trống."}, {status: 400});
  if (hasFile && file.size > MAX_AUDIO) return Response.json({error: "Tệp âm thanh quá lớn."}, {status: 413});
  if (text.length > 800) return Response.json({error: "Câu nói quá dài."}, {status: 400});
  if (!/^[\w-]{1,64}$/.test(session) || !/^(vi|en)$/.test(lang)) return Response.json({error: "Tham số không hợp lệ."}, {status: 400});
  const forward = new FormData();
  if (hasFile) forward.set("file", file, file.name || "speech.webm");
  if (text) forward.set("text", text);
  forward.set("sessionId", session);
  forward.set("lang", lang);
  try {
    const response = await fetch(`${backendBase()}/api/voice/talk`, {method: "POST", body: forward, signal: AbortSignal.timeout(60_000)});
    if (!response.ok) return Response.json({error: safeApiError(response.status)}, {status: response.status});
    return Response.json(publicPayload(await response.json()));
  } catch {
    return Response.json({error: "Không kết nối được backend hoặc yêu cầu đã hết thời gian."}, {status: 502});
  }
}
