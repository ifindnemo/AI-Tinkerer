"""Pre-warm exact deterministic demo lines; --dry-run never contacts a provider."""
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def demo_lines():
    from analysis.rules import batch_rules_assessment
    from driver.guardian import combine
    from driver.rules import assess
    from driver.schemas import DriverEvent, VehicleSnapshot
    from agent.plan import decide
    from voice import alert_script, fast_alert_line, _first_sentence
    from talk import fallback_reply

    now = datetime(2026, 10, 17, tzinfo=timezone.utc)
    for lang in ("vi", "en"):
        # Same 1 Hz, 15-sample format as the blackbox. Normal deliberately has no spoken alert.
        for coolant in (90, 106, 122):
            records = [{"captured_at": (now + timedelta(seconds=i)).isoformat(), "coolant_temp_c": coolant,
                        "speed": 60, "rpm": 2000, "engine_load_pct": 40} for i in range(15)]
            assessment = batch_rules_assessment({"records": records, "lang": lang, "sample_interval_ms": 1000})
            if assessment.severity.value != "normal":
                yield lang, "warm" if assessment.severity.value == "warning" else "overheat", alert_script(fast_alert_line(assessment.diagnosis, lang), assessment.severity.value, assessment.recommendations[:1], lang)
        event = DriverEvent.model_validate({"capturedAt": now, "facePresent": True, "absentMs": 0,
            "eyes": {"closed": True, "closedMs": 2600}, "head": {"direction": "forward", "awayMs": 0},
            "state": "drowsy", "confidence": 0.95})
        vehicle = VehicleSnapshot.model_validate({"source": "simulated", "capturedAt": now, "speedKmh": 60, "coolantC": 106})
        result = combine(assess([event], True, lang), [event], vehicle, responded=False, unanswered=False, alert_since=now, maintenance=None)
        yield lang, "drowsy", alert_script(result.summary, result.decision.severity, result.recommendations, lang)
        # The plan is spoken as its first sentence only; these two do not name a garage, so they never change.
        drowsy_context = {"driver_attention": {"status": "live", "attention": "low_attention", "state": "drowsy", "severity": "critical"},
                          "records": [{"speed": 60}], "driver_policy_raised": True}
        for scene, severity in (("plan-rest", "warning"), ("plan-stop", "critical")):
            context = drowsy_context if scene == "plan-rest" else {**drowsy_context, "driver_policy_raised": False, "records": [{"speed": 60, "coolant_temp_c": 125}]}
            plan = decide(severity, context, [], lang)
            if plan and plan["spoken"]:
                yield lang, scene, _first_sentence(plan["spoken"])
        yield lang, "stop-reply", fallback_reply("", {"must_stop": True}, lang)
        yield lang, "stale-reply", fallback_reply("", {"fresh": False, "stale": True}, lang)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    if not args.dry_run and os.getenv("CAR_NEURON_ALLOW_PAID_TTS") != "1":
        print("Refusing paid TTS: set CAR_NEURON_ALLOW_PAID_TTS=1, or use --dry-run.")
        return 2
    if not args.dry_run:
        from dotenv import load_dotenv
        load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    # CLI calls from the repo root resolve relative voice paths like the backend server.
    for variable in ("BLAZE_VOICE_DIR", "BLAZE_VOICE_PREFERENCE_FILE"):
        value = os.getenv(variable)
        if value and not Path(value).is_absolute():
            os.environ[variable] = str(Path(__file__).resolve().parents[1] / value)
    import voice
    print("Reference rules: normal=silent; warm; drowsy while moving. No model calls.")
    if voice.detail_full():
        print("ALERT_VOICE_DETAIL=full: the alert lines carry the reading (106.0, 122.0 C here), so they only come from the cache when "
              "the demo reads exactly the same figure. Plan and reply lines never change. ALERT_VOICE_DETAIL=brief makes every line cacheable.")
    for lang, scene, line in demo_lines():
        if not voice.enabled(lang):
            print(f"{lang} {scene}: unconfigured | {line}")
            if not args.dry_run:
                return 1
            continue
        with voice._client_from_env(lang) as client:
            for part in voice._tts_parts(line):
                text = voice.spoken_form(part, lang)
                if args.dry_run:
                    key = voice._cache_key(client, text)
                    hit = False
                    try:
                        path = voice._cache_dir() / f"{key}.audio"
                        data = path.read_bytes()
                        info = json.loads(path.with_suffix(".json").read_text())
                        hit = voice._valid_cache_audio(data, info["content_type"]) and hashlib.sha256(data).hexdigest() == info["sha256"]
                    except (OSError, ValueError, KeyError, TypeError):
                        pass
                    print(f"{lang} {scene}: cache={'hit' if hit else 'miss'} | {part}")
                else:
                    try:
                        audio = voice._prepare_audio(client, text, "normal")
                        print(f"{lang} {scene}: cache={'hit' if audio.hit else 'miss'} chars={len(text)}")
                        audio.release()
                    except Exception as error:
                        print(f"Pre-warm failed ({type(error).__name__}); service details omitted")
                        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
