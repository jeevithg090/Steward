"""A small iCalendar (RFC 5545) reader: the VEVENTs in .ics text, with their times.

Enough of the format for exported calendars, with no dependency: folded lines, escaped text,
DTSTART and DTEND as a date, a UTC time (`Z`), a time with a `TZID`, or a floating time (read as
UK time), and DURATION when there is no DTEND. Only properties of the VEVENT itself are read (not
those of its VALARMs or of a VTIMEZONE). A recurring event is read as its first occurrence, and a
cancelled one is left out.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# Outlook writes Windows zone names; these are the ones a UK calendar meets.
_WINDOWS_ZONES = {
    "GMT Standard Time": "Europe/London",
    "UTC": "UTC",
    "Coordinated Universal Time": "UTC",
}
_DURATION = re.compile(
    r"^(?P<sign>[+-])?P(?:(?P<weeks>\d+)W)?(?:(?P<days>\d+)D)?"
    r"(?:T(?:(?P<hours>\d+)H)?(?:(?P<minutes>\d+)M)?(?:(?P<seconds>\d+)S)?)?$"
)
_ESCAPED = re.compile(r"\\([\\;,nN])")


@dataclass(frozen=True, slots=True)
class Property:
    name: str
    params: dict[str, str]
    value: str


@dataclass(frozen=True, slots=True)
class Event:
    uid: str
    title: str
    start: date | datetime  # a datetime is always aware; a date is an all-day event
    end: date | datetime
    location: str
    description: str

    @property
    def begins(self) -> datetime:
        return instant(self.start)


def parse_events(text: str) -> list[Event]:
    """Every VEVENT in one calendar's text, in the order they appear."""
    events: list[Event] = []
    stack: list[str] = []
    props: dict[str, Property] = {}
    for line in unfold(text):
        prop = parse_line(line)
        if prop is None:
            continue
        if prop.name == "BEGIN":
            stack.append(prop.value.strip().upper())
            if stack[-1] == "VEVENT":
                props = {}
        elif prop.name == "END":
            ended = stack.pop() if stack and stack[-1] == prop.value.strip().upper() else None
            if ended == "VEVENT" and (event := _event(props)) is not None:
                events.append(event)
        elif stack and stack[-1] == "VEVENT":
            props.setdefault(prop.name, prop)
    return events


def events_between(events: Iterable[Event], start: datetime, end: datetime) -> list[Event]:
    """The events that begin in [start, end), earliest first."""
    return sorted(
        (e for e in events if start <= e.begins < end), key=lambda e: (e.begins, e.title, e.uid)
    )


def unfold(text: str) -> list[str]:
    """Content lines, with folded continuations (a leading space or tab) joined back on."""
    lines: list[str] = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if raw[:1] in (" ", "\t") and lines:
            lines[-1] += raw[1:]
        elif raw.strip():
            lines.append(raw)
    return lines


def parse_line(line: str) -> Property | None:
    """`NAME;PARAM=value;PARAM="quoted:value":the value`, or None if it is not a content line."""
    head, sep, value = _cut(line, ":")
    if not sep:
        return None
    name, *params = _split(head, ";")
    parsed: dict[str, str] = {}
    for param in params:
        key, _, param_value = param.partition("=")
        parsed[key.strip().upper()] = param_value.strip().strip('"')
    return Property(name=name.strip().upper(), params=parsed, value=value)


def parse_time(prop: Property) -> date | datetime:
    """A DATE, a UTC DATE-TIME (`Z`), one with a TZID, or a floating one (read as UK time)."""
    value = prop.value.strip()
    if prop.params.get("VALUE", "").upper() == "DATE" or re.fullmatch(r"\d{8}", value):
        return datetime.strptime(value, "%Y%m%d").date()
    utc = value.upper().endswith("Z")
    digits = value[:-1] if utc else value
    shape = "%Y%m%dT%H%M%S" if len(digits) == 15 else "%Y%m%dT%H%M"
    moment = datetime.strptime(digits, shape)
    return moment.replace(tzinfo=UTC if utc else zone(prop.params.get("TZID")))


def parse_duration(value: str) -> timedelta:
    match = _DURATION.match(value.strip().upper())
    parts = {
        k: int(v) for k, v in (match.groupdict() if match else {}).items() if k != "sign" and v
    }
    if match is None or not parts:
        raise ValueError(f"{value!r} is not an iCalendar duration, e.g. PT1H30M")
    length = timedelta(**parts)
    return -length if match["sign"] == "-" else length


def unescape(value: str) -> str:
    return _ESCAPED.sub(lambda m: "\n" if m[1] in "nN" else m[1], value)


def instant(value: date | datetime) -> datetime:
    """The moment a start or end begins; an all-day date begins at midnight UK time."""
    if isinstance(value, datetime):
        return value
    return datetime.combine(value, time(), london())


def parse_when(value: str) -> datetime:
    """An ISO date or date and time as an aware datetime; one with no offset is UK time."""
    try:
        moment = datetime.fromisoformat(value.strip())
    except ValueError as exc:
        raise ValueError(
            f"{value!r} is not an ISO date or date and time, e.g. 2026-10-01 or 2026-10-01T09:00"
        ) from exc
    return moment if moment.tzinfo else moment.replace(tzinfo=london())


def zone(tzid: str | None) -> tzinfo:
    """The named zone; UK time when there is no name or it is one this machine does not know."""
    if not tzid:
        return london()
    try:
        return ZoneInfo(_WINDOWS_ZONES.get(tzid, tzid))
    except (ZoneInfoNotFoundError, ValueError, OSError):
        return london()


def london() -> tzinfo:
    try:
        return ZoneInfo("Europe/London")
    except ZoneInfoNotFoundError:  # a slim image without a time-zone database
        return UK_TIME


class _UkTime(tzinfo):
    """UK civil time without a time-zone database: BST from 01:00 UTC on the last Sunday of
    March to 01:00 UTC on the last Sunday of October, GMT otherwise."""

    def utcoffset(self, dt: datetime | None) -> timedelta:
        return self.dst(dt)

    def dst(self, dt: datetime | None) -> timedelta:
        if dt is None:
            return timedelta(0)
        wall = dt.replace(tzinfo=None)
        starts = datetime.combine(_last_sunday(wall.year, 3), time(1))  # 01:00 GMT
        ends = datetime.combine(_last_sunday(wall.year, 10), time(2))  # 02:00 BST
        return timedelta(hours=1) if starts <= wall < ends else timedelta(0)

    def tzname(self, dt: datetime | None) -> str:
        return "BST" if self.dst(dt) else "GMT"

    def __repr__(self) -> str:
        return "UK_TIME"


def _last_sunday(year: int, month: int) -> date:
    last = date(year, month + 1, 1) - timedelta(days=1)
    return last - timedelta(days=(last.weekday() - 6) % 7)


UK_TIME = _UkTime()


def _event(props: dict[str, Property]) -> Event | None:
    """The event, or None when it has no readable start or was cancelled."""
    status = props.get("STATUS")
    if "DTSTART" not in props or (status and status.value.strip().upper() == "CANCELLED"):
        return None
    try:
        start = parse_time(props["DTSTART"])
        if "DTEND" in props:
            end = parse_time(props["DTEND"])
        elif "DURATION" in props:
            end = start + parse_duration(props["DURATION"].value)
        else:  # RFC 5545: a date lasts the day; a date and time has no length
            end = start + timedelta(days=1) if type(start) is date else start
    except ValueError:
        return None
    title = unescape(props["SUMMARY"].value).strip() if "SUMMARY" in props else ""
    uid = props["UID"].value.strip() if "UID" in props else ""
    return Event(
        uid=uid or _made_up_uid(title, start),
        title=title,
        start=start,
        end=end,
        location=unescape(props["LOCATION"].value).strip() if "LOCATION" in props else "",
        description=unescape(props["DESCRIPTION"].value).strip() if "DESCRIPTION" in props else "",
    )


def _made_up_uid(title: str, start: date | datetime) -> str:
    digest = hashlib.sha256(f"{title}|{start.isoformat()}".encode()).hexdigest()[:16]
    return f"tempo-{digest}"


def _cut(text: str, sep: str) -> tuple[str, str, str]:
    """`str.partition` that ignores separators inside double quotes."""
    quoted = False
    for i, ch in enumerate(text):
        if ch == '"':
            quoted = not quoted
        elif ch == sep and not quoted:
            return text[:i], sep, text[i + 1 :]
    return text, "", ""


def _split(text: str, sep: str) -> list[str]:
    parts: list[str] = []
    rest = text
    while True:
        head, found, rest = _cut(rest, sep)
        parts.append(head)
        if not found:
            return parts
