"""The link sandbox and the phishing lists (docs/scam-shield.md §5): recorded, mocked, judged."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import httpx
import pytest

from tempo_adapters.scam import LiveSandbox, ReplaySandbox, ThreatFeeds
from tempo_adapters.scam.feeds import host_of
from tempo_core.scam import Evidence, Level, Zone, assess

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "scam"
PARCEL = "Your parcel is waiting. Track it: rb.gy/4k2q"


async def test_a_recorded_look_settles_a_held_message() -> None:
    sandbox = ReplaySandbox(FIXTURES / "sandbox")

    held = assess(PARCEL, None)
    report = await sandbox.inspect("rb.gy")
    settled = assess(PARCEL, None, Evidence(sandbox=(report,)))

    assert held.zone is Zone.SANDBOX and held.level is Level.CAUTION
    assert report.findings[0] == "redirects_to:evri-redelivery.co" and not report.official
    assert settled.level is Level.LIKELY_SCAM and settled.zone is Zone.WARN and settled.checked
    assert "the link quietly moves you on to evri-redelivery.co" in settled.why


async def test_a_recorded_look_can_clear_a_link_without_calling_it_safe() -> None:
    sandbox = ReplaySandbox(FIXTURES / "sandbox")
    text = "Council tax: see tinyurl.com/oxtax"

    report = await sandbox.inspect("tinyurl.com")
    settled = assess(text, None, Evidence(sandbox=(report,)))

    assert report.official and report.findings == ("redirects_to:oxford.gov.uk",)
    assert settled.level is Level.CAUTION and settled.zone is Zone.QUIET and settled.checked


async def test_an_unknown_host_is_unreachable_never_fine() -> None:
    report = await ReplaySandbox(FIXTURES / "sandbox").inspect("nobody-recorded-this.example")

    assert report.findings == ("unreachable",)
    verdict = assess("see nobody-recorded-this.example/x", None, Evidence(sandbox=(report,)))
    assert verdict.level is not Level.NO_FLAGS


def live(handler: httpx.MockTransport, *, rdap: bool = True) -> LiveSandbox:
    return LiveSandbox(httpx.AsyncClient(transport=handler), rdap=rdap, today=date(2026, 10, 25))


async def test_the_live_sandbox_follows_redirects_reads_forms_and_asks_rdap() -> None:
    def answer(request: httpx.Request) -> httpx.Response:
        if request.url.host == "rb.gy":
            return httpx.Response(302, headers={"location": "https://evri-redelivery.co/pay"})
        if request.url.host == "evri-redelivery.co":
            return httpx.Response(200, headers={"content-type": "text/html"}, text=(
                "<html><title>Evri - pay your redelivery fee</title><form>"
                "<input name='cardnumber' autocomplete='cc-number'><input type='password' name='pw'>"
                "</form></html>"
            ))  # fmt: skip
        if request.url.host == "rdap.org":
            return httpx.Response(200, json={"events": [
                {"eventAction": "registration", "eventDate": "2026-10-16T09:00:00Z"}
            ]})  # fmt: skip
        return httpx.Response(404)

    report = await live(httpx.MockTransport(answer)).inspect("rb.gy", url="http://rb.gy/4k2q")

    assert report.host == "rb.gy" and not report.official
    assert set(report.findings) == {
        "redirects_to:evri-redelivery.co", "password_form", "card_form", "brand_page:evri",
        "new_domain:9",
    }  # fmt: skip
    assert assess(PARCEL, None, Evidence(sandbox=(report,))).level is Level.LIKELY_SCAM


async def test_the_live_sandbox_never_touches_private_addresses_and_caps_the_read() -> None:
    calls: list[str] = []

    def answer(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.host)
        return httpx.Response(
            200, headers={"content-type": "text/html"}, text="<html>" + "x" * 600_000
        )

    blocked = await live(httpx.MockTransport(answer), rdap=False).inspect("127.0.0.1")
    big = await live(httpx.MockTransport(answer), rdap=False).inspect("big-page.example")

    assert blocked.findings == ("blocked:private address",) and "127.0.0.1" not in calls
    assert big.findings == () and calls == ["big-page.example"]  # read once, capped, judged


async def test_the_live_sandbox_reports_trouble_as_a_finding() -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route", request=request)

    def loop(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "http://loop.example/again"})

    def apk(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, headers={"content-type": "application/vnd.android.package-archive"}, content=b"PK"
        )

    assert (await live(httpx.MockTransport(down), rdap=False).inspect("dead.example")).findings == (
        "unreachable",
    )
    assert (await live(httpx.MockTransport(loop), rdap=False).inspect("loop.example")).findings == (
        "unreachable",
    )
    assert (
        await live(httpx.MockTransport(apk), rdap=False).inspect(
            "loan.example", url="http://loan.example/app.apk"
        )
    ).findings == ("apk_download",)


def test_feeds_name_the_list_that_names_a_host() -> None:
    feeds = ThreatFeeds.from_directory(FIXTURES / "feeds")

    assert feeds.hits(["evri-redelivery.co", "www.quick-rupee-loan.top", "oxford.gov.uk"]) == {
        "evri-redelivery.co": "openphish", "www.quick-rupee-loan.top": "urlhaus",
    }  # fmt: skip
    assert feeds.summary()["openphish"] == {"entries": 3, "fetched_at": "2026-10-24T22:00:00+00:00"}
    assert ThreatFeeds.from_directory(FIXTURES / "nowhere").hits(["evri-redelivery.co"]) == {}


@pytest.mark.parametrize(
    ("line", "host"),
    [
        ("http://evri-redelivery.co/pay", "evri-redelivery.co"),
        ("https://www.secure-update.xyz:8443/x", "secure-update.xyz"),
        ("quick-rupee-loan.top", "quick-rupee-loan.top"),
        ("# a comment", ""),
        ("", ""),
    ],
)
def test_a_feed_line_becomes_a_registrable_host(line: str, host: str) -> None:
    assert host_of(line) == host


async def test_a_feed_hit_raises_the_verdict_and_says_which_list() -> None:
    feeds = ThreatFeeds.from_directory(FIXTURES / "feeds")
    text = "Watch tonight: https://secure-update.xyz/netflix/renew"
    hits = feeds.hits(["secure-update.xyz"])

    verdict = assess(text, None, Evidence(feed_hits=tuple(hits)))

    assert verdict.level is Level.LIKELY_SCAM and verdict.zone is Zone.WARN
    assert "a public list of phishing links names this one" in verdict.why
