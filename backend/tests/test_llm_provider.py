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


def test_openrouter_wins_when_its_key_is_set_and_defaults_to_deepseek_flash(monkeypatch) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    monkeypatch.setenv("INWORLD_API_KEY", "dGVzdDp0ZXN0")
    monkeypatch.setenv("LLMMODEL", "openai/gpt-5-mini")  # the Inworld model name must not leak into OpenRouter
    monkeypatch.delenv("OPENROUTER_MODEL", raising=False)
    monkeypatch.delenv("LLM_REASONING_EFFORT", raising=False)
    assert llm_provider.provider() == "openrouter"
    assert llm_provider.model_name() == "openai/deepseek/deepseek-v4.1-flash"  # "openai/" is the SDK prefix, stripped before the call
    settings = llm_provider.model_settings(parallel_tool_calls=True)
    assert settings.store is None and settings.reasoning.effort == "none"
    monkeypatch.setenv("OPENROUTER_MODEL", "deepseek/deepseek-v4-flash")
    assert llm_provider.model_name() == "openai/deepseek/deepseek-v4-flash"


def test_a_blank_openrouter_key_changes_nothing(monkeypatch) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "  ")
    monkeypatch.setenv("INWORLD_API_KEY", "dGVzdDp0ZXN0")
    assert llm_provider.provider() == "inworld"
    assert llm_provider.model_settings().reasoning is None


def test_reasoning_effort_can_be_set_switched_off_and_ignores_junk(monkeypatch) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    for raw, expected in (("minimal", "minimal"), (" HIGH ", "high"), ("none", "none"), ("off", None), ("fast", "none"), ("", "none")):
        monkeypatch.setenv("LLM_REASONING_EFFORT", raw)
        assert llm_provider.reasoning_effort() == expected, raw
    monkeypatch.setenv("OPENROUTER_API_KEY", "")
    monkeypatch.setenv("INWORLD_API_KEY", "dGVzdDp0ZXN0")
    monkeypatch.setenv("LLM_REASONING_EFFORT", "medium")
    assert llm_provider.model_settings().reasoning.effort == "medium"
    monkeypatch.delenv("LLM_REASONING_EFFORT")
    assert llm_provider.reasoning_effort() is None, "other providers keep their own default"


def test_configure_points_the_sdk_at_openrouter_without_a_network_call(monkeypatch) -> None:
    import agents

    seen = {}
    monkeypatch.setattr(llm_provider, "_configured", None)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    monkeypatch.setattr(agents, "set_default_openai_client", lambda client, **kw: seen.update(client=client))
    monkeypatch.setattr(agents, "set_default_openai_api", lambda api: seen.update(api=api))
    monkeypatch.setattr(agents, "set_tracing_disabled", lambda flag: seen.update(tracing=flag))
    assert llm_provider.configure() == "openrouter"
    assert str(seen["client"].base_url).rstrip("/") == "https://openrouter.ai/api/v1"
    assert seen["api"] == "chat_completions" and seen["tracing"] is True
    monkeypatch.setattr(llm_provider, "_configured", None)
