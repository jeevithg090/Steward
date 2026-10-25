"""Scam Shield's Gateway side (docs/scam-shield.md §5.3): the check, the hold, the log, the words.

No `from __future__ import annotations`: FastAPI reads these annotations at runtime.

| Route | Who | What |
|---|---|---|
| POST /scam/check | bearer | a message checked all the way: words, links, registers, sandbox |
| GET /scam/shield | bearer | today's counts, recent alerts (never the text), the model, the lists |
| POST /scam/feedback | bearer | "this was a scam" / "this was real" against an alert, by its id |

The same `ShieldService` answers the Mesh's `scam_text` signal (derived fields from a phone), the
SMS `CHECK` word and the voice agent's `check_message` tool, so every door gives the same verdict
from `tempo_core.scam.assess`. Nothing here stores a message: the log keeps the zone, the level,
the rule ids, the link hosts and the source.
"""

import asyncio
import secrets
from collections import defaultdict, deque
from collections.abc import Callable, Mapping
from datetime import datetime
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from tempo_adapters.scam import Registers, ThreatFeeds
from tempo_core.links import Link, find_links, from_host
from tempo_core.scam import Evidence, FirmCheck, Level, Verdict, Zone, assess
from tempo_core.scam_model import ScamModel, Score
from tempo_core.scam_voice import say
from tempo_core.signals import SignalSpec, fired_families
from tempo_gateway.events import EventBus
from tempo_ports.sandbox import LinkSandbox

log = structlog.get_logger("tempo.shield")

MAX_SANDBOX_HOSTS = 3
RECENT = 200
TEACH_WINDOW_S = 10 * 60
Source = str  # "web" | "sms" | "voice" | "phone" | "shortcut"


class ScamCheck(BaseModel):
    text: str = Field(max_length=2000)
    firm: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    website: str | None = Field(default=None, max_length=200)
    sender: str | None = Field(default=None, max_length=120)
    language: str = Field(default="en", pattern=r"^[a-z]{2}$")
    user_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{1,64}$")


class Feedback(BaseModel):
    alert_id: str = Field(pattern=r"^sa_[a-f0-9]{12}$")
    label: str = Field(pattern=r"^(scam|real)$")


class Alert(BaseModel):
    """One checked message, without the message."""

    id: str
    at: str
    user_id: str | None
    source: Source
    zone: str
    level: str
    confidence: float | None
    rules: list[str]
    link_hosts: list[str]
    checked: bool  # the sandbox looked
    label: str | None = None  # the person's correction, if any


class ShieldService:
    def __init__(
        self,
        *,
        model: ScamModel | None,
        spec: SignalSpec | None,
        registers: Registers | None,
        registers_simulated: bool,
        feeds: ThreatFeeds,
        sandbox: LinkSandbox,
        sandbox_simulated: bool,
        warnings: Mapping[str, Mapping[str, str]],
        bus: EventBus,
        clock: Callable[[], datetime],
    ) -> None:
        self.model, self.spec, self.registers = model, spec, registers
        self.registers_simulated, self.feeds = registers_simulated, feeds
        self.sandbox, self.sandbox_simulated, self.warnings = sandbox, sandbox_simulated, warnings
        self.bus, self.clock = bus, clock
        self.recent: deque[Alert] = deque(maxlen=RECENT)
        self.by_id: dict[str, Alert] = {}
        self.last_checked: dict[str, tuple[str, datetime]] = {}  # phone -> (text, when), for TEACH
        self.donations: defaultdict[str, list[dict[str, str]]] = defaultdict(list)

    # --- the one check -------------------------------------------------------------------------

    async def check(
        self,
        text: str,
        *,
        firm: str | None = None,
        phone: str | None = None,
        website: str | None = None,
        sender: str | None = None,
        language: str = "en",
        user_id: str | None = None,
        source: Source = "web",
    ) -> dict[str, Any]:
        """A whole message, checked all the way; the sandbox runs here and now when the zone asks.
        An email sender's domain is judged like a link (`alerts@hsbc-secure.co` is a look-alike)."""
        families = fired_families(self.spec, text) if self.spec is not None else []
        score = self.model.score(text, families=families) if self.model is not None else None
        links = find_links(text)
        if sender and "@" in sender:
            links += (from_host(sender.rpartition("@")[2].rstrip(">")),)
        firm_check = await self._firm(firm, phone, website)
        verdict, held = await self._settle(text, firm_check, score, links, tuple(families))
        alert = self._record(verdict, user_id=user_id, source=source, rules=families)
        return self._answer(verdict, alert, held=held, language=language, links=links, score=score)

    async def signal(
        self, fields: Mapping[str, str], *, user_id: str, source: Source = "phone"
    ) -> dict[str, Any]:
        """The phone's four derived fields (docs/scam-shield.md §5.1): no text ever arrives."""
        rules = tuple(r for r in fields.get("rules", "").split(",") if r)
        hosts = [h for h in fields.get("link_hosts", "").split(",") if h]
        links = tuple(from_host(h) for h in hosts)
        score = self._score_from_text(fields.get("score"))
        verdict, held = await self._settle("", None, score, links, rules)
        alert = self._record(verdict, user_id=user_id, source=source, rules=list(rules))
        answer = self._answer(verdict, alert, held=held, language="en", links=links, score=score)
        return {k: answer[k] for k in ("zone", "level", "say", "alert_id", "why", "confidence")}

    async def _settle(
        self,
        text: str,
        firm: FirmCheck | None,
        score: Score | None,
        links: tuple[Link, ...],
        families: tuple[str, ...],
    ) -> tuple[Verdict, bool]:
        feed_hits = tuple(self.feeds.hits(link.registrable for link in links))
        evidence = Evidence(score=score, links=links, families=families, feed_hits=feed_hits)
        verdict = assess(text, firm, evidence)
        if verdict.zone is not Zone.SANDBOX:
            return verdict, False
        self.bus.publish(
            {"type": "scam_sandbox", "hosts": list(verdict.link_hosts[:MAX_SANDBOX_HOSTS])}
        )
        reports = await asyncio.gather(
            *(self.sandbox.inspect(host) for host in verdict.link_hosts[:MAX_SANDBOX_HOSTS])
        )
        settled = assess(
            text, firm, Evidence(
                score=score, links=links, families=families, feed_hits=feed_hits,
                sandbox=tuple(reports),
            ),
        )  # fmt: skip
        return settled, True

    async def _firm(
        self, firm: str | None, phone: str | None, website: str | None
    ) -> FirmCheck | None:
        if not firm or self.registers is None:
            return None
        return await self.registers.check(firm, phone=phone, website=website)

    def _score_from_text(self, text: str | None) -> Score | None:
        if not text or self.model is None:
            return None
        try:
            p = min(max(float(text), 0.0), 1.0)
        except ValueError:
            return None
        return Score(probability=p, decision=0.0, zone=self.model.zones.of(p), top_words=())

    # --- the log, the words and the events --------------------------------------------------------

    def _record(
        self, verdict: Verdict, *, user_id: str | None, source: Source, rules: list[str]
    ) -> Alert:
        alert = Alert(
            id="sa_" + secrets.token_hex(6), at=self.clock().isoformat(), user_id=user_id,
            source=source, zone=verdict.zone.value, level=verdict.level.value,
            confidence=verdict.confidence, rules=rules, link_hosts=list(verdict.link_hosts),
            checked=verdict.checked,
        )  # fmt: skip
        self.recent.append(alert)
        self.by_id[alert.id] = alert
        if len(self.by_id) > RECENT * 2:
            for stale in list(self.by_id)[:RECENT]:
                self.by_id.pop(stale, None)
        kind = "scam_alert" if verdict.level is Level.LIKELY_SCAM else "scam_checked"
        event = {
            "type": kind, "alert_id": alert.id, "user_id": user_id or "", "zone": alert.zone,
            "level": alert.level, "rules": ",".join(rules), "source": source,
            "link_hosts": ",".join(alert.link_hosts),
        }  # fmt: skip
        self.bus.publish(event)
        log.info("scam_checked", zone=alert.zone, level=alert.level, source=source)
        return alert

    def _answer(
        self,
        verdict: Verdict,
        alert: Alert,
        *,
        held: bool,
        language: str,
        links: tuple[Link, ...],
        score: Score | None,
    ) -> dict[str, Any]:
        return {
            "alert_id": alert.id,
            "level": verdict.level.value,
            "zone": verdict.zone.value,
            "confidence": verdict.confidence,
            "reasons": list(verdict.reasons),
            "why": list(verdict.why),
            "advice": verdict.advice,
            "say": say(verdict, language=language, translations=self.warnings, held=held),
            "held": held,
            "language": language,
            "links": [
                {
                    "url": link.url,
                    "host": link.registrable,
                    "findings": list(link.findings),
                    "words": link.words(),
                }
                for link in links
            ],
            "rules": alert.rules,
            "top_words": list(score.top_words) if score else [],
            "model": {"version": self.model.version} if self.model else None,
            "simulated": self.registers_simulated or self.sandbox_simulated,
        }

    def status(self, user_id: str | None) -> dict[str, Any]:
        today = self.clock().date().isoformat()
        mine = [a for a in self.recent if user_id is None or a.user_id == user_id]
        todays = [a for a in mine if a.at.startswith(today)]
        return {
            "today": {
                "checked": len(todays),
                "held": sum(a.checked for a in todays),
                "warned": sum(a.level == Level.LIKELY_SCAM.value for a in todays),
            },
            "recent": [a.model_dump() for a in reversed(mine[-20:])],
            "model": {"version": self.model.version, "metrics": self.model.metrics}
            if self.model
            else None,
            "feeds": self.feeds.summary(),
            "simulated": {"registers": self.registers_simulated, "sandbox": self.sandbox_simulated},
        }

    def feedback(self, alert_id: str, label: str) -> Alert:
        alert = self.by_id.get(alert_id)
        if alert is None:
            raise KeyError(alert_id)
        updated = alert.model_copy(update={"label": label})
        self.by_id[alert_id] = updated
        self.recent = deque(
            (updated if a.id == alert_id else a for a in self.recent), maxlen=RECENT
        )
        self.bus.publish({"type": "scam_feedback", "alert_id": alert_id, "label": label})
        return updated

    # --- SMS: CHECK, then TEACH within ten minutes ------------------------------------------------

    def remember_checked(self, phone: str, text: str) -> None:
        self.last_checked[phone] = (text, self.clock())

    def teach(self, phone: str) -> str | None:
        """Keep the last checked text as a donated training example, if it is recent enough."""
        found = self.last_checked.pop(phone, None)
        if found is None:
            return None
        text, when = found
        if (self.clock() - when).total_seconds() > TEACH_WINDOW_S:
            return None
        self.donations[phone].append({"text": text, "at": self.clock().isoformat()})
        return text

    def forget_teaching(self, phone: str) -> int:
        return len(self.donations.pop(phone, []))


def shield_router(service: ShieldService, web_caller: Any) -> APIRouter:
    router = APIRouter(prefix="/scam")
    Caller = Annotated[str, Depends(web_caller)]

    @router.post("/check")
    async def check(body: ScamCheck, caller: Caller) -> dict[str, Any]:
        """Scam Shield: the words, the links, the registers, the lists and, when the zone asks,
        the sandbox. Never "safe"."""
        return await service.check(
            body.text, firm=body.firm, phone=body.phone, website=body.website,
            sender=body.sender, language=body.language, user_id=body.user_id, source="web",
        )  # fmt: skip

    @router.get("/shield")
    async def status(caller: Caller, user_id: str | None = None) -> dict[str, Any]:
        """The Shield panel: counts and recent alerts, never a message."""
        return service.status(user_id)

    @router.post("/feedback")
    async def feedback(body: Feedback, caller: Caller) -> dict[str, Any]:
        try:
            return service.feedback(body.alert_id, body.label).model_dump()
        except KeyError:
            raise HTTPException(404, "no such alert") from None

    return router
