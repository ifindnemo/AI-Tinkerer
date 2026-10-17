"""The Blaze clients share one keep-alive pool; nothing here touches the network."""
import http_pool
import stt
import voice


def test_one_client_per_provider_is_reused_across_requests() -> None:
    http_pool.close_all()
    first = http_pool.shared("blaze-tts")
    assert http_pool.shared("blaze-tts") is first
    assert http_pool.shared("blaze-stt") is not first
    http_pool.close_all()
    assert first.is_closed and http_pool.shared("blaze-tts") is not first
    http_pool.close_all()


def test_two_speeches_use_the_same_connection_pool_and_closing_one_keeps_it_open() -> None:
    http_pool.close_all()
    one = voice.BlazeTTS(token="t", speaker_id="v")
    two = voice.BlazeTTS(token="t", speaker_id="v", timeout=5)
    assert one._client is two._client
    one.close()
    with two:
        pass
    assert not one._client.is_closed
    assert two._request_timeout == 5 and one._request_timeout == 15, "each speech keeps its own timeout"
    http_pool.close_all()


def test_speech_to_text_shares_its_own_pool() -> None:
    http_pool.close_all()
    a, b = stt.BlazeSTT(token="t"), stt.BlazeSTT(token="t")
    assert a._client is b._client and a._client is not voice.BlazeTTS(token="t", speaker_id="v")._client
    a.close()
    assert not b._client.is_closed
    http_pool.close_all()
