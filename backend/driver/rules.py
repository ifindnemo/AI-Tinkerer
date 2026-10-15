"""Deterministic assessment of the driver's attention. The agent can reword it, never lower it."""

from dataclasses import dataclass, field
from datetime import timedelta
from typing import Literal

from driver.schemas import DriverEvent
from lang import normalize, number, pick

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
    lang: str = "vi"  # the language the texts above are written in

    @property
    def episode_key(self) -> str:
        return f"{self.state}:{self.severity}"


def _seconds(ms: int, lang: str = "vi") -> str:
    return number(ms / 1000, lang)


def _direction_label(direction: str | None, lang: str = "vi") -> str:
    vi = {"left": "sang trái", "right": "sang phải", "up": "lên trên", "down": "xuống dưới"}.get(direction or "", "chỗ khác")
    en = {"left": "left", "right": "right", "up": "up", "down": "down"}.get(direction or "", "elsewhere")
    return pick(lang, vi, en)


def assess(events: list[DriverEvent], moving: bool, lang: str = "vi") -> RuleResult:
    """`events` are the session's recent events, oldest first; the last one is the current state.
    `lang` only chooses the wording: the severity never depends on it."""
    if not events:
        raise ValueError("at least one event is required")
    lang = normalize(lang)
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
            when = pick(lang, "vừa xong" if ago <= 2 else f"cách đây {ago} giây", "just now" if ago <= 2 else f"{ago} seconds ago")
            evidence.append(pick(lang, f"Lần nhắm mắt lâu nhất trong 60 giây gần nhất: {_seconds(closed_ms)} giây ({when}).",
                                 f"Longest eye closure in the last 60 seconds: {_seconds(closed_ms, lang)} s ({when})."))
        if perclos is not None:
            evidence.append(pick(lang, f"Tỉ lệ thời gian nhắm mắt trong 30 giây gần nhất: {perclos * 100:.0f}%.",
                                 f"Share of time with eyes closed in the last 30 seconds: {perclos * 100:.0f}%."))
        evidence.append(pick(lang, f"Độ tin cậy của phép đo: {confidence * 100:.0f}% (ước lượng, chưa hiệu chuẩn).",
                             f"Measurement confidence: {confidence * 100:.0f}% (estimate, not calibrated)."))
        critical = bool(microsleeps)
        if state == "drowsy":
            summary = pick(lang, "Tài xế có dấu hiệu buồn ngủ", "The driver shows signs of drowsiness") + (
                pick(lang, ": mắt nhắm quá lâu.", ": eyes closed for too long.") if critical else ".")
        elif state in ("attentive", "distracted") and not latest.eyes.closed:
            summary = pick(lang, "Mắt đã mở lại, nhưng tài xế vừa có dấu hiệu buồn ngủ",
                           "The eyes are open again, but the driver just showed signs of drowsiness") + (
                pick(lang, " và nhắm mắt quá lâu.", " and closed their eyes for too long.") if critical else ".")
        else:
            summary = pick(lang, "Cảnh báo buồn ngủ trước đó vẫn còn hiệu lực; camera chưa xác nhận tài xế đã phục hồi.",
                           "The earlier drowsiness alert is still in effect; the camera has not confirmed that the driver has recovered.")
        if moving:
            first = pick(lang, "Tấp xe vào nơi an toàn ngay khi có thể và dừng lại." if critical else "Tìm chỗ dừng an toàn gần nhất để nghỉ.",
                         "Pull over at a safe place as soon as you can and stop." if critical else "Find the nearest safe place to stop and rest.")
        else:
            first = pick(lang, "Giữ xe ở nơi đỗ an toàn; chưa tiếp tục lái khi còn buồn ngủ.",
                         "Keep the car safely parked; do not drive while drowsy.")
        return RuleResult(
            "critical" if critical else "warning", "drowsy",
            summary,
            evidence,
            [
                first,
                pick(lang, "Nghỉ ít nhất 15–20 phút hoặc đổi người lái; bật nhạc hay mở cửa sổ chỉ giúp tạm thời.",
                     "Rest for at least 15–20 minutes or change drivers; music or an open window only helps briefly."),
            ],
            confidence,
            lang,
        )

    if state == "distracted":
        away_ms = latest.head.away_ms
        evidence = [
            pick(lang, f"Đầu quay {_direction_label(latest.head.direction)} liên tục {_seconds(away_ms)} giây.",
                 f"Head turned {_direction_label(latest.head.direction, lang)} continuously for {_seconds(away_ms, lang)} s."),
            pick(lang, f"Độ tin cậy của phép đo: {confidence * 100:.0f}% (ước lượng, chưa hiệu chuẩn).",
                 f"Measurement confidence: {confidence * 100:.0f}% (estimate, not calibrated)."),
        ]
        if not moving:
            return RuleResult(
                "normal", state,
                pick(lang, "Tài xế đang nhìn đi chỗ khác nhưng xe đang đứng yên.", "The driver is looking away but the car is stationary."),
                evidence,
                [pick(lang, "Không cần xử lý khi xe đứng yên; hãy nhìn lại phía trước trước khi di chuyển.",
                      "No action needed while stationary; look ahead again before moving.")],
                confidence, lang,
            )
        critical = away_ms >= LOOK_AWAY_CRITICAL_MS
        return RuleResult(
            "critical" if critical else "warning", state,
            pick(lang, "Đầu tài xế đang quay khỏi hướng đường", "The driver's head is turned away from the road") + (
                pick(lang, " quá lâu.", " for too long.") if critical else "."),
            evidence,
            [pick(lang, "Đưa mắt nhìn lại phía trước ngay.", "Look back at the road now."),
             pick(lang, "Nếu cần xem điện thoại hay chỉnh thiết bị, hãy dừng xe ở nơi an toàn trước.",
                  "If you need to use your phone or adjust a device, stop somewhere safe first.")],
            confidence, lang,
        )

    if state == "no_face":
        evidence = [pick(lang, f"Không thấy khuôn mặt liên tục {_seconds(latest.absent_ms)} giây.",
                         f"No face seen continuously for {_seconds(latest.absent_ms, lang)} s.")]
        if not moving:
            return RuleResult("normal", state,
                              pick(lang, "Không thấy tài xế trong khung hình, xe đang đứng yên.",
                                   "The driver is not in view and the car is stationary."),
                              evidence,
                              [pick(lang, "Kiểm tra camera nếu tài xế vẫn ngồi trên xe.",
                                    "Check the camera if the driver is still in the seat.")], 0.0, lang)
        return RuleResult(
            "warning", state,
            pick(lang, "Camera không thấy khuôn mặt tài xế khi xe đang chạy.",
                 "The camera cannot see the driver's face while the car is moving."),
            evidence,
            [pick(lang, "Khi đã dừng xe an toàn, kiểm tra camera có bị che hoặc lệch không.",
                  "Once safely stopped, check whether the camera is covered or misaligned."),
             pick(lang, "Chỉnh lại góc camera và ánh sáng để thấy rõ khuôn mặt.",
                  "Adjust the camera angle and lighting so the face is clearly visible.")], 0.0, lang,
        )

    if state == "uncertain":
        return RuleResult(
            "normal", state,
            pick(lang, "Chưa đủ tin cậy để đánh giá mức chú ý của tài xế.",
                 "Not enough confidence to assess the driver's attention."),
            [pick(lang, f"Độ tin cậy của phép đo: {confidence * 100:.0f}%.", f"Measurement confidence: {confidence * 100:.0f}%.")],
            [pick(lang, "Kiểm tra ánh sáng và vị trí camera; hệ thống không đưa ra cảnh báo khi chưa đủ tin cậy.",
                  "Check the lighting and the camera position; the system raises no alert while confidence is low.")],
            confidence, lang,
        )

    return RuleResult(
        "normal", state,
        pick(lang, "Chưa ghi nhận dấu hiệu cần cảnh báo trong quan sát hiện tại.",
             "No signs that need an alert in the current observation."),
        [pick(lang, f"Thời gian nhắm mắt và quay đầu chưa vượt ngưỡng cảnh báo; độ tin cậy {confidence * 100:.0f}%.",
              f"Eye-closure and head-turn times are below the alert thresholds; confidence {confidence * 100:.0f}%.")],
        [pick(lang, "Tiếp tục theo dõi.", "Keep monitoring.")], confidence, lang,
    )
