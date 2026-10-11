"""Deterministic assessment of the driver's attention. The agent can reword it, never lower it."""

from dataclasses import dataclass, field
from datetime import timedelta
from typing import Literal

from driver.schemas import DriverEvent

Severity = Literal["normal", "warning", "critical"]
MICROSLEEP_CRITICAL_MS = 2500  # eyes closed this long: stop now
LOOK_AWAY_CRITICAL_MS = 4000  # eyes off the road this long while moving
# Drowsiness does not end when the eyes reopen: after a microsleep the alert holds for a minute,
# after any drowsy reading for 20 s. Windows are measured in event time.
MICROSLEEP_HOLD = timedelta(seconds=60)
DROWSY_HOLD = timedelta(seconds=20)


@dataclass(frozen=True)
class RuleResult:
    severity: Severity
    state: str
    summary: str
    evidence: list[str] = field(default_factory=list)
    recommendations: list[str] = field(default_factory=list)
    confidence: float = 0.0

    @property
    def episode_key(self) -> str:
        return f"{self.state}:{self.severity}"


def _seconds(ms: int) -> str:
    return f"{ms / 1000:.1f}".replace(".", ",")


def _direction_label(direction: str | None) -> str:
    return {"left": "sang trái", "right": "sang phải", "up": "lên trên", "down": "xuống dưới"}.get(direction or "", "chỗ khác")


def assess(events: list[DriverEvent], moving: bool) -> RuleResult:
    """`events` are the session's recent events, oldest first; the last one is the current state."""
    if not events:
        raise ValueError("at least one event is required")
    latest = events[-1]
    confidence = latest.confidence
    state = latest.state if latest.face_present and confidence >= 0.5 else ("no_face" if latest.absent_ms >= 2000 else "uncertain")
    now = latest.captured_at
    reliable = [e for e in events if e.face_present and e.confidence >= 0.5 and e.state not in ("uncertain", "no_face")]
    microsleeps = [e for e in reliable if e.eyes.closed_ms >= MICROSLEEP_CRITICAL_MS and now - e.captured_at <= MICROSLEEP_HOLD]
    drowsy_recently = any(e.state == "drowsy" and now - e.captured_at <= DROWSY_HOLD for e in reliable)

    if state == "drowsy" or microsleeps or drowsy_recently:
        window = [e for e in reliable if now - e.captured_at <= MICROSLEEP_HOLD]
        worst = max(window, key=lambda e: e.eyes.closed_ms)
        closed_ms = worst.eyes.closed_ms
        ago = int((now - worst.captured_at).total_seconds())
        perclos = latest.eyes.perclos
        evidence = []
        if closed_ms > 0:
            when = "vừa xong" if ago <= 2 else f"cách đây {ago} giây"
            evidence.append(f"Lần nhắm mắt lâu nhất trong 60 giây gần nhất: {_seconds(closed_ms)} giây ({when}).")
        if perclos is not None:
            evidence.append(f"Tỉ lệ thời gian nhắm mắt trong 30 giây gần nhất: {perclos * 100:.0f}%.")
        evidence.append(f"Độ tin cậy của phép đo: {confidence * 100:.0f}% (ước lượng, chưa hiệu chuẩn).")
        critical = bool(microsleeps)
        if state == "drowsy":
            summary = "Tài xế có dấu hiệu buồn ngủ" + (": mắt nhắm quá lâu." if critical else ".")
        elif state in ("attentive", "distracted") and not latest.eyes.closed:
            summary = "Mắt đã mở lại, nhưng tài xế vừa có dấu hiệu buồn ngủ" + (" và nhắm mắt quá lâu." if critical else ".")
        else:
            summary = "Cảnh báo buồn ngủ trước đó vẫn còn hiệu lực; camera chưa xác nhận tài xế đã phục hồi."
        return RuleResult(
            "critical" if critical else "warning", "drowsy",
            summary,
            evidence,
            [
                ("Tấp xe vào nơi an toàn ngay khi có thể và dừng lại." if critical else "Tìm chỗ dừng an toàn gần nhất để nghỉ.") if moving else "Giữ xe ở nơi đỗ an toàn; chưa tiếp tục lái khi còn buồn ngủ.",
                "Nghỉ ít nhất 15–20 phút hoặc đổi người lái; bật nhạc hay mở cửa sổ chỉ giúp tạm thời.",
            ],
            confidence,
        )

    if state == "distracted":
        away_ms = latest.head.away_ms
        evidence = [
            f"Đầu quay {_direction_label(latest.head.direction)} liên tục {_seconds(away_ms)} giây.",
            f"Độ tin cậy của phép đo: {confidence * 100:.0f}% (ước lượng, chưa hiệu chuẩn).",
        ]
        if not moving:
            return RuleResult(
                "normal", state, "Tài xế đang nhìn đi chỗ khác nhưng xe đang đứng yên.", evidence,
                ["Không cần xử lý khi xe đứng yên; hãy nhìn lại phía trước trước khi di chuyển."], confidence,
            )
        critical = away_ms >= LOOK_AWAY_CRITICAL_MS
        return RuleResult(
            "critical" if critical else "warning", state,
            "Đầu tài xế đang quay khỏi hướng đường" + (" quá lâu." if critical else "."),
            evidence,
            ["Đưa mắt nhìn lại phía trước ngay.", "Nếu cần xem điện thoại hay chỉnh thiết bị, hãy dừng xe ở nơi an toàn trước."],
            confidence,
        )

    if state == "no_face":
        evidence = [f"Không thấy khuôn mặt liên tục {_seconds(latest.absent_ms)} giây."]
        if not moving:
            return RuleResult("normal", state, "Không thấy tài xế trong khung hình, xe đang đứng yên.", evidence,
                              ["Kiểm tra camera nếu tài xế vẫn ngồi trên xe."], 0.0)
        return RuleResult(
            "warning", state, "Camera không thấy khuôn mặt tài xế khi xe đang chạy.", evidence,
            ["Khi đã dừng xe an toàn, kiểm tra camera có bị che hoặc lệch không.", "Chỉnh lại góc camera và ánh sáng để thấy rõ khuôn mặt."], 0.0,
        )

    if state == "uncertain":
        return RuleResult(
            "normal", state, "Chưa đủ tin cậy để đánh giá mức chú ý của tài xế.",
            [f"Độ tin cậy của phép đo: {confidence * 100:.0f}%."],
            ["Kiểm tra ánh sáng và vị trí camera; hệ thống không đưa ra cảnh báo khi chưa đủ tin cậy."], confidence,
        )

    return RuleResult(
        "normal", state, "Chưa ghi nhận dấu hiệu cần cảnh báo trong quan sát hiện tại.",
        [f"Thời gian nhắm mắt và quay đầu chưa vượt ngưỡng cảnh báo; độ tin cậy {confidence * 100:.0f}%."],
        ["Tiếp tục theo dõi."], confidence,
    )
