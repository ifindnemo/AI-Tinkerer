"""Session handling and the policy for when the agent is asked to reword an alert.

Alerts never wait for the LLM: the rule assessment is returned at once and the agent's wording,
requested in the background, replaces the text on a later batch of the same episode. So an
escalation (warning → critical) is reported immediately even while a slow reply is pending.

Nothing here is written to disk: events live in memory per session (capped), so closing the
backend forgets them. The browser keeps its own history in local storage.
"""

import os
import threading
import time
from collections import OrderedDict, deque
from collections.abc import Callable
from datetime import datetime
from concurrent.futures import Future
from dataclasses import dataclass, field
from threading import Lock
from typing import Any

from driver.agent import submit
from driver.guardian import RESPONSE_TIMEOUT, GuardianResult, acknowledgement_valid, attention_of, combine, maintenance_context
from driver.registry import DriverRegistry, driver_registry, summary_from
from driver.rules import MICROSLEEP_HOLD, RuleResult, assess
from driver.schemas import DriverBatch, DriverNarrative
from store import utc_now

MAX_SESSIONS = 50
MAX_EVENTS = 120
AGENT_REFRESH_SECONDS = 20.0  # while an alert lasts, reword it at most this often


@dataclass
class _Session:
    events: deque = field(default_factory=lambda: deque(maxlen=MAX_EVENTS))
    agent_key: str | None = None  # episode of the latest request
    agent_episode: str | None = None
    agent_at: float = 0.0
    future: Future | None = None
    narrative: DriverNarrative | None = None
    narrative_key: str | None = None  # episode the narrative was written for
    fallback: str | None = None
    alert_since: Any = None  # event time when the current driver alert began (Guardian only)


class DriverService:
    def __init__(self, clock: Callable[[], float] = time.monotonic, registry: DriverRegistry | None = None):
        self._registry = registry or driver_registry
        self._sessions: "OrderedDict[str, _Session]" = OrderedDict()
        self._lock = Lock()
        self._clock = clock

    def session_count(self) -> int:
        return len(self._sessions)

    def _session(self, session_id: str) -> _Session:
        session = self._sessions.pop(session_id, None) or _Session()
        self._sessions[session_id] = session
        while len(self._sessions) > MAX_SESSIONS:
            _, evicted = self._sessions.popitem(last=False)
            if evicted.future:
                evicted.future.cancel()
        return session

    def process(self, batch: DriverBatch) -> dict[str, Any]:
        vehicle = batch.context.vehicle
        # With an ECU reading, "moving" is measured, not the manual demo assumption.
        moving = vehicle.speed_kmh >= 5 if vehicle else batch.context.vehicle_moving
        timeout = float(os.getenv("DRIVER_AGENT_TIMEOUT_SECONDS", "8"))
        with self._lock:
            session = self._session(batch.session_id)
            known = {event.captured_at: event for event in session.events}
            for event in batch.events:
                known.setdefault(event.captured_at, event)
            events = sorted(known.values(), key=lambda event: event.captured_at)
            session.events = deque(events, maxlen=MAX_EVENTS)
            rule = assess(list(session.events), moving)
            # Wording for an ongoing closure must not be reused after reopening or parking.
            latest = session.events[-1]
            guardian = self._guardian(session, batch, rule, moving) if vehicle else None
            episode = guardian.episode_key if guardian else rule.episode_key
            severity = guardian.decision.severity if guardian else rule.severity
            context_key = f"{episode}:{moving}:{latest.state}:{latest.eyes.closed}:{latest.head.direction}"
            if session.agent_key != context_key:
                if session.future:
                    session.future.cancel()
                session.future = session.narrative = session.narrative_key = session.fallback = None
            self._collect(session, timeout)
            if severity == "normal":
                session.agent_key = session.agent_episode = session.future = session.narrative = session.narrative_key = session.fallback = None
            elif self._should_ask(session, episode):
                future = submit(rule, list(session.events), moving, guardian) if guardian else submit(rule, list(session.events), moving)
                session.agent_key, session.agent_at, session.future = context_key, self._clock(), future
                session.agent_episode = episode
                session.fallback = None if future else "rules_mode"
            usable = session.narrative if session.narrative_key == context_key else None
            reason = None if usable else ("pending" if session.future else session.fallback)
        reply = {
            "accepted": len(batch.events),
            "sessionId": batch.session_id,
            "state": rule.state,
            "assessment": self._assessment(rule, usable, reason, guardian),
            "privacy": {"rawVideoReceived": False},
        }
        if guardian:
            reply["guardian"] = guardian.block
        if batch.context.vehicle_id:
            self._registry.update(batch.context.vehicle_id, self._summary(batch, rule, guardian, list(events)))
        if severity in ("warning", "critical"):
            # The garage page plays clips by vehicle id; the camera page by its own session.
            voice_session = batch.context.vehicle_id or batch.session_id
            self._speak(reply["assessment"], session.future, severity, f"driver:{voice_session}:{episode}:{severity}", voice_session, timeout)
        return reply

    @staticmethod
    def _speak(assessment: dict[str, Any], future: Future | None, severity: str, key: str, voice_session: str, timeout: float) -> None:
        """Speak the alert once per episode, in the agent's words when they arrive in time.

        With wording already there (or no LLM) it is spoken now. Otherwise the reply of the pending
        LLM call is spoken, and the rule text after `timeout` if the LLM is slower; the shared
        dedupe key lets only the first of the two through."""
        from voice import announce_alert

        text, steps = assessment["summary"], assessment["recommendations"]

        def say(words: str, worded_by_agent: bool = False) -> None:
            # The agent's sentence already ends with the step; the rule text gets the first step appended.
            announce_alert(words, severity=severity, recommendations=None if worded_by_agent else steps,
                           dedupe_key=key, session_id=voice_session)

        if assessment["engine"] == "agent" or future is None:
            say(text, assessment["engine"] == "agent")
            return

        def done(finished: Future) -> None:
            try:
                narrative, _ = finished.result()
            except BaseException:
                narrative = None
            say(narrative.summary if narrative else text, narrative is not None)

        future.add_done_callback(done)
        fallback = threading.Timer(timeout, say, (text,))
        fallback.daemon = True
        fallback.start()

    @staticmethod
    def _summary(batch: DriverBatch, rule: RuleResult, guardian: GuardianResult | None, events: list) -> dict[str, Any]:
        """What the vehicle agent may know about the driver: a few structured values."""
        latest = events[-1]
        if guardian:
            driver = guardian.block["driver"]
            return summary_from(
                source=batch.source, attention=driver["attention"], state=driver["state"], severity=driver["severity"],
                closed_ms=driver["closedMs"], confidence=rule.confidence, responded=driver["responded"],
                unanswered=driver["unanswered"], action=guardian.decision.action, must_stop=guardian.decision.must_stop,
                observed_at=latest.captured_at,
            )
        reliable = [e for e in events if e.face_present and e.confidence >= 0.5 and (latest.captured_at - e.captured_at).total_seconds() <= 60]
        return summary_from(
            source=batch.source, attention=attention_of(rule.state), state=rule.state, severity=rule.severity,
            closed_ms=max((e.eyes.closed_ms for e in reliable), default=0), confidence=rule.confidence,
            responded=False, unanswered=False, action=None, must_stop=False, observed_at=latest.captured_at,
        )

    @staticmethod
    def _alert_lapsed(events: list, since: datetime, moving: bool) -> bool:
        """Whether the alert that began at `since` ended before the newest event: the rules went back
        to normal at some event in between, or the events stop for longer than any alert is held.
        The garage camera posts only when an alert rises, so the backend may see no request at all
        while the driver is attentive; a new closure then starts a new episode."""
        start = next((i for i, event in enumerate(events) if event.captured_at >= since), None)
        if start is None:
            return False
        for i in range(start + 1, len(events)):
            if events[i].captured_at - events[i - 1].captured_at > MICROSLEEP_HOLD:
                return True
            if i < len(events) - 1 and assess(events[: i + 1], moving).severity == "normal":
                return True
        return False

    @staticmethod
    def _guardian(session: _Session, batch: DriverBatch, rule: RuleResult, moving: bool = True) -> GuardianResult:
        events = list(session.events)
        latest = events[-1]
        responded = acknowledgement_valid(events, batch.context.acknowledged_at)
        if session.alert_since is not None and DriverService._alert_lapsed(events, session.alert_since, moving):
            session.alert_since = None
        if rule.severity != "normal" and rule.state in ("drowsy", "distracted"):
            if session.alert_since is None:
                starts = [e.captured_at for e in batch.events if e.state in ("drowsy", "distracted") and e.face_present and e.confidence >= 0.5]
                session.alert_since = min(starts, default=latest.captured_at)
        else:
            session.alert_since = None
        unanswered = (
            not responded
            and session.alert_since is not None
            and latest.captured_at - session.alert_since >= RESPONSE_TIMEOUT
        )
        return combine(
            rule, events, batch.context.vehicle,
            responded=responded, unanswered=unanswered, alert_since=session.alert_since,
            maintenance=maintenance_context(),
        )

    def _collect(self, session: _Session, timeout: float) -> None:
        """Takes a finished reply, or gives up on one that took too long."""
        future = session.future
        if future is None:
            return
        if future.done():
            try:
                narrative, reason = future.result()
            except Exception:
                narrative, reason = None, "error"
            session.future = None
            if narrative is not None:
                session.narrative, session.narrative_key, session.fallback = narrative, session.agent_key, None
            else:
                session.fallback = reason
        elif self._clock() - session.agent_at >= timeout:
            future.cancel()
            session.future = None  # a late reply is ignored
            session.fallback = "timeout"

    def _should_ask(self, session: _Session, episode_key: str) -> bool:
        if session.future is not None:
            return False  # one request at a time per session
        if episode_key != session.agent_episode:
            return True
        # Reopening eyes or changing head direction invalidates wording, but must not
        # start an LLM call on every blink. Rules cover the remaining refresh interval.
        return self._clock() - session.agent_at >= AGENT_REFRESH_SECONDS

    @staticmethod
    def _assessment(rule: RuleResult, narrative: DriverNarrative | None, reason: str | None,
                    guardian: GuardianResult | None = None) -> dict[str, Any]:
        if guardian:
            severity = guardian.decision.severity
            return {
                "severity": severity,  # from the Guardian policy; the agent only explains
                "summary": narrative.summary if narrative else guardian.summary,
                "evidence": guardian.evidence,
                "recommendations": guardian.recommendations,
                "confidence": rule.confidence,
                "engine": "agent" if narrative else "rules",
                "fallbackReason": None if narrative or severity == "normal" else reason,
                "state": rule.state,
                "at": utc_now(),
            }
        return {
            "severity": rule.severity,  # always from the rules; the agent only rewords
            "summary": narrative.summary if narrative else rule.summary,
            "evidence": rule.evidence,
            # The model explains; safety instructions remain deterministic.
            "recommendations": rule.recommendations,
            "confidence": rule.confidence,
            "engine": "agent" if narrative else "rules",
            "fallbackReason": None if narrative or rule.severity == "normal" else reason,
            "state": rule.state,
            "at": utc_now(),
        }


driver_service = DriverService()
