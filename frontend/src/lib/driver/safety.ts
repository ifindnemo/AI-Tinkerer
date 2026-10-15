import {trAgent as tr} from "../preferences";
import type {DriverAssessment, DriverEvent} from "./types";

/** Browser counterpart of driver/rules.py: immediate alerts survive a lost backend connection. */
export class DriverSafety {
  private lastMicrosleep = -Infinity;
  private lastDrowsy = -Infinity;

  update(event: DriverEvent, moving: boolean): DriverAssessment {
    const now = Date.parse(event.capturedAt);
    const reliable = event.facePresent && event.confidence >= 0.5 && !["uncertain", "no_face"].includes(event.state);
    if (reliable && event.eyes.closedMs >= 2500) this.lastMicrosleep = now;
    if (reliable && event.state === "drowsy") this.lastDrowsy = now;
    const result: DriverAssessment = {
      severity: "normal", state: event.state, engine: "rules", fallbackReason: "local", at: event.capturedAt,
      confidence: event.confidence, evidence: [], recommendations: [],
      summary: tr("Đang quan sát trên thiết bị.", "Local observation active."),
    };
    if (now - this.lastDrowsy <= 20_000 || now - this.lastMicrosleep <= 60_000) {
      result.severity = now - this.lastMicrosleep <= 60_000 ? "critical" : "warning";
      result.state = "drowsy";
      result.summary = event.state === "drowsy"
        ? tr("Phát hiện dấu hiệu buồn ngủ. Hãy dừng xe ở vị trí an toàn để nghỉ.", "Signs of drowsiness detected. Stop somewhere safe to rest.")
        : tr("Cảnh báo buồn ngủ trước đó vẫn còn hiệu lực. Mở mắt lại chưa đủ để xác nhận đã phục hồi.", "The earlier drowsiness alert remains active. Reopening the eyes does not confirm recovery.");
      result.recommendations = [moving
        ? tr("Dừng xe ở nơi an toàn; không tiếp tục lái khi chưa tỉnh táo.", "Stop in a safe place; do not keep driving while drowsy.")
        : tr("Giữ xe ở nơi đỗ an toàn; chưa tiếp tục lái khi còn buồn ngủ.", "Remain safely parked; do not resume driving while drowsy.")];
    } else if (moving && reliable && event.state === "distracted") {
      result.severity = event.head.awayMs >= 4000 ? "critical" : "warning";
      result.summary = tr("Đầu đang quay khỏi hướng đường. Hãy nhìn lại phía trước.", "Your head is turned away from the road. Face forward again.");
      result.recommendations = [tr("Dừng xe an toàn trước khi dùng điện thoại hoặc chỉnh thiết bị.", "Stop safely before using a phone or adjusting a device.")];
    } else if (moving && event.state === "no_face") {
      result.severity = "warning";
      result.summary = tr("Camera không quan sát được tài xế.", "The camera cannot see the driver.");
      result.recommendations = [tr("Kiểm tra ánh sáng và góc camera khi an toàn.", "Check the lighting and camera angle when safe.")];
    } else {
      result.summary = ["uncertain", "no_face"].includes(event.state)
        ? tr("Chưa đủ tín hiệu để đánh giá tài xế.", "Not enough signal to assess the driver.")
        : tr("Chưa ghi nhận cảnh báo trong quan sát hiện tại.", "No alert in the current observation.");
    }
    return result;
  }
}
