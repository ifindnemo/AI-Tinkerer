"""Which LLM the agents use. Keys stay here, in Python, and are never sent to the browser.

With OPENROUTER_API_KEY set, every agent goes through OpenRouter (OpenAI-compatible Chat Completions at
https://openrouter.ai/api/v1); OPENROUTER_MODEL names the model (default deepseek/deepseek-v4.1-flash). Remove that
variable to go back to the providers below.

With INWORLD_API_KEY set, every agent goes through Inworld Router, which speaks the OpenAI API
at https://api.inworld.ai/v1 (Chat Completions). LLMMODEL names the model, e.g. "openai/gpt-5-mini"
or "inworld/<router-id>". Without it, the OpenAI defaults (OPENAI_API_KEY, OPENAI_MODEL) apply.
"""

import os
from threading import Lock

INWORLD_BASE_URL = "https://api.inworld.ai/v1"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-v4.1-flash"
REASONING_EFFORTS = ("none", "minimal", "low", "medium", "high", "xhigh", "max")  # which ones a model takes: see its OpenRouter page
DEFAULT_OPENAI_MODEL = "gpt-4.1-mini"

_lock = Lock()
_configured: str | None = None


def request_timeout() -> float:
    """Seconds one LLM HTTP call may take. Without a limit a hung provider holds a worker thread
    for the SDK default of several minutes."""
    try:
        return max(1.0, float(os.getenv("LLM_REQUEST_TIMEOUT_SECONDS", "20")))
    except ValueError:
        return 20.0


def provider() -> str:
    if os.getenv("OPENROUTER_API_KEY", "").strip():
        return "openrouter"
    return "inworld" if os.getenv("INWORLD_API_KEY", "").strip() else "openai"


def reasoning_effort() -> str | None:
    """LLM_REASONING_EFFORT caps how long the model thinks before answering, which is most of the wait for a short
    structured answer. "none" asks for no thinking at all (OpenRouter models that allow it); an effort the model does
    not list on its OpenRouter page is not an error but may be ignored, and then the model's own default applies
    (xhigh for Qwen3.8 27B, high for DeepSeek V4.1 Flash). Unset: "none" on OpenRouter (measured 17/10: "low" did not shorten
    Qwen3.8 27B or DeepSeek V4.1 Flash, "none" cut them from ~21 s to ~10 s), the provider default elsewhere. "off" sends nothing. Anything else is ignored."""
    raw = os.getenv("LLM_REASONING_EFFORT", "").strip().lower()
    if raw in REASONING_EFFORTS:
        return raw
    if raw == "off":
        return None
    return "none" if provider() == "openrouter" else None


def model_name() -> str:
    if provider() == "openrouter":
        # The Agents SDK reads the text before the first "/" as a provider prefix and rejects "deepseek". "openai/" is
        # the prefix it strips before the request, so OpenRouter receives the id exactly as written.
        return "openai/" + (os.getenv("OPENROUTER_MODEL", "").strip() or DEFAULT_OPENROUTER_MODEL)
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
        if current == "openrouter":
            from agents import set_default_openai_api, set_default_openai_client, set_tracing_disabled
            from openai import AsyncOpenAI

            client = AsyncOpenAI(base_url=OPENROUTER_BASE_URL, api_key=os.environ["OPENROUTER_API_KEY"].strip(),
                                 default_headers={"X-Title": "Car Neuron"}, timeout=request_timeout(), max_retries=1)
            set_default_openai_client(client, use_for_tracing=False)
            set_default_openai_api("chat_completions")
            set_tracing_disabled(True)
        elif current == "inworld":
            from agents import set_default_openai_api, set_default_openai_client, set_tracing_disabled
            from openai import AsyncOpenAI

            key = os.environ["INWORLD_API_KEY"].strip()
            # Inworld's key is already the Base64 credential; it is sent as Basic, as in Inworld's docs.
            client = AsyncOpenAI(base_url=INWORLD_BASE_URL, api_key=key, default_headers={"Authorization": f"Basic {key}"},
                                 timeout=request_timeout(), max_retries=1)
            set_default_openai_client(client, use_for_tracing=False)
            set_default_openai_api("chat_completions")  # the Router's documented, widest-supported endpoint
            set_tracing_disabled(True)  # traces would otherwise be uploaded to OpenAI with no valid key
        elif os.getenv("OPENAI_API_KEY", "").strip():
            from agents import set_default_openai_client
            from openai import AsyncOpenAI

            set_default_openai_client(AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"].strip(), timeout=request_timeout(), max_retries=1))
        _configured = current
        return current


def model_settings(**extra):
    """`store` is an OpenAI-only option; other providers may reject it."""
    from agents import ModelSettings
    from openai.types.shared import Reasoning

    if provider() == "openai":
        extra.setdefault("store", False)
    effort = reasoning_effort()
    if effort and "reasoning" not in extra:
        extra["reasoning"] = Reasoning(effort=effort)
    return ModelSettings(**extra)
