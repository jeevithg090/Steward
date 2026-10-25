"""Forgetting a profile fact forgets its whole topic (re-check H), and "Forget me" no longer blocks new records (J)."""
import os
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone

os.environ["TEMPO_DB"] = os.path.join(tempfile.mkdtemp(prefix="tempo-test-"), "unused.db")  # never data/
os.environ["TEMPO_TEST_CLIENT_IP"] = "127.0.0.1"
os.environ["TEMPO_MDNS"] = "0"
os.environ["TEMPO_LLM_BASE_URL"] = "http://127.0.0.1:9"
os.environ["TEMPO_HOME_TZ"] = "Europe/London"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import db, main  # noqa: E402
from scripts import reset_demo  # noqa: E402


@pytest.fixture()
def client(tmp_path):
    db.init(tmp_path / "f.db")
    with TestClient(main.app) as c:
        yield c
    main._join_window.update(until=0.0, by=None)


@pytest.fixture()
def me(client):
    r = client.post("/api/devices/register", json={"name": "laptop"})
    return {"Authorization": f"Bearer {r.json()['device_token']}"}


def ago(minutes):
    t = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    return t.isoformat(timespec="seconds").replace("+00:00", "Z")


def hr(bpm, minutes):
    return {"kind": "health.heart_rate", "payload": {"bpm": bpm}, "event_time": ago(minutes)}


def post(client, me, evs):
    r = client.post("/api/events", headers=me, json={"events": evs})
    assert r.status_code == 200, r.text
    return r.json()


def fact(client, me, label):
    return next((f for f in client.get("/api/profile", headers=me).json()["facts"] if f["fact"].startswith(label)), None)


def test_forgetting_a_fact_forgets_the_topic_so_the_next_reading_cannot_replace_it(client, me):
    hrv = {"kind": "health.heart_rate_variability", "payload": {"ms": 40}, "event_time": ago(5)}
    first = hr(71, 10)
    post(client, me, [first, hr(88, 30), hrv])
    f = fact(client, me, "latest heart rate")
    assert f["forget"] == {"kinds": ["health.heart_rate", "health.resting_heart_rate"], "label": "Forget all heart-rate data"}
    r = client.post("/api/forget", headers=me, json={"kinds": f["forget"]["kinds"]})
    assert r.status_code == 200 and r.json()["deleted_events"] == 2
    assert fact(client, me, "latest heart rate") is None  # 88 bpm did not take 71's place
    kinds = [e["kind"] for e in client.get("/api/events?after=0", headers=me).json()["events"]]
    assert "health.heart_rate_variability" in kinds and "health.heart_rate" not in kinds  # exact kinds, not a prefix
    receipt = [e for e in client.get("/api/events?after=0", headers=me).json()["events"] if e["kind"] == "forget.done"][-1]
    assert receipt["payload"]["kinds"] == ["health.heart_rate", "health.resting_heart_rate"]
    again = post(client, me, [first])
    assert again["accepted"] == 0 and again["forgotten"] == 1  # a re-sent copy stays forgotten
    assert post(client, me, [hr(64, 1)])["accepted"] == 1  # a new reading still arrives


def test_forget_kinds_is_validated(client, me):
    assert client.post("/api/forget", headers=me, json={"kinds": ["%"]}).status_code == 422
    assert client.post("/api/forget", headers=me, json={"kinds": ["health.heart_rate"], "ids": ["#1"]}).status_code == 400
    assert client.post("/api/forget", headers=me, json={"kinds": ["health.steps"], "all": True}).status_code == 400
    with pytest.raises(ValueError):
        db.forget(db.owner()["id"], kinds=["  "])  # an empty selector must never mean "everything"


def test_forget_me_does_not_block_new_records_and_reset_demo_clears_tombstones(client, me, monkeypatch, capsys):
    old = {"kind": "location.point", "payload": {"lat": 51.7}, "event_time": "2026-01-01T09:00:00Z"}
    post(client, me, [old])
    assert client.post("/api/forget", headers=me, json={"all": True}).status_code == 200
    again = post(client, me, [old])
    assert again["duplicates"] == 1 and again["forgotten"] == 1  # the forgotten record stays forgotten
    history = {"kind": "location.point", "payload": {"lat": 51.75}, "event_time": "2026-01-01T08:00:00Z"}
    assert post(client, me, [history])["accepted"] == 1  # a new phone's older history is not swallowed
    monkeypatch.setattr(sys, "argv", ["reset_demo.py", "--yes"])
    reset_demo.main()
    assert "Cleared" in capsys.readouterr().out
    assert post(client, me, [old])["accepted"] == 1  # re-seeding works after the reset


def test_forgetting_a_notification_also_forgets_the_suggestion_made_from_it(client, me, monkeypatch):
    sent = []
    monkeypatch.setattr(main, "_post_to_conductor", lambda url, body: sent.append(body))
    monkeypatch.setenv("TEMPO_CONDUCTOR_URL", "http://127.0.0.1:9/conductor")
    gwr = {"app": "GWR", "title": "Your 08:12 to London Paddington", "text": "is delayed by 34 minutes"}
    key = db.owner()["ingest_key"]
    assert client.post(f"/api/ingest/tasker?key={key}&simulated=1", json=gwr).json()["suggested"] == 1
    evs = client.get("/api/events?after=0", headers=me).json()["events"]
    note = next(e for e in evs if e["kind"] == "notification.signal")
    sug = next(e for e in evs if e["kind"] == "mission.suggested")
    sig = next(e for e in evs if e["kind"] == "signal.rail_delay")
    sent.clear()
    r = client.post("/api/forget", headers=me, json={"ids": [f"#{note['hub_seq']}"]})
    assert r.json()["deleted_events"] == 3  # the notification, its L1 signal and the suggestion
    assert [h["kind"] for h in db.search(db.owner()["id"], "train delay")] == []  # MCP can't find it any more
    receipt = [e for e in client.get("/api/events?after=0", headers=me).json()["events"] if e["kind"] == "forget.done"][-1]
    assert sorted(receipt["payload"]["derived_refs"]) == sorted([f"#{sug['hub_seq']}", f"#{sig['hub_seq']}"])
    for _ in range(50):  # the Conductor is told in the background
        if sent:
            break
        time.sleep(0.02)
    assert sent and sent[0]["forget"]["refs"] == [f"#{note['hub_seq']}"] and "34 minutes" not in str(sent)
