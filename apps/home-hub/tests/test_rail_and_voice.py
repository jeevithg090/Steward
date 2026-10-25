"""Review round 3: what counts as a rail disruption, one signal per train, private topics and runaway or
wrong-language answers on the voice channel, no private-data oracles, and tokens gone from disk after hashing."""
import os
import sqlite3
import tempfile
from datetime import datetime, timedelta, timezone

os.environ["TEMPO_DB"] = os.path.join(tempfile.mkdtemp(prefix="tempo-test-"), "unused.db")  # never data/
os.environ["TEMPO_TEST_CLIENT_IP"] = "127.0.0.1"
os.environ["TEMPO_MDNS"] = "0"
os.environ["TEMPO_LLM_BASE_URL"] = "http://127.0.0.1:9"
os.environ["TEMPO_HOME_TZ"] = "Europe/London"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import db, main, memory, model  # noqa: E402

PAD = "Your 08:12 to London Paddington"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.delenv("TEMPO_NOTIFY_APPS", raising=False)
    monkeypatch.setenv("TEMPO_TEST_CLIENT_IP", "127.0.0.1")
    db.init(tmp_path / "r.db")
    with TestClient(main.app) as c:
        yield c


@pytest.fixture()
def owner(client):
    return client.post("/api/devices/register", json={"name": "laptop"}).json()


def alert(client, text, title=PAD, app="GWR", minutes_ago=0):
    t = (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat(timespec="seconds").replace("+00:00", "Z")
    return client.post(f"/api/ingest/tasker?key={db.owner()['ingest_key']}",
                       json={"app": app, "title": title, "text": text, "time": t}).json()


def _by_kind(pid, kind):
    rows = db.conn().execute("SELECT * FROM events WHERE person_id=? AND kind=? ORDER BY hub_seq", (pid, kind)).fetchall()
    return [db._row_to_event(r) for r in rows]


def signals(pid):
    return _by_kind(pid, "signal.rail_delay")


@pytest.mark.parametrize("app,title,text,want", [
    ("GWR", PAD, "is delayed by 34 minutes", 34),
    ("GWR", PAD, "Delayed - expected 08:53", 41),
    ("GWR", PAD, "is delayed by 1 hour 5 minutes", 65),
    ("GWR", "Your 23:50 to Cardiff Central", "is delayed by an hour", 60),
    ("GWR", "Delay", "Your 8:12am train to Bristol Temple Meads is delayed by 34 mins", 34),
    ("GWR", PAD, "is delayed by 34 minutes. You may be entitled to Delay Repay compensation", 34),
    ("GWR", PAD, "is delayed by 34 minutes due to a late running train ahead. We expect delays to continue", 34),
    ("GWR", "Your 08:12 to St. Ives", "is running 12 minutes late", 12),
    ("Avanti", "Your 09:30 to Manchester Piccadilly", "This train has been cancelled. Claim Delay Repay", "cancelled"),
    ("GWR", PAD, "is delayed", "delayed"),
    ("Trainline", "Your 08:12 to Bristol Temple Meads", "departs in 15 minutes from platform 3", None),
    ("Trainline", "Almost there", "Your 08:12 to London Paddington arrives in 45 minutes", None),
    ("LNER", "Your 10:00 to Edinburgh", "Journey time 4 hours 20 minutes", None),
    ("National Rail", "Disruption: lines blocked",
     "Lines are blocked between Reading and Didcot Parkway until 14:00. Trains are delayed by up to 60 minutes", None),
    ("GWR", "Delay Repay", "Your Delay Repay claim for 12 Oct has been paid: £14.20", None),
    ("GWR", "Engineering works", "Expect delays between Reading and Didcot this weekend", None),
    ("Trainline", "Running late?", "Change your ticket in the app in seconds", None),
    ("Trainline", "Price alert", "Cancelled plans? Get a refund on flexible tickets", None),
    ("GWR", "Don't be late!", "Your 08:12 to London Paddington departs soon", None),
])
def test_what_counts_as_a_disruption(app, title, text, want):
    d = memory.rail_disruption({"kind": "notification.signal", "payload": {"app": app, "title": title, "text": text}})
    got = None if not d else d["delay_min"] or ("cancelled" if d["cancelled"] else "delayed")
    assert got == want


def test_one_signal_per_train_updates_resolve_and_late_old_alerts_lose(client, owner):
    pid = owner["person_id"]
    alert(client, "is delayed by 34 minutes", minutes_ago=30)
    alert(client, "Delayed - expected 08:53", title="Your 08:12 to London Paddington", minutes_ago=20)
    alert(client, "This train has been cancelled", title="GWR alert: your 08:12", minutes_ago=10)
    [s] = signals(pid)
    assert s["payload"]["status"] == "cancelled" and s["text"].startswith("GWR: the 08:12 to London Paddington was cancelled")
    alert(client, "is delayed by 20 minutes", minutes_ago=40)  # an older alert delivered late
    assert signals(pid)[0]["payload"]["status"] == "cancelled"
    alert(client, "is no longer delayed and will depart on time", title="Your 17:05 to Oxford", minutes_ago=60)  # never delayed
    assert len(signals(pid)) == 1
    alert(client, "is delayed by 15 minutes", title="Your 17:05 to Oxford", minutes_ago=5)
    alert(client, "is no longer delayed and will depart on time", title="Your 17:05 to Oxford")
    ox = [s for s in signals(pid) if s["payload"]["departure"] == "17:05"]
    assert len(ox) == 1 and ox[0]["payload"]["status"] == "on time again" and "now running on time" in ox[0]["text"]


def test_restarts_dont_churn_signals_and_forgetting_the_newest_alert_falls_back_to_the_older(client, owner):
    pid = owner["person_id"]
    alert(client, "is delayed by 34 minutes", minutes_ago=30)
    alert(client, "is now delayed by 41 minutes", minutes_ago=10)
    [s] = signals(pid)
    assert s["payload"]["delay_min"] == 41
    assert memory.derive_signals(pid, 0, 5000) == [] and signals(pid)[0]["hub_seq"] == s["hub_seq"]  # idempotent
    newest = s["payload"]["from_ref"]
    me = {"Authorization": f"Bearer {owner['device_token']}"}
    client.post("/api/forget", headers=me, json={"ids": [newest]})
    [s2] = signals(pid)
    assert s2["payload"]["delay_min"] == 34  # re-derived from the alert that is still stored
    client.post("/api/forget", headers=me, json={"ids": [s2["payload"]["from_ref"]]})
    assert signals(pid) == []


def test_a_late_evening_train_alerted_after_midnight_is_one_train(client, owner):
    pid = owner["person_id"]
    for t in ("2026-10-23T23:55:00+01:00", "2026-10-24T00:10:00+01:00"):
        client.post(f"/api/ingest/tasker?key={db.owner()['ingest_key']}",
                    json={"app": "GWR", "title": "Your 23:50 to Cardiff Central", "text": "is delayed by 25 minutes", "time": t})
    [s] = signals(pid)
    assert s["payload"]["service_day"] == "2026-10-23"


def test_private_rail_apps_never_become_suggestions_and_signals_are_pruned(client, owner, monkeypatch):
    pid = owner["person_id"]
    alert(client, "is delayed by 45 minutes", title="Your 07:40 to Glasgow Queen Street", app="ScotRail")
    assert not {"signal.rail_delay", "mission.suggested"} & {e["kind"] for e in db.events_after(pid)}
    alert(client, "is delayed by 34 minutes")
    assert len(signals(pid)) == 1
    monkeypatch.setenv("TEMPO_NOTIFY_APPS", "Trainline")  # the person stops sharing GWR
    assert memory.prune_signals(pid) == 2 and signals(pid) == []  # the signal and the pending GWR suggestion
    assert not [e for e in db.events_after(pid) if e["kind"] == "mission.suggested"]
    monkeypatch.delenv("TEMPO_NOTIFY_APPS")
    memory.derive_signals(pid, 0)
    sig_dev = db.conn().execute("SELECT id FROM devices WHERE platform='signals'").fetchone()[0]
    db.remove_device(pid, sig_dev)  # the documented off switch
    assert memory.prune_signals(pid) == 1 and signals(pid) == []


def test_today_questions_only_get_todays_trains(client, owner):
    pid = owner["person_id"]
    alert(client, "is delayed by 34 minutes", minutes_ago=3 * 24 * 60)
    assert memory.rail_answer(pid, None, today_only=True) == "No train delays or cancellations have been recorded today."
    assert "34 minutes late" in memory.rail_answer(pid, None, today_only=False)


def fake_model(monkeypatch, replies):
    seq = [{"tool_calls": [{"id": "1", "function": {"name": "search_events", "arguments": '{"query": "train delay"}'}}]}]
    seq += [{"content": r} for r in replies]
    sent = []

    def post(client, deadline, body, *_):
        sent.append(body)
        return seq.pop(0)
    monkeypatch.setattr(model, "_post", post)
    return sent


def test_private_topics_are_answered_by_the_hub_not_guessed_by_the_model(client, owner, monkeypatch):
    sent = fake_model(monkeypatch, ["You have taken 5,234 steps today."])
    for q in ("How many steps did I take today?", "How did I sleep last night?", "Where am I?", "Any WhatsApp messages?"):
        r = model.ask(owner["person_id"], q, allow_vault=False)
        assert r["answer"] == "That's private on this channel, so I can't share it here." and r["model"] is None
    assert sent == []
    assert model.ask(owner["person_id"], "Sut gysgais i neithiwr?", allow_vault=False)["answer"].startswith("Mae'r data")
    assert not model.private_topic("did my train run late today")


def test_runaway_and_mixed_script_answers_never_reach_the_caller(client, owner, monkeypatch):
    fake_model(monkeypatch, ["Rwy'n sôn am fwyaf fwyaf fwyaf fwyaf fwyaf fwyaf fwyaf"])
    r = model.ask(owner["person_id"], "Which devices are connected?", allow_vault=False, language="cy")
    assert r["model"] is None and "ran away" in r["note"]
    sent = fake_model(monkeypatch, ["您的GWR列车（08:12 开往 London Paddington）晚点了34分钟。", "Your 08:12 was 34 minutes late."])
    r = model.ask(owner["person_id"], "Did anything happen with my train today?", allow_vault=False)
    assert r["answer"] == "Your 08:12 was 34 minutes late." and "Rewrite" in sent[-1]["messages"][-1]["content"]


@pytest.mark.parametrize("q,lang", [("Did Beth feel faint yesterday?", "English"), ("Did Siân message me today?", "English"),
                                    ("What happened on Mon?", "English"), ("Was ist heute mit meinem Zug passiert?", None),
                                    ("sut wnes i gysgu", "Welsh"), ("Beth ddigwyddodd i fy nhrên heddiw?", "Welsh")])
def test_language_detection_edge_cases(q, lang):
    assert model.question_language(q) == lang


@pytest.mark.parametrize("answer,spoken", [
    ("The 08:12 GWR train was 34 minutes late both times. #114 and #113", "The 08:12 GWR train was 34 minutes late both times."),
    ("You slept 6.8 hours (#46).", "You slept 6.8 hours."),
    ("Based on events #12 and #13, the train was late.", "Based on events, the train was late."),
    ("Your train was late (refs: #1, #2). Steps: 3,400.", "Your train was late. Steps: 3,400."),
])
def test_speakable_only_removes_refs(answer, spoken):
    assert model.speakable(answer)[0] == spoken


def test_an_ask_only_caller_cant_probe_private_text(client, owner):
    pid = owner["person_id"]
    client.post(f"/api/ingest/tasker?key={db.owner()['ingest_key']}",
                json={"app": "WhatsApp", "title": "Dr Patel", "text": "your HIV test results are ready"})
    hit = memory.call_tool(pid, "search_events", {"query": "HIV"}, allow_vault=False)
    miss = memory.call_tool(pid, "search_events", {"query": "zebras"}, allow_vault=False)
    assert {k: v for k, v in hit.items() if k != "query"} == {k: v for k, v in miss.items() if k != "query"}
    a = memory.fallback_answer(pid, "Did anyone message me about HIV?", allow_vault=False)
    b = memory.fallback_answer(pid, "Did anyone message me about zebras?", allow_vault=False)
    assert a == b


def test_hashing_leaves_no_plaintext_token_on_disk(tmp_path):
    path = tmp_path / "old.db"
    db.init(path)
    pid = db.owner()["id"]
    dev = db.add_device(pid, "old phone", None, "phone")
    c = db.conn()
    c.execute("UPDATE devices SET token='plain-token-XYZ-123' WHERE id=?", (dev["id"],))
    c.commit()
    c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    db.init(path)  # the migration runs while this connection stays open, as in the hub
    for f in (path, path.with_name(path.name + "-wal")):
        if f.exists():
            assert b"plain-token-XYZ-123" not in f.read_bytes(), f.name
    assert db.device_by_token("plain-token-XYZ-123")["id"] == dev["id"]


def test_a_zero_rate_limit_means_unlimited(client, owner, monkeypatch):
    monkeypatch.setattr(main.model, "ask", lambda pid, q, **kw: {"answer": "ok"})
    monkeypatch.setattr(main, "ASK_PER_MINUTE", 0)
    me = {"Authorization": f"Bearer {owner['device_token']}"}
    assert {client.post("/api/ask", headers=me, json={"question": "q"}).status_code for _ in range(5)} == {200}


def test_signals_from_an_older_rule_are_rebuilt_once(client, owner):
    pid = owner["person_id"]
    alert(client, "is delayed by 34 minutes")
    [s] = signals(pid)
    c = db.conn()
    c.execute("UPDATE events SET payload=json_set(payload, '$.rule', 'rail-delay-l1-v2'), id=id || 'old', client_id=client_id || 'old' "
              "WHERE hub_seq=?", (s["hub_seq"],))
    c.commit()
    memory.derive_signals(pid, 0)
    assert len(signals(pid)) == 2  # the old-format one and the current one
    assert memory.prune_signals(pid) == 1
    [s2] = signals(pid)
    assert s2["payload"]["rule"] == memory.RAIL_RULE


# ---------- round 4: parser v4 end to end ----------

def suggestions(pid):
    return _by_kind(pid, "mission.suggested")


def test_one_suggestion_per_train_updated_while_pending_and_withdrawn_when_it_recovers(client, owner):
    pid = owner["person_id"]
    alert(client, "is delayed by 20 minutes", minutes_ago=30)
    alert(client, "is now delayed by 45 minutes", minutes_ago=20)
    [s] = suggestions(pid)
    assert "£14.20" in s["payload"]["suggestion"] and "(from" not in s["text"]
    alert(client, "is no longer delayed and will depart on time", minutes_ago=10)
    me = {"Authorization": f"Bearer {owner['device_token']}"}
    assert client.get("/api/approvals", headers=me).json()["approvals"] == []  # withdrawn, not left pending
    assert memory.approval_decisions(pid)[f"#{suggestions(pid)[0]['hub_seq']}"]["status"] == "withdrawn"


def test_receipts_part_cancellations_and_other_trains_never_make_claims(client, owner):
    pid = owner["person_id"]
    alert(client, "We've received your claim for the 08:12 to London Paddington on 20 Oct, which arrived 34 minutes late",
          title="Delay Repay claim received")
    alert(client, "is part cancelled and will terminate at Reading", title="Your 09:00 to London Paddington")
    alert(client, "Your 07:10 to Oxford is delayed by 25 minutes. Your connection, the 09:30 to Oxford, is on time",
          title="Journey update", app="Trainline")
    sig = {s["payload"]["departure"]: s["payload"]["status"] for s in signals(pid)}
    assert sig == {"09:00": "part cancelled", "07:10": "delayed"}
    assert [s["payload"]["service"] for s in suggestions(pid)] == ["07:10 to Oxford"]  # no claim from the receipt or part cancel


def test_two_apps_one_train_and_signals_are_timed_at_departure(client, owner):
    pid = owner["person_id"]
    alert(client, "is delayed by 34 minutes", minutes_ago=20)
    alert(client, "is delayed by 34 minutes", app="Trainline", minutes_ago=10)
    [s] = signals(pid)
    assert s["payload"]["app"] == "Trainline" and len(suggestions(pid)) == 1
    assert s["payload"]["departure"] == "08:12" and s["payload"]["alert_time"]
    assert s["event_time_utc"] <= s["payload"]["alert_time"]  # never later than the alert: findable at once


def test_tomorrows_train_is_filed_under_tomorrow(client, owner):
    pid = owner["person_id"]
    alert(client, "has been cancelled due to strike action", title="Your 06:15 to London Paddington tomorrow")
    [s] = signals(pid)
    home = memory.adapters.zone("Europe/London")
    assert s["payload"]["service_day"] == (datetime.now(home).date() + timedelta(days=1)).isoformat()
    assert "tomorrow" in memory.rail_sentence(s)


def test_forgetting_an_older_alert_leaves_nothing_of_it_in_the_signal(client, owner):
    pid = owner["person_id"]
    alert(client, "is delayed by 34 minutes", minutes_ago=30)
    alert(client, "is delayed", title="GWR: your 08:12", minutes_ago=10)  # newer, no destination, no minutes
    [s] = signals(pid)
    assert s["payload"]["destination"] == "London Paddington"  # carried from the older alert
    older = [e for e in db.events_after(pid) if e["kind"] == "notification.signal"][0]
    me = {"Authorization": f"Bearer {owner['device_token']}"}
    client.post("/api/forget", headers=me, json={"ids": [f"#{older['hub_seq']}"]})
    [s2] = signals(pid)
    assert s2["payload"]["destination"] is None and s2["payload"]["delay_min"] is None


def test_derivation_sees_recent_alerts_past_a_long_history(client, owner):
    pid = owner["person_id"]
    db.insert_events(pid, owner["device_id"], [{"kind": "notification.signal", "payload": {"app": "Gmail", "title": f"m{i}", "text": "x"},
                                                "event_time_utc": "2026-01-01T00:00:00Z"} for i in range(600)])
    alert(client, "is delayed by 34 minutes")
    assert len(signals(pid)) == 1
    assert memory.rebuild_signals(pid) == 1


def test_travel_words_keep_rail_questions_shareable_and_hwyr_alone_is_not_a_train(client, owner, monkeypatch):
    assert not model.private_topic("Did I get any notifications about delays?")
    assert model.private_topic("Any WhatsApp messages?")
    sent = fake_model(monkeypatch, ["Doedd dim byd yn hwyr."])
    r = model.ask(owner["person_id"], "Oedd y cyfarfod yn hwyr heddiw?", allow_vault=False)
    assert r["model"] and sent  # Welsh 'hwyr' (late) about a meeting goes to the model, not the train answer


def test_a_devices_own_signal_from_a_private_app_stays_hidden_whatever_the_key(client, owner):
    pid = owner["person_id"]
    me = {"Authorization": f"Bearer {owner['device_token']}"}
    client.post("/api/events", headers=me, json={"events": [
        {"kind": "signal.notification", "payload": {"app": "Signal", "sender": "Sam", "content": "the door code is 4821"}},
        {"kind": "signal.notification", "payload": {"app": "WhatsApp", "snippet": "your HIV test results are ready"}}]})
    assert all(memory.is_hidden(e) for e in db.events_after(pid) if e["kind"] == "signal.notification")
    assert "4821" not in str(memory.call_tool(pid, "search_events", {"query": "door code"}))


def test_removing_the_signals_device_hides_its_signals_at_once(client, owner):
    pid = owner["person_id"]
    alert(client, "is delayed by 34 minutes")
    dev = db.conn().execute("SELECT id FROM devices WHERE platform='signals'").fetchone()[0]
    me = {"Authorization": f"Bearer {owner['device_token']}"}
    assert client.delete(f"/api/devices/{dev}", headers=me).status_code == 200
    assert signals(pid) == []


# ---------- round 5 ----------

def test_a_withdrawn_claim_comes_back_for_a_bigger_delay_and_bare_delayed_changes_nothing(client, owner):
    pid = owner["person_id"]
    me = {"Authorization": f"Bearer {owner['device_token']}"}
    alert(client, "is delayed by 20 minutes", minutes_ago=40)
    alert(client, "is no longer delayed and will depart on time", minutes_ago=30)
    assert client.get("/api/approvals", headers=me).json()["approvals"] == []
    alert(client, "is now delayed by 45 minutes", minutes_ago=20)
    [a] = client.get("/api/approvals", headers=me).json()["approvals"]
    assert "£14.20" in a["summary"]
    alert(client, "Delayed", title="08:12 Bristol Temple Meads to London Paddington", app="National Rail", minutes_ago=10)
    assert len(client.get("/api/approvals", headers=me).json()["approvals"]) == 1  # not withdrawn by a bare 'Delayed'
    assert signals(pid)[0]["payload"]["delay_min"] == 45


def test_an_alert_for_a_train_later_today_is_findable_now(client, owner):
    pid = owner["person_id"]
    later = (datetime.now(timezone.utc) + timedelta(hours=3)).astimezone(memory.adapters.zone("Europe/London"))
    alert(client, "has been cancelled", title=f"Your {later:%H:%M} to Manchester Piccadilly", app="Avanti")
    r = memory.call_tool(pid, "search_events", {"query": "train"}, allow_vault=False)
    assert any(e["kind"] == "signal.rail_delay" for e in r["events"])


def test_forget_me_doesnt_stop_new_alerts_making_signals_and_claims(client, owner):
    pid = owner["person_id"]
    me = {"Authorization": f"Bearer {owner['device_token']}"}
    alert(client, "is delayed by 34 minutes", minutes_ago=20)
    client.post("/api/forget", headers=me, json={"all": True})
    alert(client, "has been cancelled", minutes_ago=5)
    assert signals(pid)[0]["payload"]["status"] == "cancelled" and len(suggestions(pid)) == 1


def test_reset_demo_clears_a_rehearsed_claim_decision(client, owner, monkeypatch, capsys):
    import sys as _sys
    from scripts import reset_demo
    me = {"Authorization": f"Bearer {owner['device_token']}"}
    client.post(f"/api/ingest/tasker?key={db.owner()['ingest_key']}&simulated=1",
                json={"app": "GWR", "title": PAD, "text": "is delayed by 34 minutes"})
    [a] = client.get("/api/approvals", headers=me).json()["approvals"]
    client.post(f"/api/approvals/{a['hub_seq']}/approve", headers=me)
    monkeypatch.setattr(_sys, "argv", ["reset_demo.py", "--yes"])
    reset_demo.main()
    assert "1 simulated claim suggestion(s) and 1 answer(s)" in capsys.readouterr().out
    client.post(f"/api/ingest/tasker?key={db.owner()['ingest_key']}&simulated=1",
                json={"app": "GWR", "title": PAD, "text": "is now delayed by 35 minutes"})
    assert len(client.get("/api/approvals", headers=me).json()["approvals"]) == 1  # the card is back


def test_ask_only_callers_get_no_event_counter_and_no_forget_receipts(client, owner):
    pid = owner["person_id"]
    agent = db.add_device(pid, "voice", "voice", "agent", ["ask"], "owner-cli")
    assert "hub_seq" not in client.get("/api/me", headers={"Authorization": f"Bearer {agent['token']}"}).json()
    me = {"Authorization": f"Bearer {owner['device_token']}"}
    assert "hub_seq" in client.get("/api/me", headers=me).json()
    db.insert_events(pid, owner["device_id"], [{"kind": "health.sexual_activity", "payload": {"value": 1}}])
    client.post("/api/forget", headers=me, json={"kinds": ["health.sexual_activity"]})
    assert memory.call_tool(pid, "search_events", {"query": "sexual"}, allow_vault=False)["count"] == 0
    assert any(e["kind"] == "forget.done" for e in client.get("/api/events?after=0", headers=me).json()["events"])


def test_private_events_dont_crowd_shared_ones_out_of_the_timeline(client, owner):
    pid = owner["person_id"]
    alert(client, "is delayed by 34 minutes")
    hands = db.add_device(pid, "hands", "hands", "hands", ["hands"], "owner-cli")
    db.insert_events(pid, hands["id"], [{"kind": "hands.task", "payload": {"task": f"t{i}"}} for i in range(60)], trust_level="agent")
    tl = memory.get_timeline(pid, kinds=None, limit=10, allow_vault=False)
    assert any(e["kind"] == "signal.rail_delay" for e in tl["events"])


@pytest.mark.parametrize("q,private", [("Did I sleep late last night?", True), ("Did I get any notifications about delays?", False),
                                       ("What was my resting HR?", True), ("Where did I go today?", True),
                                       ("Was my train delayed?", False), ("Any texts from Sam about being late?", True)])
def test_private_topic_edges(q, private):
    assert model.private_topic(q) is private


def test_short_english_questions_and_speech_cleanup():
    assert model.question_language("Train delayed?") == "English"
    assert model.question_language("Any delays this morning?") == "English"
    assert model.speakable("We'll see.")[0] == "We'll see."
    assert model.speakable("Events: #3, #4.")[0] == "."


def test_forgetting_a_device_or_kind_with_rail_alerts_works(client, owner):
    pid = owner["person_id"]
    me = {"Authorization": f"Bearer {owner['device_token']}"}
    alert(client, "is delayed by 34 minutes", minutes_ago=10)
    tasker = db.conn().execute("SELECT id FROM devices WHERE platform='tasker'").fetchone()[0]
    r = client.post("/api/forget", headers=me, json={"device_id": tasker})
    assert r.status_code == 200 and r.json()["deleted_events"] >= 1 and signals(pid) == []
    alert(client, "is delayed by 20 minutes", title="Your 09:00 to Bath Spa", minutes_ago=5)
    r = client.post("/api/forget", headers=me, json={"kinds": ["notification.signal"]})
    assert r.status_code == 200 and signals(pid) == []
