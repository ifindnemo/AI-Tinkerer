"""Actual queued TTS lifecycle with offline network fakes."""
from types import SimpleNamespace
from pathlib import Path
import threading
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
import talk
import voice

_REAL_REGISTER = voice._register

@pytest.fixture
def h(tmp_path, monkeypatch):
    talk.clear_turns()
    monkeypatch.setenv('BLAZE_CONVERSATION_DIR', str(tmp_path))
    monkeypatch.setattr(talk, 'situation', lambda _: {'must_stop': False})
    monkeypatch.setattr(talk, 'answer', lambda *a: 'A short answer.')
    jobs, clips, calls = [], [], []
    class Pool:
        def submit(self, fn, *args): jobs.append(lambda: fn(*args))
    class Client:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def synthesize(self, text):
            calls.append(text)
            return SimpleNamespace(audio=b'fake', content_type='audio/wav')
    monkeypatch.setattr(voice, '_configured', lambda _: True)
    monkeypatch.setattr(voice, '_talk_pool', lambda: Pool())
    monkeypatch.setattr(voice, '_client_from_env', lambda _: Client())
    monkeypatch.setattr(voice, '_write', lambda *_: Path('fake.wav'))
    monkeypatch.setattr(voice, '_register', lambda *a, **kw: clips.append((a, kw)))
    app = FastAPI(); app.include_router(talk.router, prefix='/api')
    client = TestClient(app)
    def post(**overrides):
        return client.post('/api/voice/talk', data={'sessionId': 'car-a', 'lang': 'en', 'text': 'How is the car?', 'conversationId': 'conv-a', 'turnId': 'turn-a', 'generation': '1', **overrides})
    def cancel(**overrides):
        return client.post('/api/voice/talk/cancel', data={'sessionId': 'car-a', 'conversationId': 'conv-a', 'generation': '1', **overrides})
    return SimpleNamespace(post=post, cancel=cancel, jobs=jobs, clips=clips, calls=calls)

def test_http_done_audio_and_cached_duplicate(h):
    first = h.post(); assert first.status_code == 200
    assert first.json()['audioQueued'] is True
    assert not h.calls
    assert h.post().json() == first.json()
    assert len(h.jobs) == 1
    h.jobs.pop()()
    assert len(h.clips) == 1

@pytest.mark.parametrize('when', ['before', 'during'])
def test_cancel_prevents_late_audio(h, monkeypatch, when):
    h.post()
    if when == 'before': h.cancel()
    else:
        class Client:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def synthesize(self, text):
                h.cancel()
                return SimpleNamespace(audio=b'fake', content_type='audio/wav')
        monkeypatch.setattr(voice, '_client_from_env', lambda _: Client())
    h.jobs.pop()()
    assert not h.clips
    if when == 'before': assert not h.calls

def test_old_cancel_cannot_affect_new_turn(h):
    h.post(); h.post(turnId='turn-b', generation='2'); h.cancel()
    for job in h.jobs: job()
    assert len(h.clips) == 1
    assert h.clips[0][1]['group'].endswith(':turn-b')

def test_sessions_are_isolated(h):
    assert h.post().json()['sessionId'] == 'car-a'
    assert h.post(sessionId='car-b', text='Other question').json()['sessionId'] == 'car-b'
    h.cancel()
    for job in h.jobs: job()
    assert len(h.clips) == 1 and h.clips[0][0][0] == 'car-b'

def test_payload_conflict(h):
    h.post()
    assert h.post(text='Different question').status_code == 409
    assert h.post(lang='vi').status_code == 409
    assert len(h.jobs) == 1

def test_concurrent_duplicate(h, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    def answer(*args):
        entered.set(); assert release.wait(3); return 'Answer.'
    monkeypatch.setattr(talk, 'answer', answer)
    result = []
    thread = threading.Thread(target=lambda: result.append(h.post())); thread.start()
    try:
        assert entered.wait(3)
        assert h.post().status_code == 409
    finally:
        release.set(); thread.join(3)
    assert result[0].status_code == 200
    assert len(h.jobs) == 1
    assert len(result[0].json()['conversation']['turns']) == 2

def test_multipart_order(h, monkeypatch):
    reply = 'The coolant reading is above the warning line and the engine is under load. Ease off gently and keep watching the readings. The nearest garage can be considered later, once the vehicle and the driver are both ready for that journey.'
    monkeypatch.setenv('TALK_SPOKEN_SENTENCES', '0')  # several parts need a reply read in full
    monkeypatch.setattr(talk, 'answer', lambda *a: reply)
    h.post(); h.jobs.pop()()
    assert [c[0][2] for c in h.clips] == voice._tts_parts(reply)
    assert [c[1]['part_index'] for c in h.clips] == [0, 1]
    assert all(c[1]['part_count'] == 2 for c in h.clips)

def test_safety_change_blocks_queued_audio(h, monkeypatch):
    h.post()
    monkeypatch.setattr(talk, 'situation', lambda _: {'must_stop': True})
    h.jobs.pop()()
    assert not h.clips

def test_vietnamese_controls():
    for text in ['tạm im', 'dừng nói', 'kết thúc hội thoại']:
        assert talk.control_only(text)

def test_retention_is_not_live_freshness(monkeypatch):
    import situation
    situation.clear_situations()
    situation.remember_vehicle_situation('fresh-test', {'severity': 'normal', 'diagnosis': 'Normal'}, [], None, now=100)
    assert situation.current_situation('fresh-test', now=110)['fresh'] is True
    assert situation.current_situation('fresh-test', now=161)['fresh'] is False
    monkeypatch.setattr(talk, 'current_situation', lambda _: situation.current_situation('fresh-test', now=161))
    brief = talk.situation('fresh-test')
    assert brief['stale'] is True
    assert 'fresh reading' in talk.guard_reply('The car is normal.', brief, 'en', 'How is the car?')
    situation.clear_situations()


def test_actual_clip_registry_visible_after_reply(h, monkeypatch):
    from collections import deque
    monkeypatch.setattr(voice, '_clips', deque(maxlen=50))
    monkeypatch.setattr(voice, '_register', _REAL_REGISTER)
    response = h.post()
    assert response.json()['audioQueued'] is True
    h.jobs.pop()()
    app = FastAPI(); app.include_router(voice.router, prefix='/api')
    result = TestClient(app).get('/api/voice/clips?session=car-a&lang=en&after=0')
    clip = result.json()['clips'][0]
    assert clip['group'] == 'talk:conv-a:turn-a'
    assert clip['part_index'] == 0 and clip['part_count'] == 1
    assert '_path' not in clip


def test_different_turn_same_generation_rejected(h):
    h.post()
    assert h.post(turnId='other-turn').status_code == 409


def test_saturated_executor_does_not_queue_model(monkeypatch):
    slots = threading.BoundedSemaphore(1); slots.acquire()
    monkeypatch.setattr(talk, '_model_slots', slots)
    monkeypatch.setenv('AGENT_MODE', 'openai')
    class Pool:
        def submit(self, *a): raise AssertionError('saturated pool must not submit')
    monkeypatch.setattr(talk, '_executor', Pool())
    assert talk.answer('busy-test', 'How is the car?', 'en', {'must_stop': True}).startswith('Stop')
