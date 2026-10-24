"""Delay Spotter on a laptop: the iPhone shortcut's regexes and POST, replayed on fixtures.

The "Tempo Delay Spotter" shortcut (README.md) is Tempo's on-device signal filter for the
Clawback rail skill. This script applies the same regexes (fixtures/patterns.yaml) and the same
Stations dictionary (fixtures/stations.yaml) to sample alerts (fixtures/alerts.yaml), block for
block, and sends the identical POST /missions body to a Gateway.

    uv run python apps/shortcuts/delay_spotter.py check              # every fixture, offline
    uv run python apps/shortcuts/delay_spotter.py check --icu        # also through ICU (macOS)
    uv run python apps/shortcuts/delay_spotter.py payload gwr-sms-0812-delayed
    uv run python apps/shortcuts/delay_spotter.py send               # to a running Gateway
    uv run python apps/shortcuts/delay_spotter.py send --in-process  # boots a replay Gateway

`send` uses GATEWAY_URL (default http://127.0.0.1:8000) and TEMPO_API_TOKEN, the Gateway's
bearer token. It exits non-zero if any fixture doesn't get the answer its `expect` says.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import asdict, dataclass, replace
from datetime import date, datetime
from pathlib import Path
from typing import Any, Protocol

import httpx
import yaml
from pydantic import SecretStr

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"
MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
# In the README, each regex is a ```text block right after <!-- regex: name -->.
README_REGEX = re.compile(r"<!-- regex: (\w+) -->\s*```text\n\s*(.+?)\n\s*```")
FIELDS = (
    "outcome",
    "departure",
    "origin",
    "destination",
    "origin_crs",
    "destination_crs",
    "travel_date",
    "short_delay_minutes",
)


@dataclass(frozen=True)
class Alert:
    id: str
    channel: str
    received: datetime
    text: str  # what the shortcut sees: the message, or "<subject>\n<body>" for an email
    model_line: str | None
    expect: dict[str, Any]
    expect_with_model: dict[str, Any]

    @classmethod
    def from_fixture(cls, raw: dict[str, Any]) -> Alert:
        text = raw["text"] if "text" in raw else f"{raw['subject']}\n{raw['body']}"
        return cls(
            id=raw["id"],
            channel=raw["channel"],
            received=datetime.fromisoformat(raw["received"]),
            text=text,
            model_line=raw.get("model_line"),
            expect=raw["expect"],
            expect_with_model=raw.get("expect_with_model", raw["expect"]),
        )

    def seen(self, *, with_model: bool) -> str:
        """Block 2: the alert text. With Use Model, the model's line goes first."""
        if with_model and self.model_line:
            return f"{self.model_line}\n{self.text}"
        return self.text


@dataclass(frozen=True)
class Spotted:
    """What the shortcut found. Every field is filled in, even where the phone stops earlier."""

    outcome: str  # send | short_delay | unreadable | ignored
    departure: str | None = None
    origin: str | None = None
    destination: str | None = None
    origin_crs: str | None = None
    destination_crs: str | None = None
    travel_date: str | None = None
    short_delay_minutes: int | None = None


@dataclass(frozen=True)
class Settings:
    """What the person types into the shortcut's Get Contents of URL action, once."""

    user_id: str
    display_name: str
    phone: str
    fare_gbp: str
    time_value_gbp_h: str


def load_patterns() -> dict[str, re.Pattern[str]]:
    raw = yaml.safe_load((FIXTURES / "patterns.yaml").read_text())
    return {
        name: re.compile(p["regex"], 0 if p["case_sensitive"] else re.IGNORECASE)
        for name, p in raw.items()
    }


def load_stations() -> dict[str, str]:
    return {
        str(k): str(v) for k, v in yaml.safe_load((FIXTURES / "stations.yaml").read_text()).items()
    }


def load_alerts() -> list[Alert]:
    return [Alert.from_fixture(a) for a in yaml.safe_load((FIXTURES / "alerts.yaml").read_text())]


def group(pattern: re.Pattern[str], text: str, index: int) -> str | None:
    """Match Text, then Get Group at Index on the first match."""
    match = pattern.search(text)
    return match.group(index) if match else None


def nearest_date(written: str, today: date) -> date:
    """Format Date on "23 Oct": like Apple's date detection, the nearest such date to today."""
    found = re.match(r"(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)(?:\s+(\d{4}))?$", written.strip())
    if found is None:
        raise ValueError(f"not a date the date regex can produce: {written!r}")
    day, month = int(found[1]), MONTHS.index(found[2][:3].lower()) + 1
    if found[3]:
        return date(int(found[3]), month, day)
    years = (today.year - 1, today.year, today.year + 1)
    return min((date(y, month, day) for y in years), key=lambda d: abs(d - today))


def spot(
    text: str, received: datetime, rx: dict[str, re.Pattern[str]], stations: dict[str, str]
) -> Spotted:
    """The shortcut, block by block (README, "Build it by hand")."""
    departure = group(rx["departure"], text, 1)  # block 5
    origin, destination = group(rx["stations"], text, 1), group(rx["stations"], text, 2)  # 6
    written = group(rx["date"], text, 1)  # block 7
    travel_date = nearest_date(written, received.date()) if written else received.date()
    short = group(rx["short_delay"], text, 1)  # block 4
    found = Spotted(
        outcome="send",
        departure=departure.replace(".", ":") if departure else None,
        origin=origin,
        destination=destination,
        origin_crs=stations.get(origin) if origin else None,
        destination_crs=stations.get(destination) if destination else None,
        travel_date=travel_date.isoformat(),
        short_delay_minutes=int(short) if short else None,
    )
    if not rx["signal"].search(text):  # block 3
        return replace(found, outcome="ignored")
    if short:  # block 4
        return replace(found, outcome="short_delay")
    checked = f"{found.origin_crs} {found.destination_crs} {found.departure} {found.travel_date}"
    if not rx["check"].search(checked):  # block 8
        return replace(found, outcome="unreadable")
    return found


def payload(spotted: Spotted, settings: Settings) -> dict[str, str]:
    """Block 9: the JSON body of Get Contents of URL. Nothing else leaves the phone."""
    return {
        "user_id": settings.user_id,
        "display_name": settings.display_name,
        "phone": settings.phone,
        "origin_crs": spotted.origin_crs or "",
        "destination_crs": spotted.destination_crs or "",
        "travel_date": spotted.travel_date or "",
        "departure": spotted.departure or "",
        "fare_gbp": settings.fare_gbp,
        "time_value_gbp_h": settings.time_value_gbp_h,
    }


def cases(alerts: list[Alert]) -> Iterator[tuple[Alert, bool]]:
    """Every alert as an older iPhone sees it, plus with Use Model where we have a model line."""
    for alert in alerts:
        yield alert, False
        if alert.model_line:
            yield alert, True


def check(alerts: list[Alert], rx: dict[str, re.Pattern[str]], stations: dict[str, str]) -> int:
    failures = 0
    for alert, with_model in cases(alerts):
        spotted = asdict(spot(alert.seen(with_model=with_model), alert.received, rx, stations))
        expected = alert.expect_with_model if with_model else alert.expect
        wrong = {f: (spotted[f], expected.get(f)) for f in FIELDS if spotted[f] != expected.get(f)}
        label = f"{alert.id}{' +model' if with_model else ''}"
        if wrong:
            failures += 1
            detail = ", ".join(
                f"{f}={got!r} (expected {want!r})" for f, (got, want) in wrong.items()
            )
            print(f"FAIL {label}: {detail}")
        else:
            print(f"ok   {label:44} {_summary(spotted)}")
    total = sum(1 for _ in cases(alerts))
    print(f"\n{total - failures}/{total} extractions match fixtures/alerts.yaml")
    return failures + readme_check()


def readme_check() -> int:
    """The regexes people copy from the README must be the ones tested here."""
    raw = yaml.safe_load((FIXTURES / "patterns.yaml").read_text())
    shown = dict(README_REGEX.findall((HERE / "README.md").read_text()))
    wrong = sorted(name for name, p in raw.items() if shown.get(name) != p["regex"])
    if wrong:
        print(f"README regexes differ from fixtures/patterns.yaml: {', '.join(wrong)}")
    else:
        print(f"README shows all {len(raw)} regexes exactly as tested")
    return len(wrong)


def _summary(s: dict[str, Any]) -> str:
    route = f"{s['origin'] or '?'} -> {s['destination'] or '?'}"
    crs = f"{s['origin_crs'] or '???'}-{s['destination_crs'] or '???'}"
    return f"{s['outcome']:11} {s['departure'] or '--:--'} {s['travel_date']} {crs} ({route})"


# ICU cross-check -------------------------------------------------------------------------------
# Shortcuts' Match Text runs on NSRegularExpression (ICU). JXA reaches the same class on macOS,
# so we can show that every pattern finds the same matches and groups there as in Python, and
# that Apple's date detection reads each "23 Oct" the way nearest_date() does.

ICU_JS = r"""
ObjC.import("Foundation");
function run(argv) {
  var input = JSON.parse($.NSString.stringWithContentsOfFileEncodingError(
    argv[0], $.NSUTF8StringEncoding, null).js);
  var cases = input.cases.map(function (c) {
    var re = $.NSRegularExpression.regularExpressionWithPatternOptionsError(
      c.regex, c.case_sensitive ? 0 : 1, null);
    if (re.isNil()) return {error: "ICU rejected the pattern"};
    var s = $(c.text), length = Number(s.length);
    var all = re.matchesInStringOptionsRange(s, 0, $.NSMakeRange(0, length));
    var out = {count: Number(all.count), groups: null};
    if (out.count > 0) {
      var m = all.objectAtIndex(0);
      out.groups = [];
      for (var i = 1; i < Number(m.numberOfRanges); i++) {
        var r = m.rangeAtIndex(i);  // NSNotFound when the group took no part
        out.groups.push(Number(r.location) > length ? null : s.substringWithRange(r).js);
      }
    }
    return out;
  });
  var detector = $.NSDataDetector.dataDetectorWithTypesError($.NSTextCheckingTypeDate, null);
  var format = $.NSDateFormatter.alloc.init;
  format.dateFormat = $("yyyy-MM-dd");
  var dates = input.dates.map(function (t) {
    var s = $(t);
    var m = detector.firstMatchInStringOptionsRange(s, 0, $.NSMakeRange(0, s.length));
    return m.isNil() ? null : format.stringFromDate(m.date).js;
  });
  return JSON.stringify({cases: cases, dates: dates});
}
"""


def icu_check(alerts: list[Alert]) -> int:
    if shutil.which("osascript") is None:
        print("--icu needs macOS (osascript); skipped")
        return 0
    raw = yaml.safe_load((FIXTURES / "patterns.yaml").read_text())
    texts = sorted({a.seen(with_model=m) for a, m in cases(alerts)})
    work = [
        (name, text, {"regex": p["regex"], "case_sensitive": p["case_sensitive"], "text": text})
        for name, p in raw.items()
        for text in texts
    ]
    rx = load_patterns()
    written = sorted({w for t in texts if (w := group(rx["date"], t, 1))})
    with tempfile.TemporaryDirectory() as tmp:
        script, data = Path(tmp) / "icu.js", Path(tmp) / "cases.json"
        script.write_text(ICU_JS)
        data.write_text(json.dumps({"cases": [c for _, _, c in work], "dates": written}))
        result = subprocess.run(  # noqa: S603 - fixed argv, our own script and data
            ["osascript", "-l", "JavaScript", str(script), str(data)],  # noqa: S607
            capture_output=True,
            text=True,
            check=True,
        )
    icu = json.loads(result.stdout)
    failures = 0
    for (name, text, _), got in zip(work, icu["cases"], strict=True):
        matches = list(rx[name].finditer(text))
        want = {"count": len(matches), "groups": list(matches[0].groups()) if matches else None}
        if got != want:
            failures += 1
            print(f"ICU DIFF {name} on {text[:40]!r}: ICU {got}, Python {want}")
    today = date.today()
    for text, detected in zip(written, icu["dates"], strict=True):
        if detected != nearest_date(text, today).isoformat():
            failures += 1
            print(f"DATE DIFF {text!r}: Apple {detected}, Python {nearest_date(text, today)}")
    if failures:
        print(f"ICU: {failures} difference(s) from Python")
    else:
        print(f"ICU: all {len(work)} pattern runs and {len(written)} date readings match Python")
    return failures


# Sending ---------------------------------------------------------------------------------------


class Reply(Protocol):
    @property
    def status_code(self) -> int: ...
    def json(self) -> Any: ...


class Gateway(Protocol):
    """httpx.Client, or Starlette's TestClient (which is built on its own httpx fork)."""

    def post(self, url: str, *, json: Any) -> Reply: ...


@contextmanager
def gateway_client(*, in_process: bool) -> Iterator[Gateway]:
    token = os.environ.get("TEMPO_API_TOKEN") or ("replay-demo-token" if in_process else "")
    if not token:
        sys.exit("Set TEMPO_API_TOKEN to the Gateway's bearer token (or use --in-process).")
    headers = {"Authorization": f"Bearer {token}"}
    if not in_process:
        url = os.environ.get("GATEWAY_URL", "http://127.0.0.1:8000")
        with httpx.Client(base_url=url, headers=headers, timeout=30) as client:
            yield client
        return
    # The same app `uv run tempo-gateway` serves, in replay mode, inside this process.
    from fastapi.testclient import TestClient

    from tempo_adapters.settings import Settings as GatewaySettings
    from tempo_gateway.main import build

    with tempfile.TemporaryDirectory() as checkpoints:
        settings = GatewaySettings(
            tempo_mode="replay",
            tempo_api_token=SecretStr(token),
            checkpoint_dir=checkpoints,
            database_url=None,
            langfuse_public_key=None,
            langfuse_secret_key=None,
        )
        with TestClient(build(settings), headers=headers) as client:
            yield client


def send(
    client: Gateway,
    alerts: list[Alert],
    settings: Settings,
    *,
    with_model: bool,
) -> int:
    rx, stations = load_patterns(), load_stations()
    failures = 0
    for alert in alerts:
        spotted = spot(alert.seen(with_model=with_model), alert.received, rx, stations)
        expected = (alert.expect_with_model if with_model else alert.expect).get("gateway")
        if spotted.outcome != "send":
            print(f"\n{alert.id}: {spotted.outcome}, so nothing leaves the phone")
            continue
        body = payload(spotted, settings)
        print(f"\n{alert.id}\n  -> POST /missions {json.dumps(body)}")
        response = client.post("/missions", json=body)
        view = response.json()
        state = view.get("state")
        message = view.get("message") or view.get("detail")
        print(f"  <- {response.status_code} {state}: {message}")
        if state == "awaiting_consent":
            ask = view["ask"]
            print(f"  consent ask: £{ask['amount_gbp']}, waiting on request {ask['request_id']}")
        if expected and not _as_expected(view, expected):
            failures += 1
            print(f"  FAIL expected {expected}")
    return failures


def _as_expected(view: dict[str, Any], expected: dict[str, Any]) -> bool:
    if view.get("state") != expected["state"]:
        return False
    if (
        "amount_gbp" in expected
        and (view.get("ask") or {}).get("amount_gbp") != expected["amount_gbp"]
    ):
        return False
    return expected.get("message_contains", "") in (view.get("message") or "")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0] if __doc__ else None)
    commands = parser.add_subparsers(dest="command", required=True)
    check_cmd = commands.add_parser("check", help="extract every fixture and compare")
    check_cmd.add_argument("--icu", action="store_true", help="also run the regexes through ICU")
    show = commands.add_parser("payload", help="print what the shortcut would send")
    send_cmd = commands.add_parser("send", help="POST to the Gateway like the shortcut does")
    try_cmd = commands.add_parser("try", help="run the shortcut's logic on a text you paste")
    try_cmd.add_argument("text", help="the alert text, or - to read it from stdin")
    try_cmd.add_argument("--received", help="when it arrived, ISO 8601 (default: now)")
    try_cmd.add_argument("--send", action="store_true", help="also POST it to the Gateway")
    for cmd in (show, send_cmd):
        cmd.add_argument("ids", nargs="*", help="fixture ids (default: all)")
        cmd.add_argument("--model", action="store_true", help="as with the Use Model step")
    for cmd in (send_cmd, try_cmd):
        cmd.add_argument("--in-process", action="store_true", help="boot a replay Gateway here")
    for cmd in (show, send_cmd, try_cmd):
        cmd.add_argument("--user-id", default="u_amir")
        cmd.add_argument("--name", default="Amir")
        cmd.add_argument(
            "--phone", default="", help="optional, for SMS YES/NO (only its hash is kept)"
        )
        cmd.add_argument("--fare", default="28.40", help="fare_gbp, set once in the shortcut")
        cmd.add_argument("--time-value", default="18", help="time_value_gbp_h")
    args = parser.parse_args(argv)

    alerts = load_alerts()
    if args.command == "check":
        failures = check(alerts, load_patterns(), load_stations())
        if args.icu:
            failures += icu_check(alerts)
        return 1 if failures else 0
    settings = Settings(args.user_id, args.name, args.phone, args.fare, args.time_value)
    if args.command == "try":
        return try_text(args, settings)
    if args.ids:
        unknown = set(args.ids) - {a.id for a in alerts}
        if unknown:
            sys.exit(f"unknown fixture(s): {', '.join(sorted(unknown))}")
        alerts = [a for a in alerts if a.id in args.ids]
    if args.command == "payload":
        rx, stations = load_patterns(), load_stations()
        for alert in alerts:
            spotted = spot(alert.seen(with_model=args.model), alert.received, rx, stations)
            sent = payload(spotted, settings) if spotted.outcome == "send" else None
            print(json.dumps({"id": alert.id, "outcome": spotted.outcome, "sends": sent}))
        return 0
    with gateway_client(in_process=args.in_process) as client:
        failures = send(client, alerts, settings, with_model=args.model)
    print(f"\n{'all as expected' if not failures else f'{failures} unexpected answer(s)'}")
    return 1 if failures else 0


def try_text(args: argparse.Namespace, settings: Settings) -> int:
    """`try`: what the phone would make of one alert, e.g. a real one from your operator."""
    text = sys.stdin.read() if args.text == "-" else args.text
    received = (
        datetime.fromisoformat(args.received) if args.received else datetime.now().astimezone()
    )
    alert = Alert("pasted", "sms", received, text, None, {}, {})
    spotted = spot(text, received, load_patterns(), load_stations())
    print(_summary(asdict(spotted)))
    if spotted.outcome == "send":
        print(f"sends: {json.dumps(payload(spotted, settings))}")
    if not args.send:
        return 0 if spotted.outcome == "send" else 1
    with gateway_client(in_process=args.in_process) as client:
        send(client, [alert], settings, with_model=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
