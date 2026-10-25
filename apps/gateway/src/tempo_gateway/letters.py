"""Read It To Me and Before You Pay (SHIPPING §4.8, track 1b).

No `from __future__ import annotations`: FastAPI reads these annotations at runtime.

| Route | What (all behind the Mission Control bearer token) |
|---|---|
| POST /letters/read | a photo of a letter: what it is and says, who owes what, what to do by when |
| POST /letters/reply | the reading plus the person's own words: a formal reply that adds nothing |
| POST /scam/payee | Before You Pay: who, how much and why, answered pay, wait or stop |

Photos are read once and dropped; nothing is stored. The log line carries the kind of letter and
how many facts were unsure, never the sender, an amount, a reference or the person's id.
"""

import base64
import binascii
import hashlib
import time
from collections.abc import Callable, Collection
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from tempo_adapters.scam import Registers
from tempo_core.errors import VisionUnavailable
from tempo_core.letters import LetterReading, foreign_numbers, read_letter, reply_draft
from tempo_core.models import Fact
from tempo_core.payee import before_you_pay
from tempo_core.rules.schema import ClockPack
from tempo_core.scam import assess
from tempo_gateway.security import secret_matches
from tempo_ports.vision import DocumentKind, VisionPort

log = structlog.get_logger("tempo.letters")
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_IMAGE_B64 = (MAX_IMAGE_BYTES + 2) // 3 * 4  # the same 8 MiB once base64-encoded
TOO_BIG = "That file is too big. 8 MB is the most I can read."
# Photos, and PDFs (plan.md §19): Gemini reads a PDF itself; a reader that only sees pictures
# refuses one, and the person is asked for a photo of the page instead.
MIME = {
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp",
    "heic": "image/heic", "pdf": "application/pdf",
}  # fmt: skip
CANT_READ = "I couldn't read that letter. Try a clearer photo, or tell me what it says."
CANT_READ_PDF = (
    "I couldn't read that PDF. Send a photo of the page instead, or tell me what it says."
)
Clocks = Callable[[str], list[ClockPack]]
Caller = Callable[..., str]


class LetterPhoto(BaseModel):
    """A photo or PDF of a letter. Vision reads it once; the bytes are never kept."""

    image_b64: str = Field(min_length=1)
    filename: str = Field(default="letter.png", max_length=80)
    user_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    language: Literal["en"] = "en"


class Reply(BaseModel):
    reading: LetterReading
    said: str = Field(min_length=1, max_length=2000)


class Payment(BaseModel):
    """Who, how much and why. `firm` is who a message claims to be from, for the registers."""

    payee_name: str = Field(min_length=1, max_length=80)
    amount_gbp: Decimal = Field(ge=0)
    reason: str = Field(default="", max_length=500)
    new_payee: bool
    message_text: str | None = Field(default=None, max_length=2000)
    firm: str | None = Field(default=None, max_length=80)


def bearer_caller(api_token: str | None) -> Caller:
    """The check `create_app` makes for Mission Control: one bearer token, compared in constant
    time. Here so a router can be mounted and tested without the whole app."""

    def web_caller(authorization: Annotated[str | None, Header()] = None) -> str:
        token = (authorization or "").removeprefix("Bearer ").strip()
        if not secret_matches(token, api_token):
            raise HTTPException(401, "a valid bearer token is required")
        return "web:" + hashlib.sha256(token.encode()).hexdigest()[:12]

    return web_caller


def letters_router(
    vision: VisionPort,
    clocks: Clocks,
    holidays: Collection[date],
    web_caller: Caller,
    *,
    today: Callable[[], date] | None = None,
) -> APIRouter:
    """`clocks` is `RulePackRegistry.clocks`; `today` is injectable so fixtures stay stable."""
    router = APIRouter(dependencies=[Depends(web_caller)])
    now_date = today or (lambda: datetime.now(UTC).date())

    @router.post("/letters/read")
    async def read(body: LetterPhoto) -> LetterReading:
        """What the letter is, says and asks, in short spoken sentences, with one read-back per
        fact Tempo isn't sure of."""
        image = _image(body.image_b64)
        started = time.monotonic()
        facts = await _facts(vision, image, body.filename)
        reading = read_letter(facts, today=now_date(), clocks=clocks, holidays=holidays)
        log.info(
            "letter_read", decision=reading.kind, reason=f"{len(reading.unsure)} unsure",
            latency_ms=round((time.monotonic() - started) * 1000),
        )  # fmt: skip
        return reading

    @router.post("/letters/reply")
    async def reply(body: Reply) -> dict[str, Any]:
        """Say it, Tempo writes it: a formal reply from the reading and the person's own words.
        `added_nothing` is checked, not claimed: every number in the draft must come from them."""
        draft = reply_draft(body.reading, body.said)
        given = body.reading.model_dump_json() + "\n" + body.said
        return {"draft": draft, "added_nothing": not foreign_numbers(draft, given)}

    return router


def payee_router(
    web_caller: Caller, *, registers: Registers | None = None, registers_simulated: bool = True
) -> APIRouter:
    router = APIRouter(dependencies=[Depends(web_caller)])

    @router.post("/scam/payee")
    async def payee(body: Payment) -> dict[str, Any]:
        """Before You Pay: pay, wait or stop, with reasons. Tempo never moves the money."""
        level = None
        if body.firm and registers is not None:
            firm = await registers.check(body.firm)
            level = assess(body.message_text or body.reason, firm).level
        advice = before_you_pay(
            body.payee_name, body.amount_gbp, body.reason, new_payee=body.new_payee,
            message_text=body.message_text, registers_level=level,
        )  # fmt: skip
        log.info("before_you_pay", decision=advice.verdict, reason=f"{len(advice.reasons)} reasons")
        return advice.model_dump(mode="json") | {
            "simulated": registers is None or registers_simulated
        }

    return router


async def _facts(vision: VisionPort, image: bytes, filename: str) -> tuple[Fact, ...]:
    try:
        return await vision.extract(
            image, mime_type=_mime(filename), kind=DocumentKind.OFFICIAL_LETTER, filename=filename
        )
    except VisionUnavailable:
        pdf = _mime(filename) == "application/pdf"
        raise HTTPException(503, CANT_READ_PDF if pdf else CANT_READ) from None


def _image(image_b64: str) -> bytes:
    if len(image_b64) > MAX_IMAGE_B64:
        raise HTTPException(413, TOO_BIG)
    try:
        image = base64.b64decode(image_b64, validate=True)
    except binascii.Error:
        raise HTTPException(400, "That file didn't arrive whole. Please send it again.") from None
    if len(image) > MAX_IMAGE_BYTES:
        raise HTTPException(413, TOO_BIG)
    return image


def _mime(filename: str) -> str:
    return MIME.get(filename.rsplit(".", 1)[-1].lower(), "image/png")
