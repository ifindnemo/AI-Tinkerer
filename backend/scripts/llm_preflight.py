"""One tiny LLM call before a demo: which provider and model are in use, and how long does an answer take.

    cd backend && .venv/bin/python scripts/llm_preflight.py

It reads backend/.env like the server does, prints the provider, the model and the latency, never a key,
and exits with 1 when the call fails (wrong key, wrong LLMMODEL, no network). It costs a few tokens.
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

import llm_provider  # noqa: E402


def main() -> int:
    from agents import Agent, Runner

    provider = llm_provider.configure()
    model = llm_provider.model_name()
    print(f"provider: {provider}  model: {model}  timeout per call: {llm_provider.request_timeout():.0f} s")
    agent = Agent(
        name="Preflight",
        instructions="Trả lời đúng một từ: OK.",
        model=model,
        model_settings=llm_provider.model_settings(),
    )
    started = time.monotonic()
    try:
        result = Runner.run_sync(agent, "ping", max_turns=1)
    except Exception as error:  # noqa: BLE001 - a preflight reports any failure
        print(f"FAILED after {time.monotonic() - started:.1f} s: {type(error).__name__}: {str(error)[:300]}")
        return 1
    print(f"OK in {time.monotonic() - started:.1f} s: {str(result.final_output)[:60]!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
