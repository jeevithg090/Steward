"""The Patience Profile: how to speak with this caller, from what they told Tempo themselves.

A person says it once: "I stammer, give me time", "speak to me in Hindi, slowly", "I'm hard of
hearing, text me the question". The Memory Gate reads it back and keeps it only on a yes (the
`access` category: opt-in, never expires, forgettable). When they ring, the Gateway turns those
memories into a VoiceProfile, and the profile into the answer ElevenLabs' conversation-initiation
webhook expects, so the call starts the way they asked before the first word.

Pure: no I/O and no model. The same memories always give the same call, and forgetting a memory
changes the very next call, because nothing is cached.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# Languages the inbound agent has presets for (voice/agents/tempo.inbound.yaml, `languages`).
LANGUAGES: dict[str, str] = {
    "english": "en", "hindi": "hi", "punjabi": "pa", "polish": "pl", "urdu": "ur", "welsh": "cy",
}  # fmt: skip
LANGUAGE_NAMES: dict[str, str] = {code: name.title() for name, code in LANGUAGES.items()}

DEFAULT_SPEED = Decimal("1.0")
SLOWER = Decimal("0.85")  # "speak slowly"
HEARING_SPEED = Decimal("0.9")  # slower and lower, which is what hearing loss needs, not louder
SPEED_MIN, SPEED_MAX = Decimal("0.7"), Decimal("1.2")  # ElevenLabs' tts.speed range
HEARING_STABILITY = 0.65  # steadier delivery, fewer dramatic swings in pitch
MAX_KEYWORDS = 50  # ElevenLabs' limit on asr.keywords per conversation
ALWAYS_KEYWORDS = ("Tempo", "Delay Repay")

# Matched on the memory text, case-insensitively, so a person's own correction ("please talk
# slower") still works, not only the extractor's wording.
_STAMMER = re.compile(r"stammer|stutter")
_TIME = re.compile(r"more time|time to answer|rush")
_SLOWER = re.compile(r"slow")
_HEARING = re.compile(r"\bdeaf\b|hard of hearing|can'?t hear")
_LOW_VOICE = re.compile(r"(lower|deeper)(-pitched)? voice|high(-pitched)? voices")
_TEXT = re.compile(r"\btext\b|\bmessage\b|\bread\b")
_SPEAKS = re.compile(r"\bspeaks? ([a-z]+)")
_COMMUTE = re.compile(r"^commutes (.+?) to (.+)$", re.IGNORECASE)
_CONTACT = re.compile(r"^(.+?) is their \w+$", re.IGNORECASE)


class VoiceProfile(BaseModel):
    """How Tempo's voice agent should speak with one caller. The defaults are everyone's call."""

    model_config = ConfigDict(frozen=True)

    language: str = "en"  # always one of LANGUAGES' codes
    speed: Decimal = Field(default=DEFAULT_SPEED, ge=SPEED_MIN, le=SPEED_MAX)
    voice: Literal["default", "low"] = "default"
    patience: Literal["normal", "high"] = "normal"
    stammer: bool = False
    hearing: bool = False
    prefers_text: bool = False
    other_language: str | None = None  # spoken by the caller, but not one the agent can switch to
    keywords: tuple[str, ...] = ()  # their stations and people, so speech recognition hears them
    reasons: tuple[str, ...] = ()  # the memories that changed something, in the person's words

    @property
    def adjusted(self) -> bool:
        """True when this call will sound different from everyone's default call."""
        return (
            self.language != "en"
            or self.speed != DEFAULT_SPEED
            or self.voice != "default"
            or self.patience != "normal"
            or self.prefers_text
            or self.other_language is not None
        )


def profile_from(memories: Iterable[tuple[str, str]]) -> VoiceProfile:
    """A profile from (category, text) pairs. Only `access`, `journey` and `contact` are read:
    preferences about updates, health details and money never change how Tempo speaks."""
    fields: dict[str, Any] = {}
    speed = DEFAULT_SPEED
    reasons: list[str] = []
    personal: list[str] = []
    for category, text in memories:
        said = " ".join(text.split())
        low = said.casefold()
        if category == "journey" and (trip := _COMMUTE.match(said)):
            personal += [trip.group(1), trip.group(2)]
            continue
        if category == "contact" and (person := _CONTACT.match(said)):
            personal.append(person.group(1))
            continue
        if category != "access":
            continue
        matched = False
        if _STAMMER.search(low):
            fields.update(patience="high", stammer=True)
            matched = True
        if _TIME.search(low):
            fields["patience"] = "high"
            matched = True
        if _HEARING.search(low):
            fields.update(hearing=True, voice="low")
            speed, matched = min(speed, HEARING_SPEED), True
        if _SLOWER.search(low):
            speed, matched = min(speed, SLOWER), True
        if _LOW_VOICE.search(low):
            fields["voice"], matched = "low", True
        if _TEXT.search(low):
            fields["prefers_text"], matched = True, True
        if spoken := _SPEAKS.search(low):
            name, matched = spoken.group(1), True
            if name in LANGUAGES:
                fields["language"] = LANGUAGES[name]
                fields["other_language"] = None
            else:
                fields["other_language"] = name.title()
        if matched:
            reasons.append(said)
    keywords = _keywords(personal) if personal else ()
    return VoiceProfile(speed=speed, keywords=keywords, reasons=tuple(reasons), **fields)


def _keywords(personal: list[str]) -> tuple[str, ...]:
    seen: dict[str, None] = {}
    for word in [*personal, *ALWAYS_KEYWORDS]:
        word = word.strip()
        if word and word.casefold() not in {k.casefold() for k in seen}:
            seen[word] = None
    return tuple(seen)[:MAX_KEYWORDS]


def how_to_speak(profile: VoiceProfile) -> str:
    """One short paragraph for the agent's {{how_to_speak}} variable, in plain words."""
    lines: list[str] = []
    if profile.language != "en":
        lines.append(f"Speak {LANGUAGE_NAMES[profile.language]} unless they switch.")
    if profile.other_language:
        lines.append(
            f"They may prefer {profile.other_language}. Offer to switch if you can, "
            "or keep your English short and plain."
        )
    if profile.stammer:
        lines.append("This caller has a stammer.")
    if profile.patience == "high":
        lines.append(
            "Never finish their words for them. Wait as long as it takes, and never rush them."
        )
    if profile.hearing:
        lines.append("They find it hard to hear. Use short sentences and say key numbers twice.")
    elif profile.speed < DEFAULT_SPEED:
        lines.append("Speak slowly, with short pauses.")
    if profile.prefers_text:
        lines.append("They would rather read the question. Offer to send it by text.")
    if not lines:
        return "No special needs are known. Keep it short and plain, and wait for them."
    return " ".join(lines)


def to_initiation(
    profile: VoiceProfile,
    *,
    user_id: str | None,
    display_name: str | None,
    voices: Mapping[str, str],
    greetings: Mapping[str, str],
) -> dict[str, Any]:
    """The JSON ElevenLabs expects back from the conversation-initiation webhook.

    Only settings that differ from the agent's own are overridden, because ElevenLabs refuses an
    override for any field the agent hasn't enabled, and an unchanged field needs no override.
    `voices` maps "default" and "low" to voice ids; `greetings` maps language codes to the first
    message in that language.
    """
    variables = {
        "caller_id": user_id or "",
        "display_name": display_name or "",
        "how_to_speak": how_to_speak(profile),
        "patience": profile.patience,
        "channel_hint": "text" if profile.prefers_text else "voice",
    }
    agent: dict[str, Any] = {}
    if profile.language != "en":
        agent["language"] = profile.language
        if greeting := greetings.get(profile.language):
            agent["first_message"] = greeting
    tts: dict[str, Any] = {}
    if profile.voice == "low" and voices.get("low"):
        tts["voice_id"] = voices["low"]
    if profile.speed != DEFAULT_SPEED:
        tts["speed"] = float(profile.speed)
    if profile.hearing:
        tts["stability"] = HEARING_STABILITY
    override: dict[str, Any] = {}
    if agent:
        override["agent"] = agent
    if tts:
        override["tts"] = tts
    if profile.keywords:
        override["asr"] = {"keywords": list(profile.keywords)}
    answer: dict[str, Any] = {
        "type": "conversation_initiation_client_data",
        "dynamic_variables": variables,
    }
    if override:
        answer["conversation_config_override"] = override
    return answer
