"""Which LLM the agents use. Keys stay here, in Python, and are never sent to the browser.

With INWORLD_API_KEY set, every agent goes through Inworld Router, which speaks the OpenAI API
at https://api.inworld.ai/v1 (Chat Completions). LLMMODEL names the model, e.g. "openai/gpt-5-mini"
or "inworld/<router-id>". Without it, the OpenAI defaults (OPENAI_API_KEY, OPENAI_MODEL) apply.
"""

import os
from threading import Lock

INWORLD_BASE_URL = "https://api.inworld.ai/v1"
DEFAULT_OPENAI_MODEL = "gpt-4.1-mini"

_lock = Lock()
_configured: str | None = None


def provider() -> str:
    return "inworld" if os.getenv("INWORLD_API_KEY", "").strip() else "openai"


def model_name() -> str:
    if provider() == "inworld":
        return os.getenv("LLMMODEL", "").strip() or os.getenv("OPENAI_MODEL", DEFAULT_OPENAI_MODEL)
    return os.getenv("OPENAI_MODEL", DEFAULT_OPENAI_MODEL)


def configure() -> str:
    """Points the Agents SDK at the chosen provider once per process. Returns the provider name."""
    global _configured
    with _lock:
        current = provider()
        if _configured == current:
            return current
        if current == "inworld":
            from agents import set_default_openai_api, set_default_openai_client, set_tracing_disabled
            from openai import AsyncOpenAI

            key = os.environ["INWORLD_API_KEY"].strip()
            # Inworld's key is already the Base64 credential; it is sent as Basic, as in Inworld's docs.
            client = AsyncOpenAI(base_url=INWORLD_BASE_URL, api_key=key, default_headers={"Authorization": f"Basic {key}"})
            set_default_openai_client(client, use_for_tracing=False)
            set_default_openai_api("chat_completions")  # the Router's documented, widest-supported endpoint
            set_tracing_disabled(True)  # traces would otherwise be uploaded to OpenAI with no valid key
        _configured = current
        return current


def model_settings(**extra):
    """`store` is an OpenAI-only option; other providers may reject it."""
    from agents import ModelSettings

    if provider() == "openai":
        extra.setdefault("store", False)
    return ModelSettings(**extra)
