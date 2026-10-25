"""The chat's brain (plan.md §16): a large language model holds the conversation.

It reads the whole conversation, answers in its own words, asks its own follow-up questions,
and acts only through Tempo's tools. Each tool is a door the chat already has (`chat.Chat`), so
code still decides money, time and permissions:
- amounts come from the rule packs;
- the Consensus Court still judges;
- the person's yes is still theirs (a typed yes, or Face ID);
- STOP is still code's.

Every fact the model passes to a tool is checked against the person's own words before it is
used (`chat.grounding`), so a fact the model made up is refused and asked for instead.

The model is NVIDIA's Nemotron 3 Ultra on NVIDIA's API (OpenAI-compatible function calling).
When it fails or is slow, the rules answer instead, as before.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal

import httpx
import structlog

log = structlog.get_logger(__name__)

NVIDIA = "https://integrate.api.nvidia.com/v1"
MAX_HISTORY = 16
MAX_SAID = 700

SYSTEM = """You are Tempo, a warm and patient assistant for people in the UK (many are older, some
find reading hard). Tempo wins back money and time that companies owe them, and protects them from
scams. Today is {today}. You are talking with {name}. Reply in the language with code "{language}".

How you talk:
- Like a kind person speaking, not a form: one to three short sentences, no jargon.
- Plain text only: no markdown, no bold, no bullet points or numbered lists, no line breaks.
- When something is missing, ask for ONE thing only, as the last sentence ("What day was it?").
  Never ask two questions in one reply.
- Say back what you understood when it helps, so a mistake is caught early.
- As soon as you have every fact a tool needs, call it straight away. Never ask the person to
  confirm something they have just told you ("The Broadbandly engineer never came on 19 October"
  already names the provider and the day): Tempo always asks for their yes before it acts.
- If a place is a city with several stations (like London), use the station a train from their
  starting point would most likely arrive at, and say which one you assumed so they can correct it.
- A date without a year is this year (the most recent such day that is not in the future).
- Never read details back as a question ("Is that all correct?", "Was that 2026?"): if you have
  the facts, call the tool; if one is missing, ask only for that.

What you can do, only through your tools:
- A late or cancelled train (Delay Repay): you need the station they left from, where they were
  going, the day, the train's departure time and what the ticket cost. Gather these in
  conversation, then call claim_late_train.
- A broadband or phone engineer who missed a booked visit (Ofcom compensation): you need the
  provider and the day. Then call claim_missed_engineer_visit. Only broadband or phone providers
  count: not plumbers, builders, deliveries or other trades.
- A text, email or link they're unsure of: check_message_for_scam, with their message word for word.
- What you remember about them (recall_memory) or forgetting something (forget_memory).
- How much Tempo has got back so far (money_returned).
- Looking through their connected email, calendar and bank for money they're owed (sweep_inbox).
- Reading a letter or bill aloud (read_letter: they photograph it).
- Whether they might be owed a benefit (check_benefits).
- The profiles Tempo can work as (show_profiles).

Rules you never break:
- Never say an amount of money, a percentage or a deadline yourself: the tools' results say those.
- Never say you have done, filed, sent or claimed anything: only a tool does that, and Tempo always
  asks the person before it acts.
- Never invent a fact the person did not say. If you are unsure, ask.
- For anything Tempo cannot do, say so kindly and say what Tempo can do instead.
- No legal, medical or financial advice beyond pointing to the right official place."""


def _fn(
    name: str,
    description: str,
    properties: dict[str, Any] | None = None,
    required: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties or {},
                "required": required or [],
            },
        },
    }


_TEXT = {"type": "string"}
TOOLS: list[dict[str, Any]] = [
    _fn(
        "claim_late_train",
        "Start a Delay Repay claim for a late train once every fact is known from the person.",
        {
            "origin_station": _TEXT,
            "destination_station": _TEXT,
            "travel_date": {"type": "string", "description": "YYYY-MM-DD"},
            "departure_time": {"type": "string", "description": "HH:MM, 24-hour"},
            "fare_gbp": {"type": "string", "description": "the ticket price, e.g. 28.40"},
        },
        ["origin_station", "destination_station", "travel_date", "departure_time", "fare_gbp"],
    ),
    _fn(
        "claim_missed_engineer_visit",
        "Start an Ofcom claim for a broadband or phone engineer who missed a booked visit.",
        {"provider": _TEXT, "visit_date": {"type": "string", "description": "YYYY-MM-DD"}},
        ["provider", "visit_date"],
    ),
    _fn(
        "check_message_for_scam",
        "Check a text, email or link the person is unsure of.",
        {"message": {"type": "string", "description": "the message, word for word"}},
        ["message"],
    ),
    _fn("recall_memory", "Say what Tempo remembers about the person."),
    _fn("forget_memory", "Forget one thing Tempo remembers.", {"what": _TEXT}, ["what"]),
    _fn("money_returned", "How much money and time Tempo has got back so far."),
    _fn(
        "sweep_inbox",
        "Look through the person's connected email, calendar and bank for money they're owed.",
    ),
    _fn("read_letter", "Read a letter or bill aloud: the person photographs it."),
    _fn("check_benefits", "Screen whether the person might be owed a benefit (ten questions)."),
    _fn("show_profiles", "The profiles Tempo can work as."),
]
TOOL_NAMES = frozenset(t["function"]["name"] for t in TOOLS)

# What a reply in Tempo's own words may never contain (the rules above, enforced by code).
_MONEY = re.compile(r"£\s?\d|\b\d+(?:\.\d+)?\s?(?:pounds?|quid|gbp|p)\b|\b\d+\s?%", re.IGNORECASE)
_DONE = re.compile(
    r"\bI(?:'ve| have)\s+(?:already\s+)?"
    r"(?:filed|claimed|sent|submitted|started|made|lodged|paid)\b|"
    r"\b(?:claim|complaint)\s+(?:is|has been)\s+(?:filed|sent|submitted|made)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Say:
    """The brain answers in its own words."""

    text: str


@dataclass(frozen=True)
class Act:
    """The brain calls one of Tempo's tools."""

    tool: str
    args: dict[str, str] = field(default_factory=dict)
    call_id: str = "call_0"


@dataclass(frozen=True)
class Line:
    """One line of the conversation so far."""

    role: Literal["user", "tempo"]
    text: str


_MARKDOWN = re.compile(r"\*\*|__|`|^\s*(?:[-*•]|\d+[.)])\s+", re.MULTILINE)


def plain(text: str) -> str:
    """The model's reply as one plain paragraph: the chat shows text, not markdown."""
    return " ".join(_MARKDOWN.sub("", text).split())


def said_ok(text: str | None) -> str | None:
    """The brain's own words, if they keep the rules: no amounts, no claim of having acted."""
    if not text:
        return None
    said = plain(text).strip('"').strip()
    if not said or len(said) > MAX_SAID or _MONEY.search(said) or _DONE.search(said):
        return None
    return said


class Brain:
    """One model, its tools, and a timeout: a slow or failing model never stalls the chat."""

    def __init__(
        self,
        http: httpx.AsyncClient,
        *,
        api_key: str,
        model: str,
        base_url: str = NVIDIA,
        provider: str = "nvidia",
        timeout_s: float = 15.0,
    ) -> None:
        self._http, self._key, self.model = http, api_key, model
        self._url = f"{base_url.rstrip('/')}/chat/completions"
        self.provider, self._timeout = provider, timeout_s
        # Nemotron 3 thinks before it answers unless told not to: measured 25 Oct 2026, a claim's
        # tool call took 21 to 28 s thinking (and sometimes no call), 1.8 s without.
        self._extra: dict[str, Any] = (
            {"chat_template_kwargs": {"enable_thinking": False}} if "nemotron" in model else {}
        )

    def _messages(
        self, history: list[Line], text: str, *, name: str, language: str, today: date
    ) -> list[dict[str, Any]]:
        system = SYSTEM.format(today=today.isoformat(), name=name, language=language)
        lines = [
            {"role": "user" if line.role == "user" else "assistant", "content": line.text}
            for line in history[-MAX_HISTORY:]
            if line.text.strip()
        ]
        return [{"role": "system", "content": system}, *lines, {"role": "user", "content": text}]

    async def _complete(self, messages: list[dict[str, Any]], *, tools: bool) -> dict[str, Any]:
        body: dict[str, Any] = self._extra | {
            "model": self.model,
            "messages": messages,
            "temperature": 0.1,
            "max_tokens": 320,
        }
        if tools:
            body |= {"tools": TOOLS, "tool_choice": "auto"}
        response = await self._http.post(
            self._url,
            json=body,
            headers={"Authorization": f"Bearer {self._key}"},
            timeout=self._timeout,
        )
        response.raise_for_status()
        message: dict[str, Any] = response.json()["choices"][0]["message"]
        return message

    async def decide(
        self, history: list[Line], text: str, *, name: str, language: str, today: date
    ) -> Say | Act:
        """What to do with this turn: answer, or call one tool. Raises when the model fails."""
        message = await self._complete(
            self._messages(history, text, name=name, language=language, today=today), tools=True
        )
        for call in message.get("tool_calls") or []:
            fn = call.get("function") or {}
            if fn.get("name") in TOOL_NAMES:
                raw = fn.get("arguments") or "{}"
                args = json.loads(raw) if isinstance(raw, str) else dict(raw)
                return Act(
                    str(fn["name"]),
                    {k: str(v) for k, v in args.items() if v is not None},
                    str(call.get("id") or "call_0"),
                )
        return Say(str(message.get("content") or "").strip())

    async def follow_up(
        self,
        history: list[Line],
        text: str,
        act: Act,
        result: str,
        *,
        name: str,
        language: str,
        today: date,
    ) -> str:
        """After a tool said no (a fact was never said, a station or provider unknown): the brain
        tells the person in its own words, with no tool this time."""
        messages = self._messages(history, text, name=name, language=language, today=today)
        messages += [
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": act.call_id,
                        "type": "function",
                        "function": {"name": act.tool, "arguments": json.dumps(act.args)},
                    },
                ],
            },
            {"role": "tool", "tool_call_id": act.call_id, "content": result},
        ]
        message = await self._complete(messages, tools=False)
        return str(message.get("content") or "").strip()
