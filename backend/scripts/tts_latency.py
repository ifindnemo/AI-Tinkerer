"""Manual paid measurement; never runs without CAR_NEURON_ALLOW_PAID_TTS=1."""
import argparse
import os
from pathlib import Path
import statistics
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main(argv=None) -> int:
    if os.getenv("CAR_NEURON_ALLOW_PAID_TTS") != "1":
        print("Refusing paid TTS: set CAR_NEURON_ALLOW_PAID_TTS=1 explicitly to run.")
        return 2
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repeat", type=int, choices=range(1, 11), default=3, help="requests per line; 4 lines, so at most 40 in all")
    args = parser.parse_args(argv)
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    # CLI calls from the repo root resolve relative voice paths like the backend server.
    for variable in ("BLAZE_VOICE_DIR", "BLAZE_VOICE_PREFERENCE_FILE"):
        value = os.getenv(variable)
        if value and not Path(value).is_absolute():
            os.environ[variable] = str(Path(__file__).resolve().parents[1] / value)
    from voice import _client_from_env, enabled, spoken_form

    lines = [("vi", "Cảnh báo. Hãy chú ý phía trước."),
             ("vi", "Nước làm mát đang nóng. Giảm tải động cơ và theo dõi nhiệt độ; dừng ở nơi an toàn nếu nhiệt độ tiếp tục tăng."),
             ("en", "Warning. Please watch the road ahead."),
             ("en", "The coolant is warm. Ease the engine load and watch the temperature; stop somewhere safe if it keeps rising.")]
    print("lang chars requests median_ready_ms max_ready_ms (POST to audio ready; no cache)")
    for lang, line in lines:
        if not enabled(lang):
            print(f"{lang}: voice not configured; no request sent")
            return 1
        samples = []
        try:
            with _client_from_env(lang) as client:
                client.creation_retries = 0  # Raw latency, at most 4 lines x --repeat (default 3, ceiling 10 = 40) creation requests, failures included.
                for _ in range(args.repeat):
                    started = time.monotonic()
                    client.synthesize(spoken_form(line, lang))
                    samples.append((time.monotonic() - started) * 1000)
        except Exception as error:
            print(f"{lang}: measurement failed ({type(error).__name__}); credentials/details omitted")
            return 1
        print(f"{lang:4} {len(line):5} {len(samples):8} {statistics.median(samples):15.1f} {max(samples):12.1f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
