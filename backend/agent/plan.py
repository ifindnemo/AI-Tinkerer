"""What the driver should do now: one plan from the car's level and the driver's state together.

The same fault calls for different things depending on who is driving. A warning with an alert
driver means "go to the nearest garage when convenient" and the agent may propose an appointment;
the same warning with a drowsy driver means "stop and rest first, then decide", and no appointment
is proposed. A critical fault always means stop and do not drive on: the car goes to a garage by
roadside assistance, and a drowsy driver also rests.

Deterministic, like the Guardian policy: the LLM words the diagnosis, this decides the plan. Only
garages a tool really returned are named. Advice only: Car Neuron never calls anyone.
"""

from typing import Any

from driver.registry import vehicle_moving
from lang import normalize, number

# Plan codes, from the least to the most restrictive.
GARAGE = "garage_when_convenient"
FOCUS = "focus_then_garage"
REST = "rest_then_decide"
STOP = "stop_and_get_help"
STOP_REST = "stop_rest_and_get_help"


def driver_state(context: dict[str, Any]) -> str:
    """"drowsy", "distracted", "unknown", "alert" (attentive) or "none" (no live camera alert: the camera
    posts only when an alert rises, so this is not proof the driver is alert)."""
    driver = context.get("driver_attention") or {}
    if driver.get("status") != "live":
        return "none"
    if driver.get("attention") == "unknown":
        return "unknown"
    if driver.get("attention") != "low_attention" or driver.get("severity") == "normal":
        return "alert"
    return "drowsy" if driver.get("state") == "drowsy" else "distracted"


def decide(severity: str, context: dict[str, Any], trace: list[dict[str, Any]] | None, lang: str = "vi") -> dict[str, Any] | None:
    """The plan for a warning or critical car, or None for a normal one."""
    if severity not in ("warning", "critical"):
        return None
    from voice import _familiar_garage, _km, _nearby_garages  # the same garage reading the voice uses

    en = normalize(lang) == "en"
    state = driver_state(context)
    moving = vehicle_moving(context)
    garages = _nearby_garages(trace)
    nearest = garages[0] if garages else None
    familiar = _familiar_garage(trace)
    # On screen "0,8 km"; the spoken sentences use the voice's "0,8 kilômét".
    where = f"{nearest['name']} ({number(round(nearest['km'], 1), lang, 1)} km)" if nearest else None

    def say(vi: str, en_text: str) -> str:
        return en_text if en else vi

    # Critical only because of the driver (the car itself is at warning): the driver rests; the car needs no tow.
    raised_by_driver = severity == "critical" and bool(context.get("driver_policy_raised")) and state in ("drowsy", "distracted")
    if severity == "critical" and not raised_by_driver:
        code = STOP_REST if state == "drowsy" else STOP
        title = say("Dừng xe, tắt máy và không lái tiếp", "Stop, switch off the engine and do not drive on")
        steps = [say("Dừng ở vị trí an toàn gần nhất và tắt máy.", "Stop at the nearest safe place and switch off the engine.")]
        if state == "drowsy":
            steps.append(say("Bạn đang buồn ngủ: nghỉ ngay tại chỗ, kể cả khi xe đã nguội cũng không lái tiếp.",
                             "You are drowsy: rest where you are; do not drive on even once the engine has cooled."))
        options = [
            say(f"Gọi cứu hộ kéo xe về {where}" if where else "Gọi cứu hộ kéo xe về garage",
                f"Call roadside assistance to tow the car to {where}" if where else "Call roadside assistance to tow the car to a garage"),
            say("Nhờ người thân hoặc bạn bè đến đón", "Ask a family member or friend to pick you up"),
        ]
        spoken = say(
            "Đừng tự lái xe đến garage. " + (f"Hãy gọi cứu hộ kéo xe về {nearest['name']}, cách {_km(nearest['km'], lang)}," if nearest else "Hãy gọi cứu hộ kéo xe về garage,")
            + " hoặc nhờ người đến đón." + (" Bạn đang buồn ngủ, hãy nghỉ ngay tại chỗ." if state == "drowsy" else ""),
            "Do not drive the car to a garage yourself. " + (f"Call roadside assistance to tow it to {nearest['name']}, {_km(nearest['km'], lang)} away," if nearest else "Call roadside assistance to tow it to a garage,")
            + " or ask someone to pick you up." + (" You are drowsy: rest where you are." if state == "drowsy" else ""),
        )
        return _plan(code, state, title, steps, options, spoken, booking=False)

    if state == "drowsy" or raised_by_driver:
        title = say("Dừng xe ngay và nghỉ, rồi mới quyết định đi garage", "Stop now and rest, then decide about the garage") if raised_by_driver \
            else say("Nghỉ trước, rồi mới quyết định đi garage", "Rest first, then decide about the garage")
        steps = [say("Dừng ở vị trí an toàn gần nhất và nghỉ 15–20 phút." if moving else "Nghỉ 15–20 phút trước khi lái.",
                     "Stop at the nearest safe place and rest for 15–20 minutes." if moving else "Rest for 15–20 minutes before driving."),
                 say("Lỗi xe chưa buộc dừng, nhưng không lái tiếp khi đang buồn ngủ.", "The fault does not force a stop, but do not drive on while drowsy.")]
        options = [
            say(f"Nghỉ xong và tỉnh táo: lái chậm đến {where}" if where else "Nghỉ xong và tỉnh táo: lái chậm đến garage gần nhất",
                f"Rested and alert: drive gently to {where}" if where else "Rested and alert: drive gently to the nearest garage"),
            say("Vẫn mệt: nhờ người đến đón hoặc gọi cứu hộ", "Still tired: ask someone to pick you up or call roadside assistance"),
        ]
        spoken = say(
            "Hãy nghỉ trước. Nghỉ xong mà thấy tỉnh táo thì lái chậm đến "
            + (f"{nearest['name']}, cách {_km(nearest['km'], lang)}." if nearest else "garage gần nhất.")
            + " Nếu vẫn mệt, hãy nhờ người đến đón hoặc gọi cứu hộ.",
            "Rest first. Once rested and alert, drive gently to "
            + (f"{nearest['name']}, {_km(nearest['km'], lang)} away." if nearest else "the nearest garage.")
            + " If you are still tired, ask someone to pick you up or call roadside assistance.",
        )
        return _plan(REST, state, title, steps, options, spoken, booking=False)

    code = FOCUS if state == "distracted" else GARAGE
    title = say("Giảm tải và đến garage gần nhất khi thuận tiện", "Ease off and visit the nearest garage when convenient")
    steps = [say("Giảm tải, tránh tăng tốc mạnh và theo dõi nhiệt độ.", "Ease off, avoid hard acceleration and watch the temperature.")]
    if state == "distracted":
        steps.insert(0, say("Nhìn lại phía trước ngay.", "Look back at the road now."))
    options = [say(f"Đặt lịch tại {where}" if where else "Đặt lịch tại garage gần nhất", f"Book at {where}" if where else "Book at the nearest garage")]
    if familiar and (not nearest or familiar != nearest["name"]):
        options.append(say(f"Hoặc về garage quen {familiar}", f"Or go to your usual garage, {familiar}"))
    options.append(say("Nếu nhiệt độ tiếp tục tăng: dừng xe và tắt máy", "If the temperature keeps rising: stop and switch off the engine"))
    spoken = ""
    if nearest:
        spoken = say(f"Garage gần nhất là {nearest['name']}, cách {_km(nearest['km'], lang)}.",
                     f"The nearest garage is {nearest['name']}, {_km(nearest['km'], lang)} away.")
        if familiar and familiar != nearest["name"]:
            spoken += say(f" Hoặc về garage quen {familiar}.", f" Or your usual garage, {familiar}.")
    if state == "distracted":
        spoken = say("Nhìn lại phía trước. ", "Look back at the road. ") + spoken
    return _plan(code, state, title, steps, options, spoken.strip(), booking=True)


def _plan(code: str, state: str, title: str, steps: list[str], options: list[str], spoken: str, *, booking: bool) -> dict[str, Any]:
    return {"code": code, "driver": state, "title": title, "steps": steps, "options": options, "spoken": spoken, "booking": booking}
