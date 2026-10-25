"""A corpus of realistic UK rail notifications (from the round-3 review) and what the hub must read in each.
want: minutes late / 'cancelled' / 'part' (part cancelled: a disruption, not a full cancellation) / 'delayed'
(no minutes) / None (not a disruption); plus the departure and destination of the person's own train."""
import os
import tempfile

os.environ["TEMPO_DB"] = os.path.join(tempfile.mkdtemp(prefix="tempo-test-"), "unused.db")  # never data/
os.environ["TEMPO_LLM_BASE_URL"] = "http://127.0.0.1:9"
os.environ.pop("TEMPO_NOTIFY_APPS", None)

import pytest  # noqa: E402

from hub import memory  # noqa: E402

P = "London Paddington"
cases = [
    # --- delays, various phrasings
    ("GWR", "Your 08:12 to London Paddington", "is delayed by 34 minutes", (34, "08:12", P)),
    ("GWR", "Your 08:12 to London Paddington", "is running about 10 minutes late", (10, "08:12", P)),
    ("GWR", "Your 08:12 to London Paddington", "is delayed by 1hr 10min", (70, "08:12", P)),
    ("GWR", "Your 08:12 to London Paddington", "is delayed by 1h 10m", (70, "08:12", P)),
    ("Trainline", "Delayed", "Your 08:12 to London Paddington is delayed 25 mins", (25, "08:12", P)),
    ("Trainline", "Delay", "There is a 34 minute delay to your 08:12 to London Paddington", (34, "08:12", P)),
    ("National Rail", "Delay: 34 mins", "08:12 to London Paddington", (34, "08:12", P)),
    ("GWR", "Your 08:12 to London Paddington", "Delayed. Expected: 08:53", (41, "08:12", P)),
    ("GWR", "Your 08:12 to London Paddington", "Delayed - Exp. 08:53", (41, "08:12", P)),
    ("GWR", "Your 08:12 to London Paddington", "is delayed and will now depart at 08:40", (28, "08:12", P)),
    ("GWR", "Your 08:12 to London Paddington", "is delayed. Arrival at Paddington now expected 09:52 (was 09:30)", (22, "08:12", P)),
    ("LNER", "Service update", "We're sorry, the 10:00 London King's Cross to Edinburgh is delayed by 25 minutes", (25, "10:00", "Edinburgh")),
    ("Avanti", "Your 6.15pm to Manchester Piccadilly", "is delayed by 20 mins", (20, "18:15", "Manchester Piccadilly")),
    ("Avanti", "Your 6:15 p.m. to Manchester Piccadilly", "is delayed by 20 mins", (20, "18:15", "Manchester Piccadilly")),
    ("Trainline", "Your 12:05am to Reading", "is delayed by 15 minutes", (15, "00:05", "Reading")),
    ("GWR", "Your 08.12 service to Bristol Temple Meads", "is running 15 mins late", (15, "08:12", "Bristol Temple Meads")),
    ("GWR", "Your 08:12 to Cardiff Central - Delayed", "now expected 08:30", (18, "08:12", "Cardiff Central")),
    ("GWR", "Your 08:12 to London Paddington via Reading", "is delayed by 20 minutes", (20, "08:12", None)),
    ("Trainline", "Your 08:12 London Paddington to Bristol Temple Meads train", "is delayed by 12 minutes", (12, "08:12", "Bristol Temple Meads")),
    ("Trainline", "Delayed", "08:12 London Paddington to Bristol Temple Meads is delayed by 12 minutes", (12, "08:12", "Bristol Temple Meads")),
    # --- cancellations / partial
    ("GWR", "Your 08:12 to London Paddington", "is now cancelled", ("cancelled", "08:12", P)),
    ("GWR", "Cancellation", "The 08:12 to London Paddington will not run today", ("cancelled", "08:12", P)),
    ("GWR", "Your 08:12 to London Paddington", "is part cancelled and will terminate at Reading", ("part", "08:12", P)),
    ("GWR", "Your 08:12 to London Paddington", "will start from Swindon instead of Bristol Temple Meads today", ("part", "08:12", P)),
    ("GWR", "Your 08:12 to London Paddington", "has not been cancelled and will run as planned", (None, "08:12", P)),
    ("GWR", "Your 08:12 to London Paddington", "has been reinstated and will run as planned", (None, "08:12", P)),
    # --- not disruptions
    ("GWR", "Your 08:12 to London Paddington", "departs in 20 minutes from platform 4. Don't be late!", (None, "08:12", P)),
    ("Trainline", "Platform change", "Your 08:12 to London Paddington will now depart from platform 2", (None, "08:12", P)),
    ("Trainline", "Good to go", "Your 08:12 to London Paddington: no delays reported", (None, "08:12", P)),
    ("GWR", "Your 08:12 to London Paddington", "is not delayed", (None, "08:12", P)),
    ("GWR", "Your 08:12 to London Paddington", "could be up to 20 minutes late due to a signalling fault", (None, "08:12", P)),
    ("National Rail", "Disruption between Reading and Didcot", "Trains may be running up to 30 minutes late. Your 08:12 to London Paddington may be affected", (None, "08:12", P)),
    ("GWR", "Delay Repay claim received", "We've received your claim for the 08:12 to London Paddington on 20 Oct, which arrived 34 minutes late", (None, "08:12", P)),
    ("GWR", "Delay Repay paid", "£14.20 is on its way for your 08:12 to London Paddington (34 mins late on 20 Oct)", (None, "08:12", P)),
    ("GWR", "Bus replacement", "Your 08:12 to Oxford: buses replace trains between Didcot Parkway and Oxford", (None, "08:12", "Oxford")),
    ("GWR", "Your 08:12 to London Paddington", "is now running to time", (None, "08:12", P)),
    ("Trainline", "Journey reminder", "Your 08:12 to London Paddington leaves tomorrow. Check for delays before you travel", (None, "08:12", P)),
    ("Trainline", "Price alert", "Advance fares from £14.20 on the 08:12 to London Paddington", (None, "08:12", P)),
    # --- two trains in one alert
    ("Trainline", "Journey update", "Your 08:12 to London Paddington is delayed by 25 minutes. Your connection, the 09:30 to Oxford, is on time", (25, "08:12", P)),
    # --- TfL / Elizabeth line
    ("TfL", "Elizabeth line", "Minor delays between Paddington and Abbey Wood", (None, None, None)),
    ("TfL", "Elizabeth line", "The 08:12 to Abbey Wood is cancelled", ("cancelled", "08:12", "Abbey Wood")),
    ("Northern", "Your 07:40 to Leeds", "is delayed by 12 minutes", (12, "07:40", "Leeds")),
]

cases += [
    ("GWR", "Following the cancellation of the 07:50", "your 08:12 to London Paddington is delayed by 15 minutes", (15, "08:12", P)),
    ("GWR", "Changes to your journey", "Your 08:12 to London Paddington is delayed by 20 minutes", (20, "08:12", P)),
    ("Trainline", "Welcome to Trainline", "Your 18:05 to Oxford is delayed by 10 minutes", (10, "18:05", "Oxford")),
    ("GWR", "Your 06:15 to London Paddington tomorrow", "has been cancelled due to strike action", ("cancelled", "06:15", P)),
    ("GWR", "Your 08:12 to St. Ives", "is running 12 minutes late", (12, "08:12", "St. Ives")),
    ("GWR", "Your 8:12am train to Bristol Temple Meads", "is delayed by 34 mins", (34, "08:12", "Bristol Temple Meads")),
    ("GWR", "Your 08:12 to London Paddington", "is delayed by 34 minutes. You may be entitled to Delay Repay compensation", (34, "08:12", P)),
    ("GWR", "Your 08:12 to London Paddington", "is delayed by 1 hour 5 minutes", (65, "08:12", P)),
    ("GWR", "Your 08:12 to London Paddington", "is no longer delayed and will depart on time", (None, "08:12", P)),
    ("Trainline", "Running late?", "Change your ticket in the app in seconds", (None, None, None)),
]


@pytest.mark.parametrize("app,title,text,want", cases, ids=[f"{c[0]}:{c[1][:20]}|{c[2][:30]}" for c in cases])
def test_rail_corpus(app, title, text, want):
    outcome, dep, dest = want
    ev = {"kind": "notification.signal", "payload": {"app": app, "title": title, "text": text}}
    f, d = memory.rail_fields(ev), memory.rail_disruption(ev)
    got = None if not d else ("part" if d.get("part_cancelled") else d["delay_min"] or ("cancelled" if d["cancelled"] else "delayed"))
    assert got == outcome
    if dep:
        assert f.get("departure") == dep
    if dest:
        assert f.get("destination") == dest


# The round-4 fuzzer's 96 synthetic alerts (tests/rail_fuzz_corpus.json), with the reading the reviewer expected.
import json  # noqa: E402
from pathlib import Path  # noqa: E402

FUZZ = json.loads((Path(__file__).parent / "rail_fuzz_corpus.json").read_text())


@pytest.mark.parametrize("k", FUZZ, ids=[f"fuzz{i}" for i in range(len(FUZZ))])
def test_rail_fuzz_corpus(k):
    outcome, dep, dest = k["want"]
    ev = {"kind": "notification.signal", "payload": {"app": k["app"], "title": k["title"], "text": k["text"]}}
    f, d = memory.rail_fields(ev), memory.rail_disruption(ev)
    got = None if not d else ("part" if d.get("part_cancelled") else d["delay_min"] or ("cancelled" if d["cancelled"] else "delayed"))
    assert (got, f.get("departure"), f.get("destination") or None) == (outcome, dep, dest)


# Round 5: 41 alerts a fresh fuzzer wrote that earlier parsers misread. The parser must never turn any of them into a
# wrong high-confidence Delay Repay claim; most must now read exactly right, and the rest are listed as known misses.
R5 = json.loads((Path(__file__).parent / "rail_fuzz_corpus_r5.json").read_text())


def _outcome(d):
    return None if not d else "cancelled" if d["cancelled"] else "part" if d.get("part_cancelled") else d["delay_min"] or "delayed"


@pytest.mark.parametrize("k", R5, ids=[f"r5-{i}" for i in range(len(R5))])
def test_round5_alerts_never_make_a_wrong_claim(k):
    ev = {"kind": "notification.signal", "payload": {"app": k["app"], "title": k["title"], "text": k["text"]}}
    f, d = memory.rail_fields(ev), memory.rail_disruption(ev)
    claim = bool(d) and f["confidence"] == "high" and memory.delay_repay_pct(d["delay_min"], d["cancelled"]) > 0
    if claim:
        assert _outcome(d) == k["want"][0], "a high-confidence claim must be for the right delay"
    if not k["known_miss"]:
        assert (_outcome(d), f.get("departure"), f.get("destination") or None) == tuple(k["want"])


def test_known_misses_are_few():
    assert sum(k["known_miss"] for k in R5) <= 2  # today: 1 (an alert about two of your own trains)
