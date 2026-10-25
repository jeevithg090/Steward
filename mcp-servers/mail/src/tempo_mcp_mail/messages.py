"""Read a folder of .eml files: the headers, the plain text, and what is attached.

Parsed by code with the standard library. Nothing here follows a link, opens an attachment or
acts on what a message says: a message is evidence, never instructions. A message's id is its
file name without `.eml`.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, tzinfo
from email.message import EmailMessage
from email.parser import BytesParser
from email.policy import default
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

SNIPPET_CHARS = 160

# Paragraph-like tags start and end a block; line-like ones end a line; a cell ends with a space.
_BLOCK_TAGS = frozenset(
    [
        "address",
        "blockquote",
        "div",
        "dl",
        "footer",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "header",
        "hr",
        "ol",
        "p",
        "pre",
        "section",
        "table",
        "ul",
    ]
)
_LINE_TAGS = frozenset({"dd", "dt", "li", "tr"})
_CELL_TAGS = frozenset({"td", "th"})
_HIDDEN_TAGS = frozenset({"head", "script", "style", "template"})


@dataclass(frozen=True, slots=True)
class Attachment:
    filename: str
    mime_type: str


@dataclass(frozen=True, slots=True)
class Message:
    id: str
    sender: str
    to: str
    subject: str
    sent: datetime | None  # aware; None when the message has no readable Date header
    text: str
    attachments: tuple[Attachment, ...]

    @property
    def date(self) -> str:
        return self.sent.isoformat() if self.sent else ""

    @property
    def snippet(self) -> str:
        flat = " ".join(self.text.split())
        if len(flat) <= SNIPPET_CHARS:
            return flat
        return flat[:SNIPPET_CHARS].rsplit(" ", 1)[0] + "..."

    def matches(self, query: str) -> bool:
        """Every word of the query appears in the subject, the sender or the text, any case."""
        haystack = f"{self.subject}\n{self.sender}\n{self.text}".casefold()
        return all(term in haystack for term in query.casefold().split())


def message_files(folder: Path) -> dict[str, Path]:
    """The folder's .eml files by id. Ids come from here, never from a path a caller built."""
    return {path.stem: path for path in sorted(folder.glob("*.eml")) if path.is_file()}


def read_message(path: Path) -> Message:
    with path.open("rb") as handle:
        msg = BytesParser(policy=default).parse(handle)
    return Message(
        id=path.stem,
        sender=_header(msg, "From"),
        to=_header(msg, "To"),
        subject=_header(msg, "Subject"),
        sent=_sent(msg),
        text=_text(msg),
        attachments=tuple(
            Attachment(filename=part.get_filename() or "", mime_type=part.get_content_type())
            for part in msg.iter_attachments()
        ),
    )


def read_folder(folder: Path) -> list[Message]:
    """Every message in the folder, newest first; undated ones last."""
    return newest_first(read_message(path) for path in message_files(folder).values())


def newest_first(messages: Iterable[Message]) -> list[Message]:
    oldest = datetime.min.replace(tzinfo=UTC)
    return sorted(
        messages, key=lambda m: (m.sent is not None, m.sent or oldest, m.id), reverse=True
    )


def search(
    messages: Iterable[Message], query: str = "", since: datetime | None = None, limit: int = 20
) -> list[Message]:
    found = (
        m
        for m in newest_first(messages)
        if m.matches(query) and (since is None or (m.sent is not None and m.sent >= since))
    )
    return [m for _, m in zip(range(limit), found, strict=False)]


def parse_when(value: str) -> datetime:
    """An ISO date or date and time as an aware datetime; one with no offset is UK time."""
    try:
        moment = datetime.fromisoformat(value.strip())
    except ValueError as exc:
        raise ValueError(
            f"{value!r} is not an ISO date or date and time, e.g. 2026-10-01 or 2026-10-01T09:00"
        ) from exc
    return moment if moment.tzinfo else moment.replace(tzinfo=london())


def london() -> tzinfo:
    try:
        return ZoneInfo("Europe/London")
    except ZoneInfoNotFoundError:  # a slim image without a time-zone database
        return UTC


def html_to_text(html: str) -> str:
    """The words a person would see, one block per line; scripts, styles and markup dropped."""
    parser = _TextOnly()
    parser.feed(html)
    parser.close()
    return _tidy("".join(parser.parts))


def _header(msg: EmailMessage, name: str) -> str:
    value = msg.get(name)
    return " ".join(str(value).split()) if value is not None else ""


def _sent(msg: EmailMessage) -> datetime | None:
    value = msg.get("Date")
    if value is None:
        return None
    try:
        sent = parsedate_to_datetime(str(value))
    except (TypeError, ValueError):
        return None
    return sent if sent.tzinfo else sent.replace(tzinfo=UTC)


def _text(msg: EmailMessage) -> str:
    body = msg.get_body(preferencelist=("plain", "html"))
    if body is None:
        return ""
    content = body.get_content()
    if not isinstance(content, str):
        return ""
    if body.get_content_type() == "text/html":
        return html_to_text(content)
    return _tidy(content)


def _tidy(text: str) -> str:
    lines = [" ".join(line.split()) for line in text.replace("\r\n", "\n").split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


class _TextOnly(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._hidden = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _HIDDEN_TAGS:
            self._hidden += 1
        elif tag in _BLOCK_TAGS or tag == "br":
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _HIDDEN_TAGS:
            self._hidden = max(0, self._hidden - 1)
        elif tag in _BLOCK_TAGS or tag in _LINE_TAGS:
            self.parts.append("\n")
        elif tag in _CELL_TAGS:
            self.parts.append(" ")

    def handle_data(self, data: str) -> None:
        if not self._hidden:  # in HTML a run of spaces and newlines is one space; tags break lines
            self.parts.append(re.sub(r"\s+", " ", data))
