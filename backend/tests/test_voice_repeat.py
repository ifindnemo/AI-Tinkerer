"""The alert voice: full wording by default, and an alert is not repeated before 45 s unless it changed."""
import pytest

import voice


@pytest.fixture
def spoken(monkeypatch):
    lines: list[tuple[str, str]] = []

    class _Inline:
        def submit(self, fn, *args):
            lines.append((args[0], args[1]))  # (script, severity)

    monkeypatch.setenv("BLAZE_API_TOKEN", "test-token")
    monkeypatch.setenv("BLAZE_SPEAKER_ID", "voice-1")
    monkeypatch.setenv("BLAZE_SPEAKER_ID_EN", "voice-en")
    monkeypatch.setattr(voice, "_pool", lambda: _Inline())
    return lines


@pytest.fixture
def clock(monkeypatch):
    state = {"t": voice.time.monotonic()}
    monkeypatch.setattr(voice.time, "monotonic", lambda: state["t"])
    return state


def _full(monkeypatch):
    monkeypatch.setenv("ALERT_VOICE_DETAIL", "full")


def test_full_wording_keeps_the_figures_and_the_whole_step_and_brief_does_not(monkeypatch) -> None:
    text = "Nước làm mát 106.5°C, vượt ngưỡng cảnh báo 105°C và vẫn đang tăng."
    steps = ["Giảm tải động cơ; nếu nhiệt độ vẫn tăng thì tấp vào lề."]
    _full(monkeypatch)
    full = voice.alert_script(text, "warning", steps, "vi")
    assert "106.5" in full and "nếu nhiệt độ vẫn tăng" in full
    monkeypatch.setenv("ALERT_VOICE_DETAIL", "brief")
    brief = voice.alert_script(text, "warning", steps, "vi")
    assert "106" not in brief and "nếu nhiệt độ vẫn tăng" not in brief
    assert len(full) > len(brief)


def test_an_alert_that_only_changed_a_figure_is_not_spoken_again_within_45_seconds(spoken, clock, monkeypatch) -> None:
    _full(monkeypatch)
    first = "Nước làm mát 106.5°C, vượt ngưỡng cảnh báo và vẫn đang tăng."
    again = "Nước làm mát 107.2°C, vượt ngưỡng cảnh báo và vẫn đang tăng."
    voice.announce_alert(first, severity="warning", dedupe_key="a", session_id="car-1", lang="vi")
    clock["t"] += 15
    voice.announce_alert(again, severity="warning", dedupe_key="b", session_id="car-1", lang="vi")  # another key, same words
    assert len(spoken) == 1
    clock["t"] += 31  # 46 s after the first
    voice.announce_alert(again, severity="warning", dedupe_key="c", session_id="car-1", lang="vi")
    assert len(spoken) == 2, "still there after 45 s: spoken again"


def test_a_different_alert_is_spoken_at_once_and_so_is_a_higher_level(spoken, clock, monkeypatch) -> None:
    _full(monkeypatch)
    voice.announce_alert("Nước làm mát đang tăng nhanh.", severity="warning", dedupe_key="a", session_id="car-2", lang="vi")
    clock["t"] += 5
    voice.announce_alert("Điện áp ắc quy thấp khi nổ máy.", severity="warning", dedupe_key="b", session_id="car-2", lang="vi")
    assert len(spoken) == 2, "a different fault is news"
    clock["t"] += 5
    voice.announce_alert("Nước làm mát đang tăng nhanh.", severity="critical", dedupe_key="c", session_id="car-2", lang="vi")
    assert len(spoken) == 3 and spoken[-1][1] == "critical", "the same words at a higher level are not a repeat"


def test_other_cars_and_languages_do_not_silence_each_other(spoken, clock, monkeypatch) -> None:
    _full(monkeypatch)
    text = "Nước làm mát đang tăng nhanh."
    voice.announce_alert(text, severity="warning", dedupe_key="a", session_id="car-3", lang="vi")
    voice.announce_alert(text, severity="warning", dedupe_key="b", session_id="car-4", lang="vi")
    voice.announce_alert("Coolant is rising fast.", severity="warning", dedupe_key="c", session_id="car-3", lang="en")
    assert len(spoken) == 3


def test_a_normal_reading_forgets_what_was_spoken(spoken, clock, monkeypatch) -> None:
    _full(monkeypatch)
    text = "Nước làm mát đang tăng nhanh."
    voice.announce_alert(text, severity="warning", dedupe_key="a", session_id="car-5", lang="vi")
    voice.clear_alert_history("car-5")
    clock["t"] += 3
    voice.announce_alert(text, severity="warning", dedupe_key="b", session_id="car-5", lang="vi")
    assert len(spoken) == 2, "a new episode starts from nothing"


def test_the_plan_reads_its_steps_and_the_garages_in_full_mode(spoken, clock, monkeypatch) -> None:
    _full(monkeypatch)
    result = {
        "assessment": {"severity": "warning"},
        "plan": {"code": "garage_when_convenient", "steps": ["Giảm tải và theo dõi nhiệt độ."], "spoken": "Garage gần nhất là Gara An Phát."},
        "tool_trace": [{"tool": "search_nearby_garages", "result": {"options": [
            {"name": "Gara An Phát", "distance_km": 1.2}, {"name": "Gara Bình An", "distance_km": 2.4}]}}],
    }
    voice.speak_car_fast("car-6", "warning", "vi", "Nước làm mát 106°C, vượt ngưỡng cảnh báo.", "Giảm tải động cơ.")
    voice.speak_car_result("car-6", "warning", "vi", result, "Nước làm mát đang cao.", ["Giảm tải động cơ."])
    plan_line = spoken[-1][0]
    assert "Giảm tải và theo dõi nhiệt độ" in plan_line and "Gara An Phát" in plan_line and "Gara Bình An" in plan_line
    n = len(spoken)
    clock["t"] += 15
    voice.speak_car_result("car-6", "warning", "vi", result, "Nước làm mát đang cao.", ["Giảm tải động cơ."])
    assert len(spoken) == n, "the next batch says the same: silent"
    clock["t"] += 31
    voice.speak_car_result("car-6", "warning", "vi", result, "Nước làm mát đang cao.", ["Giảm tải động cơ."])
    assert len(spoken) > n, "45 s after the first: the plan is spoken again"


def test_the_repeat_setting_tolerates_junk_and_zero_means_once_per_episode(monkeypatch) -> None:
    monkeypatch.setenv("ALERT_REPEAT_SECONDS", "oops")
    assert voice.repeat_seconds() == 45.0
    monkeypatch.setenv("ALERT_REPEAT_SECONDS", "-5")
    assert voice.repeat_seconds() == 0.0
    monkeypatch.setenv("ALERT_REPEAT_SECONDS", "20")
    assert voice.repeat_seconds() == 20.0


def test_a_step_the_diagnosis_already_ends_with_is_not_read_twice(monkeypatch) -> None:
    _full(monkeypatch)
    text = "Người lái có dấu hiệu mất tỉnh táo. Dừng tại vị trí an toàn gần nhất để nghỉ; không tiếp tục đến garage ở xa."
    line = voice.alert_script(text, "critical", ["Dừng tại vị trí an toàn gần nhất để nghỉ."], "vi")
    assert line.lower().count("dừng tại vị trí an toàn gần nhất") == 1
    other = voice.alert_script("Nước làm mát đang cao.", "warning", ["Giảm tải động cơ và theo dõi nhiệt độ."], "vi")
    assert "Giảm tải động cơ" in other, "a step that adds something is still read"
