"""POST /chat: the web app's front door (plan.md §4.1), behind the Mission Control bearer.

No `from __future__ import annotations`: FastAPI reads these annotations at runtime.

| Route | What |
|---|---|
| POST /chat | one typed or spoken sentence in; the intent, a plain reply and whatever it did out |

The router is code, not a model: `tempo_core.intent` classifies the sentence and pulls the facts
out; this module calls the same `MissionService`, `ShieldService` and `Memory` the SMS and voice
doors call, so the web says what the phone says. A model may phrase small talk only, and only when
a chat key is configured outside replay mode, under word rules that forbid amounts, promises and
actions. The server is stateless about conversations: the client echoes the merged `slots` back.

The text is never logged and never published on the bus; the `chat_turn` event carries the intent
and the user id only.

Three rules keep the chat from doing less carefully what another door does carefully (plan.md
§12.2): a profile that lacks a skill's needs is refused before anything starts, as `/missions`
refuses it; a person with a passkey answers on their device, never with a typed yes; and a
mission that fails safe is explained in plain words, never with an engine's raw message.
"""

import re
from collections.abc import Awaitable, Callable, Sequence
from datetime import date
from decimal import Decimal
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from tempo_adapters.settings import Settings
from tempo_core.delays import LONDON
from tempo_core.intent import (
    RAIL_FIELDS,
    VISIT_FIELDS,
    Intent,
    Slots,
    classify,
    extract,
    merge,
    missing,
    station_name,
)
from tempo_core.ledger import summarise
from tempo_core.models import MissionState
from tempo_core.profiles import ProfileCatalog
from tempo_core.readability import flesch_reading_ease
from tempo_gateway.engines import OFCOM, RAIL
from tempo_gateway.events import EventBus
from tempo_gateway.memory import Memory
from tempo_gateway.mesh import Mesh
from tempo_gateway.missions import (
    BINDING_SCOPES,
    ConsentAsk,
    MissionService,
    MissionView,
    StartMission,
    StartOfcom,
    UnknownRequest,
    profile_refusal,
)
from tempo_gateway.shield import ShieldService
from tempo_memory.service import say_recalled
from tempo_missions.clawback_rail import SignedApproval

log = structlog.get_logger("tempo.chat")

MAX_TEXT = 2000
PLAIN = 60  # Flesch reading ease: what Tempo says must score at least this
MAX_SMALL_TALK = 240
MAX_SUGGESTION = 120  # a chip the person taps; ChatReply.suggestions (plan.md §12.2)

LlmSay = Callable[[str], Awaitable[str | None]]

# Every fixed sentence the chat can say, in one place so a test can read each one for plainness.
CANNED: dict[str, str] = {
    "nothing_waiting": "Nothing is waiting for your answer.",
    "stopped": "Stopped. Nothing more will be sent.",
    "nothing_running": "Nothing was running, so nothing was sent.",
    "shield_off": "I can't check messages right now.",
    "memory_off": "I can't look up what I remember right now.",
    "forget_what": "What should I forget? Say it in a few words.",
    "forget_missing": "I couldn't find that in what I remember.",
    "ledger_empty": "Nothing yet. When a claim is paid, it shows here.",
    "entitlement": (
        "I can check what you might be owed. Answer ten quick questions and I'll show what is "
        "worth claiming, with the official page for each."
    ),
    "profiles_none": "No profiles are installed yet.",
    "profiles_pick": "Pick one on the Profiles page, and I'll work that way for you.",
    "letter": "Show me the letter: tap the camera button and I'll read it to you.",
    "help": (
        "I'm Tempo. I win back money and time you're owed. Tell me about a late train and I'll "
        "claim for you. Tell me about an engineer who never came. Paste a text you're not sure "
        "of and I'll check it. Show me a letter and I'll read it. Ask what I remember, or say "
        "forget. Ask how much I've got back. Say stop at any time."
    ),
    "smalltalk": (
        "I'm Tempo. I win back money and time you're owed. Tell me about a late train, a missed "
        "engineer visit, or a text you're unsure of."
    ),
    "late_train": "Sorry about the train.",
    "missed_visit": "Sorry they didn't come.",
    "started": "I've started on it.",
    "passkey": "Please confirm with Face ID or your fingerprint on this device.",
    # Replay mode's recorded journeys: fixtures/rail/replay/ (OXF to PAD, 22 and 23 October).
    "demo_journeys": "This demo only has trains from 22 and 23 October.",
    "stopped_safe": "I had to stop here. Mission Control shows what happened.",
    # The same journey or visit again: Tempo never claims twice (plan.md §12.2).
    "already_asking": "I'm already on this one. It needs your OK.",
    "already_waiting": "I'm already on this one. I'm waiting for the money.",
    "already_claimed": "I already claimed this one.",
    "already_handled": "I've already dealt with this one.",
}
# A journey the rail records don't have, read back from the person's own facts (never the
# engine's message, which may quote a lookup key).
NOT_FOUND = (
    "I couldn't find the {departure} from {origin} to {destination} on {day} in the rail records."
)

# Things the person could say next, shown as chips that send the text (ChatReply.suggestions).
# Each is at most MAX_SUGGESTION characters and reads plainly, except the scam text, which is a
# pasted message quoted as it arrived (tests/unit/test_chat_plain.py exempts it by name).
LATE_TRAIN = (
    "My 08:12 train from Oxford to Paddington was 38 minutes late on 23 October. It cost £28.40."
)
MISSED_VISIT = "The Broadbandly engineer did not come on 19 October. No one rang."
SCAM_SAMPLE = (
    "Is this a scam? HMRC: You are due a tax refund of 248.20 GBP. Claim within 24 hours at "
    "http://hmrc-refunds-gov.uk/claim"
)
QUOTED = frozenset({SCAM_SAMPLE})
SUGGESTIONS: dict[str, tuple[str, ...]] = {
    "doors": (LATE_TRAIN, MISSED_VISIT, SCAM_SAMPLE, "Am I owed anything?"),  # help, small talk
    "demo_journey": (LATE_TRAIN,),  # a journey replay mode has no recording of
    "demo_fare": ("£28.40",),  # the fare question, for the recorded demo journey only
    "profiles": ("Show me my profiles",),  # after a profile refusal
    "paid": ("How much have you got back for me?", "What do you remember about me?"),
    "already_paid": ("How much have you got back for me?",),  # the same claim, already paid
    "ledger": ("What do you remember about me?", "Am I owed anything?"),
}
# The recorded demo journey (fixtures/rail/replay/): its fare is the one chip offered for "£?".
DEMO_JOURNEY = {
    "origin_crs": "OXF", "destination_crs": "PAD", "travel_date": "2026-10-23",
    "departure": "08:12",
}  # fmt: skip
_TRAIN_NOT_FOUND = "I couldn't find that train"  # how the rail workflow's Intake step declines
_ENDED = (MissionState.DECLINED, MissionState.FAILED_SAFE)
# What a Python repr looks like inside a sentence: a reply must never carry one.
_REPR = re.compile(r"datetime\.|Decimal\(|\(\s*'|\[\s*'|\{\s*'|\b[A-Za-z_]\w*\(\w+=")
_PARENS = re.compile(r"\s*\([^()]*\)")

# What the model is told when it may phrase small talk. It never sees a number to repeat.
SMALL_TALK_PROMPT = (
    "You are Tempo, a UK helper that wins back money and time people are owed. Reply to the "
    "person's remark with one short, warm sentence in plain English. Never mention amounts, "
    "dates, times or numbers. Never promise or describe an action: no claiming, paying, sending, "
    "calling or checking. Never give advice about money. If asked what you can do, say they can "
    "tell you about a late train, a missed engineer visit, or a text they are unsure of."
)
_UNSAFE_SMALL_TALK = re.compile(
    r"\d|£|\$|€|https?://|www\.|\b(?:will|i'll|i will|we will|we'll|going to|gonna)\s+"
    r"(?:claim|pay|send|file|call|ring|transfer|refund|check|cancel)\b",
    re.IGNORECASE,
)
_BARE_NUMBER = re.compile(
    r"^£?\s*(\d{1,4}(?:\.\d{1,2})?)\s*(?:pounds?|quid|gbp)?\.?$", re.IGNORECASE
)
_CHECK_PREFIX = re.compile(r"^\s*check\s*[:\-]?\s+", re.IGNORECASE)


class Need(BaseModel):
    field: str
    question: str


class Action(BaseModel):
    label: str
    href: str


class ChatTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    display_name: str = Field(default="Friend", min_length=1, max_length=80)
    text: str = Field(max_length=MAX_TEXT)
    profile_id: str | None = Field(default=None, pattern=r"^[a-z0-9-]{2,40}$")
    language: str = Field(default="en", pattern=r"^[a-z]{2}$")
    slots: dict[str, str | None] = {}  # what the client already knows from earlier turns


class ChatReply(BaseModel):
    intent: Intent
    reply: str
    say: str  # the same or shorter, for the voice
    slots: dict[str, str | None]
    needs: list[Need] | None = None
    mission: MissionView | None = None
    ask: ConsentAsk | None = None
    verdict: dict[str, Any] | None = None
    memories: list[dict[str, Any]] | None = None
    ledger: dict[str, str] | None = None
    flags: list[dict[str, Any]] | None = None
    actions: list[Action] | None = None
    suggestions: list[str] | None = None  # things to say next, as chips (plan.md §12.2)
    simulated: list[str] = []


MISSIONS = Action(label="Open Mission Control", href="#/missions")
SHOW_PROFILES = Action(label="Show my profiles", href="#/profiles")


def suggest(key: str) -> list[str]:
    return list(SUGGESTIONS[key])


def readable(message: str) -> str:
    """An engine's message, fit for the chat: one that quotes a Python repr loses its brackets,
    and if a repr is still there, the person gets a plain fallback instead."""
    if not _REPR.search(message):
        return message
    stripped = message
    for _ in range(4):  # brackets inside brackets come off from the inside out
        stripped = _PARENS.sub("", stripped)
    return stripped if not _REPR.search(stripped) else CANNED["stopped_safe"]


def mission_action(view: MissionView) -> Action:
    return Action(label="Open Mission Control", href=f"#/missions/{view.id}")


def small_talk_ok(sentence: str | None) -> str | None:
    """The one thing a model may say, and only when it passes the word rules: no digits, no
    money, no promise of an action, short, and plain."""
    if not sentence:
        return None
    said = " ".join(sentence.split()).strip().strip('"')
    if not said or len(said) > MAX_SMALL_TALK or _UNSAFE_SMALL_TALK.search(said):
        return None
    return said if flesch_reading_ease(said) >= PLAIN else None


def simulated_in(settings: Settings) -> list[str]:
    """The honesty badge's list, the same one `/health` shows."""
    return ["company"] + (
        ["rail data", "jurors", "vision"] if settings.tempo_mode == "replay" else []
    )


class Chat:
    """One turn of the chat, door by door. Every reply is plain; every action is code's."""

    def __init__(
        self,
        service: MissionService,
        *,
        shield: ShieldService | None,
        memory: Memory | None,
        profiles: ProfileCatalog | None,
        bus: EventBus,
        llm_say: LlmSay | None,
        today: Callable[[], date],
        simulated: Sequence[str],
        mesh: Mesh | None = None,
        replay: bool = False,
    ) -> None:
        self.service, self.shield, self.memory, self.profiles = service, shield, memory, profiles
        self.bus, self.llm_say, self.today = bus, llm_say, today
        self.simulated = list(simulated)
        self.mesh = mesh  # a person with a passkey answers on their device, not with a typed yes
        self.replay = replay  # replay mode: the rail records are the recorded demo journeys

    async def turn(self, body: ChatTurn, caller: str) -> ChatReply:
        missions = [
            m for m in self.service.mission_ids if await self.service.user_for(m) == body.user_id
        ]
        pending = [(m, rid) for m in missions if (rid := self.service.pending_for(m))]
        known = Slots(**{k: v for k, v in body.slots.items() if k in Slots.model_fields})
        intent = classify(body.text, pending_question=bool(pending))
        if intent is Intent.SMALLTALK:
            intent = self._continued(known, body.text) or intent
        reply = await self._answer(intent, body, caller, known, missions, pending)
        self.bus.publish({"type": "chat_turn", "intent": intent.value, "user_id": body.user_id})
        log.info("chat_turn", intent=intent.value, needs=len(reply.needs or []))
        return reply.model_copy(update={"simulated": self.simulated})

    def _continued(self, known: Slots, text: str) -> Intent | None:
        """An answer to the one question has no door words of its own: "28.40", "19 October".
        The slots the client echoed back say which flow it continues."""
        if any(getattr(known, f) for f in RAIL_FIELDS):
            found = extract(text, today=self.today(), intent=Intent.RAIL_DELAY)
            if any(found.model_dump().values()) or _BARE_NUMBER.match(text.strip()):
                return Intent.RAIL_DELAY
        if any(getattr(known, f) for f in VISIT_FIELDS):
            found = extract(text, today=self.today(), intent=Intent.MISSED_VISIT)
            if any(found.model_dump().values()):
                return Intent.MISSED_VISIT
        return None

    async def _answer(
        self,
        intent: Intent,
        body: ChatTurn,
        caller: str,
        known: Slots,
        missions: list[str],
        pending: list[tuple[str, str]],
    ) -> ChatReply:
        def plain(text: str, **extra: Any) -> ChatReply:
            return ChatReply(
                intent=intent, reply=text, say=extra.pop("say", text),
                slots=extra.pop("slots", known.model_dump()), **extra,
            )  # fmt: skip

        match intent:
            case Intent.RAIL_DELAY | Intent.MISSED_VISIT:
                return await self._claim(intent, body, known)
            case Intent.APPROVE | Intent.DECLINE:
                if not pending:
                    return plain(CANNED["nothing_waiting"])
                mission_id, request_id = pending[-1]
                if self.mesh is not None and self.mesh.has_passkey(body.user_id):
                    # The same rule as /approvals: once there's a passkey, a bearer can't answer.
                    # Nothing is answered; the web signs this ask on the device.
                    view = await self.service.view(mission_id)
                    return plain(
                        CANNED["passkey"], mission=view,
                        ask=self.service.ask_for(request_id) or view.ask,
                        actions=[mission_action(view)],
                    )  # fmt: skip
                approval = SignedApproval(
                    approved=intent is Intent.APPROVE, scopes=BINDING_SCOPES, device_sig=caller
                )
                try:
                    view = await self.service.answer(request_id, approval)
                except UnknownRequest:
                    return plain(CANNED["nothing_waiting"])
                return plain(
                    readable(view.message or CANNED["started"]), mission=view, ask=view.ask,
                    actions=[mission_action(view)],
                    suggestions=suggest("paid") if view.state is MissionState.VERIFIED else None,
                )  # fmt: skip
            case Intent.STOP:
                if not missions:
                    return plain(CANNED["nothing_running"])
                view = None
                for mission_id in missions:
                    view = await self.service.stop(mission_id, device_sig=caller)
                return plain(CANNED["stopped"], mission=view, actions=[MISSIONS])
            case Intent.SCAM_CHECK:
                if self.shield is None:
                    return plain(CANNED["shield_off"])
                message = _CHECK_PREFIX.sub("", body.text, count=1) or body.text
                verdict = await self.shield.check(
                    message, language=body.language, user_id=body.user_id, source="web"
                )
                said = str(verdict["say"])
                return plain(
                    said,
                    verdict=verdict,
                    actions=[Action(label="Open Scam Shield", href="#/shield")],
                )
            case Intent.MEMORY_RECALL:
                if self.memory is None:
                    return plain(CANNED["memory_off"])
                recalled = await self.memory.recall(body.user_id)
                return plain(
                    say_recalled(recalled),
                    memories=[r.model_dump(mode="json") for r in recalled],
                    actions=[Action(label="Open the Memory Card", href="#/memory")],
                )
            case Intent.MEMORY_FORGET:
                if self.memory is None:
                    return plain(CANNED["memory_off"])
                target = extract(body.text, today=self.today(), intent=intent).forget_target
                if not target:
                    return plain(CANNED["forget_what"])
                forgotten = await self.memory.forget(body.user_id, target)
                if forgotten is None:
                    return plain(CANNED["forget_missing"])
                return plain(
                    f"Done. I've forgotten: {forgotten.text}. It's gone from all your devices.",
                    actions=[Action(label="Open the Memory Card", href="#/memory")],
                )
            case Intent.LEDGER:
                totals = summarise(await self.service.deps.repo.ledger_entries())
                ledger = {
                    "minutes_returned": str(totals.minutes_returned),
                    "hours_returned": str(totals.hours_returned),
                    "gbp_recovered": str(totals.gbp_recovered.quantize(Decimal("0.01"))),
                }
                return plain(
                    _ledger_sentence(ledger), ledger=ledger, actions=[MISSIONS],
                    suggestions=suggest("ledger"),
                )  # fmt: skip
            case Intent.ENTITLEMENT:
                return plain(
                    CANNED["entitlement"],
                    actions=[Action(label="Answer ten questions", href="#/owed")],
                )
            case Intent.PROFILES:
                names = [p.name for p in self.profiles.public()] if self.profiles else []
                said = (
                    f"Tempo can work as: {', '.join(names)}. {CANNED['profiles_pick']}"
                    if names
                    else CANNED["profiles_none"]
                )
                return plain(said, actions=[Action(label="Open Profiles", href="#/profiles")])
            case Intent.LETTER:
                return plain(
                    CANNED["letter"], actions=[Action(label="Read a letter", href="#/read")]
                )
            case Intent.HELP:
                return plain(CANNED["help"], actions=[MISSIONS], suggestions=suggest("doors"))
            case _:
                return plain(await self._small_talk(body.text), suggestions=suggest("doors"))

    async def _claim(self, intent: Intent, body: ChatTurn, known: Slots) -> ChatReply:
        """A late train or a missed visit: start it when every fact is in, else ask one question.
        A profile that can't run this skill is refused first, so no question is wasted on it."""
        found = extract(body.text, today=self.today(), intent=intent)
        slots = merge(known, _aimed(known, found, body.text, intent))
        self._profile_known(body.profile_id)
        refused = profile_refusal(
            self.profiles, body.profile_id, RAIL if intent is Intent.RAIL_DELAY else OFCOM
        )
        if refused is not None:  # nothing starts; the facts stay, for another profile to use
            return ChatReply(
                intent=intent, reply=refused, say=refused, slots=slots.model_dump(),
                actions=[SHOW_PROFILES], suggestions=suggest("profiles"),
            )  # fmt: skip
        needs = missing(intent, slots)
        if needs:
            field, question = needs[0]
            said = f"{_understood(intent, slots)} {question}"
            demo_fare = (
                self.replay and field == "fare_gbp"
                and all(getattr(slots, k) == v for k, v in DEMO_JOURNEY.items())
            )  # fmt: skip
            return ChatReply(
                intent=intent, reply=said, say=said, slots=slots.model_dump(),
                needs=[Need(field=field, question=question)],
                suggestions=suggest("demo_fare") if demo_fare else None,
            )  # fmt: skip
        request: StartMission | StartOfcom
        if intent is Intent.RAIL_DELAY:
            request = StartMission(
                user_id=body.user_id, display_name=body.display_name,
                origin_crs=slots.origin_crs or "", destination_crs=slots.destination_crs or "",
                travel_date=slots.travel_date or "", departure=slots.departure or "",
                fare_gbp=Decimal(slots.fare_gbp or "0"), profile_id=body.profile_id,
            )  # fmt: skip
        else:
            request = StartOfcom(
                user_id=body.user_id, display_name=body.display_name,
                operator=slots.operator or "", event_date=slots.event_date or "",
                notice_hours=Decimal(slots.notice_hours) if slots.notice_hours else None,
                account_ref=slots.account_ref, profile_id=body.profile_id,
            )  # fmt: skip
        existing = await self.service.duplicate_of(request)
        if existing is not None:  # never the same claim twice: say where the first one is
            return self._already(intent, existing)
        if isinstance(request, StartMission):
            view = await self.service.start(request)
        else:
            view = await self.service.start_ofcom(request)
        if (
            intent is Intent.RAIL_DELAY and view.state in _ENDED
            and (view.message or "").startswith(_TRAIN_NOT_FOUND)
        ):  # fmt: skip
            return self._not_found(intent, slots, view)
        said = view.ask.summary if view.ask else readable(view.message or CANNED["started"])
        return ChatReply(
            intent=intent, reply=said, say=said, slots={}, mission=view, ask=view.ask,
            actions=[mission_action(view)],
            suggestions=suggest("paid") if view.state is MissionState.VERIFIED else None,
        )  # fmt: skip

    def _already(self, intent: Intent, view: MissionView) -> ChatReply:
        """The same journey or visit is already a live mission: return it, never a second one."""
        suggestions = None
        if view.state is MissionState.AWAITING_CONSENT:
            said = CANNED["already_asking"]
        elif view.state is MissionState.VERIFIED:
            said = f"{CANNED['already_claimed']} {readable(view.message or '')}".strip()
            suggestions = suggest("already_paid")
        elif view.state is MissionState.COMPLETED:  # nothing more is coming; say what happened
            said = f"{CANNED['already_handled']} {readable(view.message or '')}".strip()
        else:
            said = CANNED["already_waiting"]
        return ChatReply(
            intent=intent, reply=said, say=said, slots={}, mission=view, ask=view.ask,
            actions=[mission_action(view)], suggestions=suggestions,
        )  # fmt: skip

    def _not_found(self, intent: Intent, slots: Slots, view: MissionView) -> ChatReply:
        """The rail records have no such journey: say which one, from the person's own facts.
        The slots stay, so "it was on 23 October" next turn fixes the date and starts again."""
        said = NOT_FOUND.format(
            departure=slots.departure, origin=station_name(slots.origin_crs or ""),
            destination=station_name(slots.destination_crs or ""),
            day=_spoken_date(slots.travel_date or ""),
        )  # fmt: skip
        if self.replay:
            said = f"{said} {CANNED['demo_journeys']}"
        return ChatReply(
            intent=intent, reply=said, say=said, slots=slots.model_dump(), mission=view,
            actions=[mission_action(view)],
            suggestions=suggest("demo_journey") if self.replay else None,
        )  # fmt: skip

    def _profile_known(self, profile_id: str | None) -> None:
        """The same refusal `/missions` makes: an unknown Tempo Profile stops the start."""
        if profile_id is not None and (
            self.profiles is None or self.profiles.get(profile_id) is None
        ):
            raise HTTPException(422, f"no profile called {profile_id!r} is installed")

    async def _small_talk(self, text: str) -> str:
        if self.llm_say is None:
            return CANNED["smalltalk"]
        try:
            said = small_talk_ok(await self.llm_say(text))
        except Exception as exc:  # a model that fails must never fail the chat
            log.warning("small_talk_failed", error_code=type(exc).__name__)
            said = None
        return said or CANNED["smalltalk"]


def _aimed(known: Slots, found: Slots, text: str, intent: Intent) -> Slots:
    """An answer to the one question fills the slot that was asked: a lone station after the
    origin is known is the destination; a bare number when the fare is missing is the fare."""
    if intent is not Intent.RAIL_DELAY:
        return found
    updates: dict[str, str | None] = {}
    if (
        found.origin_crs and not found.destination_crs
        and known.origin_crs and not known.destination_crs
    ):  # fmt: skip
        updates = {"origin_crs": None, "destination_crs": found.origin_crs}
    if found.fare_gbp is None and known.fare_gbp is None:
        bare = _BARE_NUMBER.match(text.strip())
        if bare:
            updates["fare_gbp"] = str(Decimal(bare.group(1)).quantize(Decimal("0.01")))
    return found.model_copy(update=updates) if updates else found


def _understood(intent: Intent, slots: Slots) -> str:
    """What Tempo has so far, read back before the one question, so a slip is caught early."""
    if intent is Intent.MISSED_VISIT:
        if slots.operator and slots.event_date:
            return f"The {slots.operator} visit on {_spoken_date(slots.event_date)}."
        if slots.operator:
            return f"The {slots.operator} visit."
        if slots.event_date:
            return f"The visit on {_spoken_date(slots.event_date)}."
        return CANNED["missed_visit"]
    parts = [f"Your {slots.departure}" if slots.departure else "Your train"]
    if slots.origin_crs:
        parts.append(f"from {station_name(slots.origin_crs)}")
    if slots.destination_crs:
        parts.append(f"to {station_name(slots.destination_crs)}")
    if slots.travel_date:
        parts.append(f"on {_spoken_date(slots.travel_date)}")
    if len(parts) == 1 and not slots.departure:
        return CANNED["late_train"]
    return " ".join(parts) + "."


def _spoken_date(iso: str) -> str:
    try:
        return date.fromisoformat(iso).strftime("%-d %B")
    except ValueError:
        return iso


def _ledger_sentence(ledger: dict[str, str]) -> str:
    gbp = Decimal(ledger["gbp_recovered"])
    minutes = Decimal(ledger["minutes_returned"])
    if not gbp and not minutes:
        return CANNED["ledger_empty"]
    shown = int(minutes) if minutes == minutes.to_integral_value() else minutes
    return f"So far Tempo has got back £{gbp} and {shown} minutes of your time."


def chat_router(
    service: MissionService,
    web_caller: Any,
    *,
    shield: ShieldService | None,
    memory: Memory | None,
    profiles: ProfileCatalog | None,
    settings: Settings,
    bus: EventBus,
    llm_say: LlmSay | None = None,
    today: Callable[[], date] | None = None,
    simulated: Sequence[str] | None = None,
    mesh: Mesh | None = None,
) -> APIRouter:
    """`today` defaults to the service clock's London date, so the demo clock moves "yesterday"
    too; `simulated` defaults to what `/health` shows for these settings. With `mesh`, a person
    who has a passkey confirms on their device: a typed yes is not an answer."""
    router = APIRouter()
    Caller = Annotated[str, Depends(web_caller)]
    chat = Chat(
        service, shield=shield, memory=memory, profiles=profiles, bus=bus, llm_say=llm_say,
        today=today or (lambda: service.deps.clock().astimezone(LONDON).date()),
        simulated=simulated if simulated is not None else simulated_in(settings),
        mesh=mesh, replay=settings.tempo_mode == "replay",
    )  # fmt: skip

    @router.post("/chat")
    async def turn(body: ChatTurn, caller: Caller) -> ChatReply:
        """One sentence in. Code picks the door and does the work; the reply is plain words."""
        return await chat.turn(body, caller)

    return router
