#!/usr/bin/env python3
"""Pretend to be a Nothing Phone (Health Connect app), an iPhone (Health Auto Export), OwnTracks and
a GWR delay notification (Tasker), so the demo works before real devices are set up.
Everything is sent with ?simulated=1: the hub marks each event payload._simulated=true and its
source '<app>:simulated', and the web page shows a 'simulated' pill.

    python scripts/simulate.py http://127.0.0.1:8787 <ingest_key>
    python scripts/simulate.py http://127.0.0.1:8787 <ingest_key> --clock-change   # also the two 01:30s
    python scripts/simulate.py '<an app URL copied from the page>'                 # hub + key in one
(the full app URLs are on the web page under "Add another device or app", or POST /api/integrations/reveal)

Times are the home zone's (TEMPO_HOME_TZ, default Europe/London), so offsets stay right after the
clocks go back. --clock-change sends one reading at 01:30 BST and one at 01:30 GMT on the night the
clocks go back (last night's within a week, else the next): the hub keeps them as two events an hour apart.
"""
from __future__ import annotations

import json
import os
import random
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

HOME = ZoneInfo(os.environ.get("TEMPO_HOME_TZ", "Europe/London"))


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def post(url: str, body) -> dict | list:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:  # e.g. 401 bad key, 410 app removed (blocked) in Tempo
        return {"error": e.code, "detail": e.read().decode(errors="replace")[:300]}
    except (urllib.error.URLError, OSError) as e:
        sys.exit(f"Hub not reachable at {url.split('/api/')[0]} ({getattr(e, 'reason', e)}). "
                 "Is it running, and is this computer on the same network?")


def health_connect_body(now: datetime) -> dict:
    """Exactly what HC Webhook sends (Galaxy Watch via Samsung Health, CMF watch via Gadgetbridge,
    Garmin via Garmin Connect), from a phone set to the home zone."""
    midnight = now.astimezone(HOME).replace(hour=0, minute=0, second=0, microsecond=0)
    return {
        "timestamp": iso(now), "app_version": "1.9.31", "timezone": HOME.key,
        "steps": [{"count": random.randint(4000, 9000), "start_time": iso(midnight), "end_time": iso(now)}],
        "heart_rate": [{"time": iso(now - timedelta(minutes=10 * i)), "avg": (b := random.randint(58, 92)),
                        "min": b - 3, "max": b + 4, "bpm": b,
                        "metadata": {"data_origin": "nodomain.freeyourgadget.gadgetbridge", "id": f"sim-hr-{i}",
                                     "device": {"manufacturer": "Nothing", "model": "CMF Watch Pro 2"}}}
                       for i in range(6)],
        "sleep": [{"session_end_time": iso(now - timedelta(hours=9)), "duration_seconds": 25200,
                   "stages": [{"stage": "4", "start_time": iso(now - timedelta(hours=16)), "duration_seconds": 12600},
                              {"stage": "5", "start_time": iso(now - timedelta(hours=12, minutes=30)), "duration_seconds": 5400},
                              {"stage": "6", "start_time": iso(now - timedelta(hours=11)), "duration_seconds": 7200}],
                   "metadata": {"data_origin": "com.sec.android.app.shealth", "id": "sim-sleep-1",
                                "device": {"manufacturer": "Samsung", "model": "Galaxy Watch"}}}],
        "exercise": [{"type": "56", "title": "Morning run", "start_time": iso(now - timedelta(hours=5)),
                      "end_time": iso(now - timedelta(hours=4, minutes=28)), "duration_seconds": 1930,
                      "distance_meters": 5012.4, "steps": 5230,
                      "metadata": {"data_origin": "com.garmin.android.apps.connectmobile", "id": "sim-run-1"}}],
    }


def health_auto_export_body(now: datetime) -> dict:
    """Health Auto Export (Apple Watch). Its dates carry the phone's offset at that moment:
    +0100 before tonight's clock change, +0000 after."""
    when = (now - timedelta(hours=8)).astimezone(HOME).strftime("%Y-%m-%d %H:%M:%S %z")
    return {"data": {"metrics": [
        {"name": "sleep_analysis", "units": "hr",
         "data": [{"date": when, "totalSleep": 6.8, "deep": 1.1, "rem": 1.4, "core": 4.3, "source": "Apple Watch"}]},
        {"name": "resting_heart_rate", "units": "count/min",
         "data": [{"date": when, "qty": 61, "source": "Apple Watch"}]},
    ], "workouts": []}}


def owntracks_body(now: datetime) -> dict:
    """OwnTracks location: Oxford, Mathematical Institute."""
    return {"_type": "location", "lat": 51.7600, "lon": -1.2580, "acc": 12, "batt": 64,
            "tst": int(now.timestamp()), "tid": "np"}


def tasker_body(now: datetime) -> dict:
    """A rail-delay notification as Tasker/AutoNotification posts it. It is stored as ONE
    notification.signal event, trust untrusted-external (third-party text), class vault."""
    return {"kind": "notification.signal", "app": "GWR", "title": "Your 08:12 to London Paddington",
            "text": "is delayed by 34 minutes", "time": now.astimezone(HOME).isoformat(timespec="seconds"),
            "tz": HOME.key}


def repeated_hour(now: datetime, zone: ZoneInfo = HOME, days: int = 400, back: int = 7) -> datetime | None:
    """The local wall time at which the hour that happens twice in `zone` starts: the last clock
    change if it was in the past `back` days (so Sunday morning still shows last night's), else the next."""
    t = now.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0) - timedelta(days=back)
    for _ in range((days + back) * 24):
        t += timedelta(hours=1)
        before, after = (t - timedelta(hours=1)).astimezone(zone), t.astimezone(zone)
        if after.utcoffset() < before.utcoffset():  # the clocks went back at t: the wall clock
            return after.replace(tzinfo=None)       # now replays the hour it just showed
    return None


def clock_change_body(now: datetime) -> list[dict] | None:
    """Two readings at the same wall-clock time, 01:30 BST then 01:30 GMT (fold earlier / later),
    on the night of the clock change, as naive local times with tz + fold: the way an app that only
    knows the wall clock sends them."""
    start = repeated_hour(now)
    if start is None:
        return None
    local = (start + timedelta(minutes=30)).isoformat(timespec="seconds")
    return [{"kind": "health.heart_rate", "value": 58, "unit": "bpm", "time": local, "tz": HOME.key, "fold": "earlier"},
            {"kind": "health.heart_rate", "value": 61, "unit": "bpm", "time": local, "tz": HOME.key, "fold": "later"}]


def hub_and_key(args: list[str]) -> tuple[str, str] | None:
    """(hub, key) from '<hub> <key>', or from one app URL copied from the page (…/api/ingest/x?key=…)."""
    if len(args) >= 2:
        return args[0].rstrip("/"), args[1]
    if len(args) == 1 and "/api/ingest/" in args[0]:
        url = urllib.parse.urlsplit(args[0])
        key = urllib.parse.parse_qs(url.query).get("key", [""])[0]
        if key and "•" not in key:
            return f"{url.scheme}://{url.netloc}", key
    return None


def main() -> None:
    parsed = hub_and_key([a for a in sys.argv[1:] if not a.startswith("--")])
    if not parsed:
        sys.exit(__doc__ + "\n(A masked URL with •••••• won't do: copy the full one.)")
    hub, key = parsed
    now = datetime.now(timezone.utc)
    url = lambda source: f"{hub}/api/ingest/{source}?key={key}&simulated=1"  # noqa: E731
    print("health-connect:", post(url("health-connect"), health_connect_body(now)))
    print("health-auto-export:", post(url("health-auto-export"), health_auto_export_body(now)))
    print("owntracks:", post(url("owntracks"), owntracks_body(now)))
    print("tasker:", post(url("tasker"), tasker_body(now)))
    if "--clock-change" in sys.argv:
        body = clock_change_body(now)
        if body is None:
            print(f"clock-change: {HOME.key} has no repeated hour in the next year")
        else:
            print(f"clock-change ({body[0]['time']} twice in {HOME.key}):", post(url("shortcut"), body))


if __name__ == "__main__":
    main()
