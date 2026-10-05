import type { AgentAction } from "./safety-agent";
import { tr } from "./preferences";

// No network, navigation, rescue contact or external data sharing happens here.
// Replace this adapter with the backend action/confirmation contract.
export async function executeMockSafetyTool(action: AgentAction, signal: AbortSignal, fail = false) {
  if (action.status !== "pending") throw new Error("Action must be confirmed before execution.");
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const abort = () => {clearTimeout(timer); reject(new DOMException("Aborted", "AbortError"));};
    const timer = setTimeout(() => {signal.removeEventListener("abort", abort); resolve();}, 1500);
    signal.addEventListener("abort", abort, {once: true});
  });
  if (fail) throw new Error(tr("Dịch vụ mô phỏng tạm thời không phản hồi. Chưa xác nhận thành công.", "The simulated service is not responding. Success not confirmed."));
  return action.kind === "NAVIGATE_SAFE_STOP"
    ? {requestId: `NAV-${action.payload.incidentId.slice(0, 8)}`, message: tr("Đã chuẩn bị hướng dẫn tới bãi dừng demo. Không mở ứng dụng bản đồ thật.", "Directions to the demo stopping area are ready. No real map app was opened.")}
    : {requestId: `RESCUE-${action.payload.incidentId.slice(0, 8)}`, message: tr("Cứu hộ mô phỏng đã xác nhận · ETA minh họa 18 phút. Không có đơn vị thật nào nhận yêu cầu.", "Simulated assistance confirmed · illustrative ETA 18 min. No real provider received the request.")};
}
