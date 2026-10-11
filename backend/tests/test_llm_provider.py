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
