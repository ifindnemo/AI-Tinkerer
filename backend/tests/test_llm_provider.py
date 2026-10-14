"""Provider selection only: no network calls."""

import llm_provider


def test_inworld_is_used_when_its_key_is_set(monkeypatch) -> None:
    monkeypatch.setenv("INWORLD_API_KEY", "dGVzdDp0ZXN0")
    monkeypatch.setenv("LLMMODEL", "openai/gpt-5-mini")
    assert llm_provider.provider() == "inworld"
    assert llm_provider.model_name() == "openai/gpt-5-mini"
    assert llm_provider.model_settings(parallel_tool_calls=True).store is None  # OpenAI-only option left out


def test_openai_defaults_without_an_inworld_key(monkeypatch) -> None:
    monkeypatch.delenv("INWORLD_API_KEY", raising=False)
    monkeypatch.setenv("LLMMODEL", "openai/gpt-5-mini")
    monkeypatch.setenv("OPENAI_MODEL", "gpt-4.1-mini")
    assert llm_provider.provider() == "openai"
    assert llm_provider.model_name() == "gpt-4.1-mini"
    assert llm_provider.model_settings().store is False


def test_missing_llmmodel_falls_back_to_openai_model(monkeypatch) -> None:
    monkeypatch.setenv("INWORLD_API_KEY", "dGVzdDp0ZXN0")
    monkeypatch.setenv("LLMMODEL", " ")
    monkeypatch.setenv("OPENAI_MODEL", "gpt-4.1-mini")
    assert llm_provider.model_name() == "gpt-4.1-mini"


def test_request_timeout_is_bounded_and_tolerates_bad_values(monkeypatch) -> None:
    monkeypatch.delenv("LLM_REQUEST_TIMEOUT_SECONDS", raising=False)
    assert llm_provider.request_timeout() == 20.0
    monkeypatch.setenv("LLM_REQUEST_TIMEOUT_SECONDS", "8")
    assert llm_provider.request_timeout() == 8.0
    monkeypatch.setenv("LLM_REQUEST_TIMEOUT_SECONDS", "oops")
    assert llm_provider.request_timeout() == 20.0
    monkeypatch.setenv("LLM_REQUEST_TIMEOUT_SECONDS", "0")
    assert llm_provider.request_timeout() == 1.0
