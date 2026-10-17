import {backendBase, publicPayload, safeApiError, sameOrigin} from "@/lib/backend/proxy";

export const runtime = "nodejs";

const MAX_AUDIO = 15 * 1024 * 1024;

/** Speech to text only, so the robot can show the driver's question while the agent is still answering. Nothing is stored. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({error: "Origin không hợp lệ."}, {status: 403});
  const form = await request.formData();
  const file = form.get("file");
  const lang = String(form.get("lang") ?? "vi");
  if (!(file instanceof File) || file.size === 0) return Response.json({error: "Tệp âm thanh trống."}, {status: 400});
  if (file.size > MAX_AUDIO) return Response.json({error: "Tệp âm thanh quá lớn."}, {status: 413});
  if (!/^(vi|en)$/.test(lang)) return Response.json({error: "Tham số không hợp lệ."}, {status: 400});
  const forward = new FormData();
  forward.set("file", file, file.name || "speech.webm");
  forward.set("lang", lang);
  try {
    const response = await fetch(`${backendBase()}/api/voice/transcribe`, {method: "POST", body: forward, signal: AbortSignal.timeout(40_000)});
    if (!response.ok) {
      const headers = new Headers();
      const retryAfter = response.headers.get("retry-after");
      if (response.status === 429 && retryAfter && /^\d{1,3}$/.test(retryAfter)) headers.set("retry-after", retryAfter);
      return Response.json({error: safeApiError(response.status)}, {status: response.status, headers});
    }
    return Response.json(publicPayload(await response.json()));
  } catch {
    return Response.json({error: "Không kết nối được backend hoặc yêu cầu đã hết thời gian."}, {status: 502});
  }
}
