"""The connector servers' parsers, without MCP: the iCalendar reader, the CSV statement reader
and the .eml reader."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from tempo_mcp_bank.statement import (
    newest_first,
    parse_amount,
    parse_day,
    parse_statement,
    transaction_id,
)
from tempo_mcp_calendar.ics import (
    UK_TIME,
    Property,
    events_between,
    parse_duration,
    parse_events,
    parse_line,
    parse_time,
    parse_when,
    unescape,
    unfold,
)
from tempo_mcp_mail.messages import html_to_text, read_message, search
from tempo_mcp_mail.messages import parse_when as mail_when

LONDON = ZoneInfo("Europe/London")


def calendar(*events: str) -> str:
    body = "\r\n".join(f"BEGIN:VEVENT\r\n{e.strip()}\r\nEND:VEVENT" for e in events)
    return f"BEGIN:VCALENDAR\r\nVERSION:2.0\r\n{body}\r\nEND:VCALENDAR\r\n"


# --- iCalendar -------------------------------------------------------------------------------


def test_folded_lines_are_joined_back_on() -> None:
    text = "DESCRIPTION:Engineer to fix the broad\r\n band\r\n\t today\r\nSUMMARY:Visit\r\n"

    assert unfold(text) == ["DESCRIPTION:Engineer to fix the broadband today", "SUMMARY:Visit"]


def test_a_content_line_splits_on_the_first_colon_outside_quotes() -> None:
    prop = parse_line('DTSTART;TZID="Europe/London";X-NOTE="a:b":20261019T080000')

    assert prop == Property(
        name="DTSTART", params={"TZID": "Europe/London", "X-NOTE": "a:b"}, value="20261019T080000"
    )
    assert parse_line("not a content line") is None
    assert parse_line("summary:Tea: at four") == Property("SUMMARY", {}, "Tea: at four")


@pytest.mark.parametrize(
    ("line", "expected"),
    [
        ("DTSTART:20261019T070000Z", datetime(2026, 10, 19, 7, tzinfo=UTC)),
        ("DTSTART;TZID=Europe/London:20261019T080000", datetime(2026, 10, 19, 8, tzinfo=LONDON)),
        ("DTSTART:20261019T080000", datetime(2026, 10, 19, 8, tzinfo=LONDON)),  # floating
        ("DTSTART;TZID=GMT Standard Time:20261019T0800", datetime(2026, 10, 19, 8, tzinfo=LONDON)),
        ("DTSTART;TZID=Nowhere/Atlantis:20261019T080000", datetime(2026, 10, 19, 8, tzinfo=LONDON)),
        ("DTSTART;VALUE=DATE:20261019", date(2026, 10, 19)),
        ("DTSTART:20261019", date(2026, 10, 19)),
    ],
)
def test_start_times_in_every_form(line: str, expected: date | datetime) -> None:
    prop = parse_line(line)
    assert prop is not None

    parsed = parse_time(prop)

    assert parsed == expected and type(parsed) is type(expected)


def test_the_engineer_visit_reads_as_uk_summer_time() -> None:
    [visit] = parse_events(
        calendar(
            "UID:visit-1\r\nDTSTART;TZID=Europe/London:20261019T080000\r\n"
            "DTEND;TZID=Europe/London:20261019T130000\r\nSUMMARY:Broadbandly engineer visit"
        )
    )

    assert visit.start.isoformat() == "2026-10-19T08:00:00+01:00"
    assert visit.end.isoformat() == "2026-10-19T13:00:00+01:00"
    assert (visit.uid, visit.title, visit.location, visit.description) == (
        "visit-1",
        "Broadbandly engineer visit",
        "",
        "",
    )


def test_only_the_events_own_properties_count() -> None:
    text = (
        "BEGIN:VCALENDAR\r\nBEGIN:VTIMEZONE\r\nTZID:Europe/London\r\nBEGIN:STANDARD\r\n"
        "DTSTART:19701025T020000\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n"
        "BEGIN:VEVENT\r\nDTSTART:20261023T071200Z\r\nSUMMARY:Train\r\nDESCRIPTION:The 08:12\r\n"
        "BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nTRIGGER:-PT1H\r\nEND:VALARM\r\n"
        "END:VEVENT\r\nEND:VCALENDAR\r\n"
    )

    [train] = parse_events(text)

    assert train.description == "The 08:12"  # not the alarm's
    assert train.start == datetime(2026, 10, 23, 7, 12, tzinfo=UTC)


def test_text_is_unescaped() -> None:
    assert unescape(r"The Surgery\, High Street\nRoom 2\; ask at the desk \\ thanks") == (
        "The Surgery, High Street\nRoom 2; ask at the desk \\ thanks"
    )


def test_an_end_comes_from_dtend_duration_or_the_rules() -> None:
    timed, all_day, instant = parse_events(
        calendar(
            "UID:a\r\nDTSTART:20261014T092000Z\r\nDURATION:PT1H30M",
            "UID:b\r\nDTSTART;VALUE=DATE:20261027",
            "UID:c\r\nDTSTART:20261014T092000Z",
        )
    )

    assert timed.end == datetime(2026, 10, 14, 10, 50, tzinfo=UTC)
    assert all_day.end == date(2026, 10, 28)  # a date lasts the day
    assert instant.end == instant.start


def test_durations() -> None:
    assert parse_duration("P1W") == timedelta(weeks=1)
    assert parse_duration("P1DT2H") == timedelta(days=1, hours=2)
    assert parse_duration("-PT15M") == timedelta(minutes=-15)
    with pytest.raises(ValueError, match="not an iCalendar duration"):
        parse_duration("PT")


def test_cancelled_unreadable_and_startless_events_are_left_out() -> None:
    events = parse_events(
        calendar(
            "UID:kept\r\nDTSTART:20261014T092000Z",
            "UID:cancelled\r\nDTSTART:20261015T092000Z\r\nSTATUS:CANCELLED",
            "UID:garbled\r\nDTSTART:next Tuesday",
            "UID:no-start\r\nSUMMARY:Someday",
        )
    )

    assert [e.uid for e in events] == ["kept"]


def test_an_event_without_a_uid_gets_a_stable_one() -> None:
    text = calendar("DTSTART:20261014T092000Z\r\nSUMMARY:Coffee")

    [first], [second] = parse_events(text), parse_events(text)

    assert first.uid == second.uid and first.uid.startswith("tempo-")


def test_events_between_is_half_open_and_sorted() -> None:
    events = parse_events(
        calendar(
            "UID:late\r\nDTSTART;TZID=Europe/London:20261031T235959",
            "UID:edge\r\nDTSTART;TZID=Europe/London:20261101T000000",
            "UID:first\r\nDTSTART;TZID=Europe/London:20261001T000000",
            "UID:day\r\nDTSTART;VALUE=DATE:20261015",
            "UID:before\r\nDTSTART;TZID=Europe/London:20260930T235959",
        )
    )

    found = events_between(events, parse_when("2026-10-01"), parse_when("2026-11-01"))

    assert [e.uid for e in found] == ["first", "day", "late"]


def test_when_without_an_offset_means_uk_time() -> None:
    assert parse_when("2026-10-19") == datetime(2026, 10, 19, tzinfo=LONDON)
    assert parse_when("2026-10-19T08:00Z") == datetime(2026, 10, 19, 8, tzinfo=UTC)
    with pytest.raises(ValueError, match="not an ISO date"):
        parse_when("19/10/2026")


@pytest.mark.parametrize(
    ("wall", "hours"),
    [
        (datetime(2026, 1, 15, 12), 0),
        (datetime(2026, 3, 29, 0, 59), 0),  # the clocks go forward at 01:00 GMT
        (datetime(2026, 3, 29, 2, 0), 1),
        (datetime(2026, 10, 19, 8), 1),
        (datetime(2026, 10, 25, 0, 30), 1),  # and back at 02:00 BST
        (datetime(2026, 10, 25, 2, 0), 0),
        (datetime(2026, 10, 28, 14, 30), 0),
    ],
)
def test_uk_time_without_a_time_zone_database(wall: datetime, hours: int) -> None:
    moment = wall.replace(tzinfo=UK_TIME)

    assert moment.utcoffset() == timedelta(hours=hours)
    assert moment.utcoffset() == wall.replace(tzinfo=LONDON).utcoffset()  # agrees with tzdata


# --- CSV statement ---------------------------------------------------------------------------

STATEMENT = """\
# DEMO DATA
Date, Description ,Amount
2026-10-01,BROADBANDLY DD,-45.00
09/10/2026,THAMES WATER REFUND,23.4
2026-10-09,  CORNER   SHOP ,"-£1,001.205"

2026-10-12,COFFEE,-2.50
2026-10-12,COFFEE,-2.50
"""


def test_a_statement_reads_with_comments_any_case_headers_and_uk_dates() -> None:
    rows = parse_statement(STATEMENT)

    assert [(t.day, t.description, t.amount_gbp) for t in rows] == [
        (date(2026, 10, 1), "BROADBANDLY DD", "-45.00"),
        (date(2026, 10, 9), "THAMES WATER REFUND", "+23.40"),
        (date(2026, 10, 9), "CORNER SHOP", "-1001.21"),  # rounded half up, to the penny
        (date(2026, 10, 12), "COFFEE", "-2.50"),
        (date(2026, 10, 12), "COFFEE", "-2.50"),
    ]


def test_ids_are_stable_hashes_and_identical_rows_differ() -> None:
    first, second = parse_statement(STATEMENT), parse_statement(STATEMENT)

    assert [t.id for t in first] == [t.id for t in second]
    assert len({t.id for t in first}) == len(first)  # the two coffees too
    assert first[1].id == transaction_id(date(2026, 10, 9), "THAMES WATER REFUND", Decimal("23.40"))


def test_newest_first_with_since_and_limit() -> None:
    rows = parse_statement(STATEMENT)

    newest = newest_first(rows)
    since = newest_first(rows, since=date(2026, 10, 9), limit=3)

    assert [t.description for t in newest][:2] == ["COFFEE", "COFFEE"]
    assert newest[0].row > newest[1].row  # same day: the later row first
    assert [t.description for t in newest][-1] == "BROADBANDLY DD"
    assert [t.description for t in since] == ["COFFEE", "COFFEE", "CORNER SHOP"]


def test_amounts_and_days() -> None:
    assert parse_amount(" £12.5 ") == Decimal("12.50")
    assert f"{parse_amount('-0.001'):+.2f}" == "+0.00"  # never "-0.00"
    assert parse_day("2026-10-09T08:00") == date(2026, 10, 9)
    with pytest.raises(ValueError, match="not an amount"):
        parse_amount("twelve")
    with pytest.raises(ValueError, match="not an amount"):
        parse_amount("NaN")
    with pytest.raises(ValueError, match="not a date"):
        parse_day("Oct 9")


def test_a_bad_statement_says_what_is_wrong() -> None:
    with pytest.raises(ValueError, match="no amount"):
        parse_statement("date,description\n2026-10-01,X\n")
    with pytest.raises(ValueError, match="row 2: 'lots' is not an amount"):
        parse_statement("date,description,amount\n2026-10-01,A,-1.00\n2026-10-02,B,lots\n")


# --- .eml ------------------------------------------------------------------------------------

ALTERNATIVE = b"""\
From: Thames Water <billing@thameswater.example>
To: Margaret <margaret@example.com>
Subject: =?utf-8?q?Refund_of_=C2=A323=2E40?=
Date: Sat, 03 Oct 2026 08:30:00 +0100
MIME-Version: 1.0
Content-Type: multipart/alternative; boundary="b"

--b
Content-Type: text/plain; charset="utf-8"

We will refund you.
--b
Content-Type: text/html; charset="utf-8"

<p>We will <b>refund</b> you, in HTML.</p>
--b--
"""


def test_a_message_prefers_its_plain_text_and_decodes_the_subject(tmp_path: Path) -> None:
    path = tmp_path / "water.eml"
    path.write_bytes(ALTERNATIVE)

    message = read_message(path)

    assert (message.id, message.subject, message.text) == (
        "water",
        "Refund of £23.40",
        "We will refund you.",
    )
    assert message.date == "2026-10-03T08:30:00+01:00"
    assert message.attachments == ()


def test_html_is_stripped_to_what_a_person_sees() -> None:
    html = (
        "<html><head><title>T</title><style>p{color:red}</style></head><body>"
        "<h1>Due back</h1><p>Hello&nbsp;Margaret,\n  these are due:</p>"
        "<table><tr><td>Middlemarch</td><td>George Eliot</td></tr></table>"
        "<script>track()</script><p>Fish &amp; chips<br>on Friday</p></body></html>"
    )

    assert html_to_text(html) == (
        "Due back\n\nHello Margaret, these are due:\n\nMiddlemarch George Eliot\n\n"
        "Fish & chips\non Friday"
    )


def test_search_needs_every_word_in_any_case_and_honours_since(tmp_path: Path) -> None:
    for name, subject, day in [
        ("a", "Tax refund", "Sat, 24 Oct 2026 06:41:09 +0100"),
        ("b", "Your refund", "Sat, 03 Oct 2026 08:30:00 +0100"),
    ]:
        (tmp_path / f"{name}.eml").write_text(
            f"From: x@example.com\nSubject: {subject}\nDate: {day}\n\nHello.\n", encoding="utf-8"
        )
    messages = [read_message(p) for p in sorted(tmp_path.glob("*.eml"))]

    assert [m.id for m in search(messages, "REFUND")] == ["a", "b"]
    assert [m.id for m in search(messages, "refund tax")] == ["a"]
    assert [m.id for m in search(messages, "refund", since=mail_when("2026-10-10"))] == ["a"]
    assert [m.id for m in search(messages, "", limit=1)] == ["a"]
    assert search(messages, "parcel") == []
