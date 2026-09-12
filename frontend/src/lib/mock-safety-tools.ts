import type { AgentAction } from "./safety-agent";

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
  if (fail) throw new Error("Dịch vụ mô phỏng tạm thời không phản hồi. Chưa xác nhận thành công.");
  return action.kind === "NAVIGATE_SAFE_STOP"
    ? {requestId: `NAV-${action.payload.incidentId.slice(0, 8)}`, message: "Đã chuẩn bị hướng dẫn tới bãi dừng demo. Không mở ứng dụng bản đồ thật."}
    : {requestId: `RESCUE-${action.payload.incidentId.slice(0, 8)}`, message: "Cứu hộ mô phỏng đã xác nhận · ETA minh họa 18 phút. Không có đơn vị thật nào nhận yêu cầu."};
}
