"""API rules: who may join automatically, secrets, NaN-proof responses, envelope intake, reserved
kinds, forget (backups, receipts, agent requests) and blocking removed apps."""
import json
import os
import sqlite3
import tempfile

os.environ["TEMPO_DB"] = os.path.join(tempfile.mkdtemp(prefix="tempo-test-"), "unused.db")  # never data/
os.environ["TEMPO_TEST_CLIENT_IP"] = "127.0.0.1"
os.environ["TEMPO_MDNS"] = "0"
os.environ["TEMPO_LLM_BASE_URL"] = "http://127.0.0.1:9"  # nothing listens: no model calls from tests
os.environ["TEMPO_HOME_TZ"] = "Europe/London"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import db, main  # noqa: E402
from hub.main import app  # noqa: E402

OT = {"_type": "location", "lat": 51.76, "lon": -1.258, "tst": 1792850000, "batt": 60}


@pytest.fixture()
def client(tmp_path):
    db.init(tmp_path / "t.db")
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _reset():
    yield
    caller("127.0.0.1")
    for k in ("TEMPO_LAN_AUTOJOIN", "TEMPO_HOME_CIDR", "TEMPO_PUBLIC_URL"):
        os.environ.pop(k, None)
    os.environ["TEMPO_MDNS"] = "0"
    main._join_window["until"] = 0


def caller(ip):
    os.environ["TEMPO_TEST_CLIENT_IP"] = ip


def register(client, **kw):
    return client.post("/api/devices/register", json={"name": "Phone", "kind": "phone"}, **kw)


def join(client):
    r = register(client)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['device_token']}"}


def post(client, me, events):
    r = client.post("/api/events", headers=me, json={"events": events})
    assert r.status_code == 200, r.text
    return r.json()


def events(client, me):
    return client.get("/api/events?after=0&limit=2000", headers=me).json()["events"]


def ask_forget(payload):
    """What hub.mcp_server.request_forget writes: a forget.requested from the 'Agents (via MCP)' device."""
    pid = db.owner()["id"]
    dev = db.integration_device(pid, "agents", "Agents (via MCP)")
    db.insert_events(pid, dev["id"], [{"kind": "forget.requested", "payload": payload}], source="mcp", trust_level="agent")
    return db.latest_hub_seq()


# ---------- #1 / #2 who joins automatically ----------

def test_first_device_bootstrap_only_from_the_home_cidr(client):
    caller("10.232.29.77")  # venue Wi-Fi: private, but not home
    assert register(client).status_code == 403
    os.environ["TEMPO_HOME_CIDR"] = "172.20.10.0/28"
    assert register(client).status_code == 403
    key = db.owner()["ingest_key"]
    assert client.post(f"/api/ingest/owntracks?key={key}", json=OT).status_code == 200  # an app is not a device
    caller("172.20.10.3")
    r = register(client)
    assert r.status_code == 200 and r.json()["joined_via"] == "first-device"
    caller("172.20.10.4")  # the second device needs 'Add a device now' (or TEMPO_LAN_AUTOJOIN=1)
    assert register(client).status_code == 403


def test_lan_autojoin_needs_a_home_cidr(client):
    join(client)
    os.environ["TEMPO_LAN_AUTOJOIN"] = "1"
    caller("192.168.1.20")
    assert register(client).status_code == 403
    assert "ignored without TEMPO_HOME_CIDR" in main.join_summary()


def test_auto_join_needs_the_hubs_own_host_name(client):
    assert register(client, headers={"Host": "rebind.attacker.example:8787"}).status_code == 403
    cred = None
    for host in ("localhost:8787", "127.0.0.1:8787", f"{main.lan_ip()}:8787", "tempo-hub.local:8787",
                 f"{main._local_name()}:8787", "TEMPO-HUB.LOCAL."):
        if cred:  # after the first device, this computer joins only inside a window
            client.post("/api/join-window", headers=cred)
        r = register(client, headers={"Host": host})
        assert r.status_code == 200, host
        cred = cred or {"Authorization": f"Bearer {r.json()['device_token']}"}
    client.post("/api/join-window", headers=cred)
    caller("10.232.29.77")
    assert register(client, headers={"Host": "rebind.attacker.example"}).status_code == 403
    assert register(client, headers={"Host": f"{main.lan_ip()}:8787"}).json()["joined_via"] == "join-window"
    token = db.owner()["join_token"]  # the personal link works whatever the Host (tunnels, iPhone names)
    r = client.post("/api/devices/register", json={"name": "x", "join_token": token}, headers={"Host": "evil.example"})
    assert r.status_code == 200 and r.json()["joined_via"] == "link"


def test_x_client_ip_and_public_url_stop_auto_join(client):
    assert register(client, headers={"X-Client-IP": "1.2.3.4"}).status_code == 403
    os.environ["TEMPO_PUBLIC_URL"] = "https://tempo.example.com"
    assert register(client).status_code == 403
    assert main.join_summary().startswith("OFF")


def test_mdns_only_inside_the_home_cidr(monkeypatch):
    monkeypatch.setattr(main, "lan_ip", lambda: "10.232.29.59")
    monkeypatch.setenv("TEMPO_MDNS", "1")
    monkeypatch.delenv("TEMPO_HOME_CIDR", raising=False)
    assert main.mdns_allowed()[0] is False
    monkeypatch.setenv("TEMPO_HOME_CIDR", "172.20.10.0/28")
    assert main.mdns_allowed()[0] is False
    monkeypatch.setattr(main, "lan_ip", lambda: "172.20.10.2")
    assert main.mdns_allowed()[0] is True
    monkeypatch.setenv("TEMPO_MDNS", "0")
    assert main.mdns_allowed()[0] is False


# ---------- #14 secrets ----------

def test_banner_never_prints_secrets(tmp_path, capsys):
    db.init(tmp_path / "t.db")
    with TestClient(app):
        pass
    out = capsys.readouterr().out
    person = db.owner()
    assert person["join_token"] not in out and person["ingest_key"] not in out
    assert "same Wi-Fi only" in out and "Send my link" in out


def test_hello_has_no_activity_counter(client):
    assert client.get("/api/hello").json() == {"hub": "Tempo", "version": app.version}


def test_link_is_labelled_same_wifi_unless_public_url(client):
    me = join(client)
    r = client.get("/api/link", headers=me).json()
    assert r["works"] == "same-wifi" and "Same Wi-Fi only" in r["label"] and r["link"].endswith(db.owner()["join_token"])
    assert db.owner()["join_token"] not in r["masked"] and r["masked"].endswith("••••")
    assert [e["payload"]["by"] for e in events(client, me) if e["kind"] == "hub.link_shown"] == ["Phone"]
    os.environ["TEMPO_PUBLIC_URL"] = "https://tempo.example.com"
    r = client.get("/api/link", headers=me).json()
    assert r["works"] == "anywhere" and r["link"].startswith("https://tempo.example.com/join#t=")


def test_integration_urls_are_masked_until_revealed(client):
    me = join(client)
    key = db.owner()["ingest_key"]
    r = client.get("/api/integrations", headers=me).json()
    assert r["masked"] is True and len(r["integrations"]) == 7
    assert all(key not in i["url"] and key not in i["url_by_name"] for i in r["integrations"])
    assert client.post("/api/integrations/reveal").status_code == 401
    full = client.post("/api/integrations/reveal", headers=me).json()
    assert full["masked"] is False and all(i["url"].endswith(f"?key={key}") for i in full["integrations"])
    shown = [e for e in events(client, me) if e["kind"] == "hub.ingest_key_shown"]
    assert len(shown) == 1 and key not in json.dumps(shown[0])


def test_rotate_keys(client):
    me = join(client)
    before = db.owner()
    assert client.post("/api/rotate").status_code == 401
    r = client.post("/api/rotate", headers=me)
    assert r.status_code == 200 and r.json()["rotated"] == ["join_token", "ingest_key"]
    after = db.owner()
    assert after["join_token"] != before["join_token"] and after["ingest_key"] != before["ingest_key"]
    assert r.json()["link"].endswith(after["join_token"])
    assert client.post(f"/api/ingest/owntracks?key={before['ingest_key']}", json=OT).status_code == 401
    caller("8.8.4.4")
    assert client.post("/api/devices/register", json={"name": "x", "join_token": before["join_token"]}).status_code == 403
    caller("127.0.0.1")
    assert client.get("/api/me", headers=me).status_code == 200  # joined devices keep working
    r = client.post("/api/keys/rotate", headers=me, json={"join_token": False})
    assert r.json()["rotated"] == ["ingest_key"] and db.owner()["join_token"] == after["join_token"]
    assert client.post("/api/rotate", headers=me, json={"join_token": False, "ingest_key": False}).status_code == 400
    assert client.post("/api/rotate", headers=me, json={"surprise": True}).status_code == 422
    assert all(after["join_token"] not in json.dumps(e) for e in events(client, me))


# ---------- #5 NaN never breaks a response ----------

def test_responses_never_fail_on_non_finite_numbers(client, monkeypatch):
    me = join(client)
    for bad in ('{"events": [{"kind": "health.steps", "seq": NaN}]}', '{"events": [{"kind": Infinity}]}'):
        r = client.post("/api/events", headers={**me, "Content-Type": "application/json"}, content=bad)
        assert r.status_code == 422, r.text
    monkeypatch.setattr(main.memory, "get_profile", lambda pid, **kw: {"facts": [{"fact": "x", "v": float("nan")}],
                                                                 "n": float("inf")})
    r = client.get("/api/profile", headers=me)
    assert r.status_code == 200 and r.json() == {"facts": [{"fact": "x", "v": None}], "n": None}
    monkeypatch.setattr(main.model, "ask", lambda pid, q, **kw: {"answer": "ok", "score": float("-inf")})
    r = client.post("/api/ask", headers=me, json={"question": "x"}).json()
    assert {k: v for k, v in r.items() if k != "timings"} == {"answer": "ok", "score": None} and "wait_ms" in r["timings"]
    key = db.owner()["ingest_key"]
    r = client.post(f"/api/ingest/generic?key={key}", content='{"steps": NaN, "x": Infinity}',
                    headers={"Content-Type": "application/json"})
    assert r.status_code == 200 and r.json()["accepted"] == 2
    assert client.get("/api/events?after=0", headers=me).status_code == 200


# ---------- #6 / #17 envelope intake ----------

def test_clock_change_pair_over_http_stays_two_rows(client):
    me = join(client)
    r = post(client, me, [
        {"kind": "health.heart_rate", "payload": {"value": 60}, "event_time": "2026-10-25T01:30:00",
         "tz": "Europe/London", "fold": "earlier"},
        {"kind": "health.heart_rate", "payload": {"value": 60}, "event_time": "2026-10-25T01:30:00",
         "tz": "Europe/London", "fold": "later"}])
    assert r["accepted"] == 2 and r["duplicates"] == 0
    hr = sorted((e["event_time_utc"], e["event_offset"], e["event_fold"]) for e in events(client, me)
                if e["kind"] == "health.heart_rate")
    assert hr == [("2026-10-25T00:30:00Z", "+01:00", "earlier"), ("2026-10-25T01:30:00Z", "+00:00", "later")]


def test_event_time_may_be_an_envelope_object(client):
    me = join(client)
    post(client, me, [
        {"kind": "health.steps", "payload": {"value": 5},
         "event_time": {"local": "2026-10-25T01:45:00", "tz": "Europe/London", "fold": "later"}},
        {"kind": "health.steps", "payload": {"value": 6}, "event_time": {"utc": "2026-10-24T08:00:00Z", "offset": "+01:00"}},
        {"kind": "health.steps", "payload": {"value": 7}, "event_time": "2026-10-24T09:00:00"}])  # naive: home zone
    got = {e["payload"]["value"]: e for e in events(client, me) if e["kind"] == "health.steps"}
    assert (got[5]["event_time_utc"], got[5]["event_tz"], got[5]["event_fold"]) == ("2026-10-25T01:45:00Z", "Europe/London", "later")
    assert (got[6]["event_time_utc"], got[6]["event_offset"]) == ("2026-10-24T08:00:00Z", "+01:00")
    assert (got[7]["event_time_utc"], got[7]["event_offset"]) == ("2026-10-24T08:00:00Z", "+01:00")


def test_consent_scope_v_and_body_raw_are_stored(client):
    me = join(client)
    post(client, me, [
        {"kind": "node.heartbeat", "id": "a1", "payload": {"x": 1}, "consent_scope": "health:read", "v": 1, "body": '{"x":1}'},
        {"kind": "node.heartbeat", "id": "a2", "payload": {"x": 2}, "body_raw": '{"x":2}', "v": "1", "body": {"ignored": 1}}])
    got = {e["client_id"]: e for e in events(client, me) if e["kind"] == "node.heartbeat"}
    assert (got["a1"]["consent_scope"], got["a1"]["v"], got["a1"]["body_raw"]) == ("health:read", "1", '{"x":1}')
    assert (got["a2"]["consent_scope"], got["a2"]["v"], got["a2"]["body_raw"]) == (None, "1", '{"x":2}')


def test_batches_over_1000_are_refused_and_cursors_are_clamped(client):
    me = join(client)
    r = client.post("/api/events", headers=me, json={"events": [{"kind": "node.heartbeat", "payload": {"i": i}}
                                                                for i in range(1001)]})
    assert r.status_code == 413
    r = client.get(f"/api/events?after={10 ** 25}", headers=me)
    assert r.status_code == 200 and r.json()["events"] == [] and r.json()["latest_hub_seq"] < r.json()["hub_seq"]


# ---------- #7 reserved kinds and simulated ----------

def test_reserved_kinds_are_refused_and_nothing_is_stored(client):
    me = join(client)
    before = len(events(client, me))
    r = client.post("/api/events", headers=me, json={"events": [{"kind": "health.steps"}, {"kind": " Forget.Requested"}]})
    assert r.status_code == 422 and r.json()["detail"]["kinds"] == ["forget.requested"]
    key = db.owner()["ingest_key"]
    for body in ({"kind": "approval.granted"}, {"events": [{"kind": "device.joined"}, {"kind": "health.ok"}]},
                 {"kind": "HUB.anything"}):
        assert client.post(f"/api/ingest/generic?key={key}", json=body).status_code == 422, body
    assert len(events(client, me)) == before


def test_simulated_goes_into_source_and_payload(client):
    me = join(client)
    key = db.owner()["ingest_key"]
    assert client.post(f"/api/ingest/owntracks?key={key}&simulated=1", json=OT).status_code == 200
    ev = [e for e in events(client, me) if e["kind"] == "location.point"][0]
    assert ev["payload"]["_simulated"] is True and ev["source"] == "owntracks:simulated"
    assert ev["trust_level"] == "integration"


# ---------- #4 / #11 forget ----------

def test_forget_all_takes_a_backup_and_leaves_a_receipt(client, tmp_path):
    me = join(client)
    point = {"kind": "location.point", "payload": {"lat": 51.7}, "event_time": "2026-01-01T09:00:00Z"}
    post(client, me, [point])
    assert client.post("/api/forget", headers=me, json={"all": True, "kind_prefix": "health."}).status_code == 400
    r = client.post("/api/forget", headers=me, json={"all": True})
    assert r.status_code == 200 and r.json()["deleted_events"] == 2
    backup = tmp_path / "backups" / r.json()["backup"]
    assert backup.exists() and os.stat(backup).st_mode & 0o777 == 0o600
    with sqlite3.connect(backup) as old:
        assert old.execute("SELECT count(*) FROM events WHERE kind='location.point'").fetchone()[0] == 1
    evs = events(client, me)
    assert [e["kind"] for e in evs] == ["forget.done"]
    assert evs[0]["trust_level"] == "hub" and evs[0]["payload"]["all"] is True and evs[0]["payload"]["count"] == 2
    assert post(client, me, [point])["duplicates"] == 1  # tombstone: the old point can't come back


def test_forget_by_ref_sends_refs_not_content(client):
    me = join(client)
    post(client, me, [{"kind": "health.sleep", "payload": {"value": 7.123}, "event_time": "2026-01-01T07:00:00Z"}])
    ev = [e for e in events(client, me) if e["kind"] == "health.sleep"][0]
    r = client.post("/api/forget", headers=me, json={"ids": [f"#{ev['hub_seq']}", "#99999999999999999999999"]})
    assert r.status_code == 200 and r.json()["deleted_events"] == 1
    receipt = [e for e in events(client, me) if e["kind"] == "forget.done"][-1]
    assert receipt["payload"]["refs"] == [f"#{ev['hub_seq']}"] and "7.123" not in json.dumps(receipt)


def test_app_deletes_leave_a_receipt_for_that_app_only(client):
    me = join(client)
    key = db.owner()["ingest_key"]
    hr = {"timestamp": "2026-10-24T20:00:00Z", "app_version": "1.9.31",
          "heart_rate": [{"time": "2026-10-24T19:58:00Z", "bpm": 74, "metadata": {"id": "hr-1"}}]}
    client.post(f"/api/ingest/health-connect?key={key}", json=hr)
    seq = [e for e in events(client, me) if e["kind"] == "health.heart_rate"][0]["hub_seq"]
    gone = {"timestamp": "x", "app_version": "1.9.31", "deleted": [{"type": "heart_rate", "id": "hr-1"},
                                                                   {"type": "heart_rate", "id": "hr-2"}]}
    client.post(f"/api/ingest/health-connect?key={key}", json=gone)
    receipts = [e for e in events(client, me) if e["kind"] == "forget.done"]
    assert len(receipts) == 1 and receipts[0]["payload"]["refs"] == [f"#{seq}"]
    assert receipts[0]["payload"]["device_id"] == receipts[0]["device_id"]
    later = {**hr, "heart_rate": [{"time": "2026-10-24T21:00:00Z", "bpm": 70, "metadata": {"id": "hr-2"}}]}
    assert client.post(f"/api/ingest/health-connect?key={key}", json=later).json()["duplicates"] == 1


def test_agent_forget_request_approve(client):
    me = join(client)
    point = {"kind": "location.point", "payload": {"lat": 51.7}, "event_time": "2026-01-01T09:00:00Z"}
    post(client, me, [point, {"kind": "health.steps", "payload": {"value": 10}, "event_time": "2026-01-01T09:00:00Z"}])
    seq = ask_forget({"what": "location.", "reason": "asked in chat"})
    reqs = client.get("/api/forget/requests", headers=me).json()["requests"]
    assert [r["hub_seq"] for r in reqs] == [seq]
    assert reqs[0]["can_apply"] and reqs[0]["selector"] == {"kind_prefix": "location."}
    assert reqs[0]["from"] == "Agents (via MCP)" and "(1 events now)" in reqs[0]["summary"]
    r = client.post(f"/api/forget/requests/{seq}/approve", headers=me)
    assert r.status_code == 200 and r.json() == {"approved": f"#{seq}", "deleted_events": 1}
    evs = events(client, me)
    kinds = [e["kind"] for e in evs]
    assert "location.point" not in kinds and "health.steps" in kinds
    approved = [e for e in evs if e["kind"] == "forget.approved"][0]
    assert approved["trust_level"] == "hub" and approved["payload"]["request"] == f"#{seq}"
    assert approved["payload"]["kind_prefix"] == "location." and approved["payload"]["count"] == 1
    done = [e for e in evs if e["kind"] == "forget.done"][0]
    assert done["payload"]["request"] == f"#{seq}" and done["payload"]["kind_prefix"] == "location."
    assert client.get("/api/forget/requests", headers=me).json()["requests"] == []
    assert client.post(f"/api/forget/requests/{seq}/approve", headers=me).status_code == 409
    assert post(client, me, [point])["duplicates"] == 1  # tombstone


def test_forget_request_written_by_the_mcp_tool_can_be_approved(client):
    from hub import memory
    me = join(client)
    post(client, me, [{"kind": "health.heart_rate", "payload": {"value": 61}, "event_time": "2026-01-01T09:00:00Z"},
                      {"kind": "location.point", "payload": {"lat": 1}, "event_time": "2026-01-01T09:00:00Z"}])
    hr = [e for e in events(client, me) if e["kind"] == "health.heart_rate"][0]
    by_cat = memory.request_forget(db.owner()["id"], category="location.", reason="user asked")
    by_ref = memory.request_forget(db.owner()["id"], ids=[f"#{hr['hub_seq']}"])
    topic = memory.request_forget(db.owner()["id"], topic="that awkward meeting")
    reqs = {r["ref"]: r for r in client.get("/api/forget/requests", headers=me).json()["requests"]}
    assert reqs[by_cat["ref"]]["selector"] == {"kind_prefix": "location."}
    assert reqs[by_ref["ref"]]["selector"] == {"ids": [f"#{hr['hub_seq']}"]}
    assert reqs[topic["ref"]]["can_apply"] is False and reqs[topic["ref"]]["what"] == "that awkward meeting"
    for ref in (by_cat["ref"], by_ref["ref"]):
        assert client.post(f"/api/forget/requests/{ref[1:]}/approve", headers=me).json()["deleted_events"] == 1
    assert not {"health.heart_rate", "location.point"} & {e["kind"] for e in events(client, me)}


def test_agent_forget_request_decline_and_vague_requests(client):
    me = join(client)
    vague = ask_forget({"what": "my trip to London"})
    refs = ask_forget({"ids": ["#1"]})
    reqs = {r["hub_seq"]: r for r in client.get("/api/forget/requests", headers=me).json()["requests"]}
    assert reqs[vague]["can_apply"] is False and reqs[refs]["selector"] == {"ids": ["#1"]}
    assert client.post(f"/api/forget/requests/{vague}/approve", headers=me).status_code == 422
    assert client.post(f"/api/forget/requests/{vague}/decline", headers=me).json() == {"declined": f"#{vague}"}
    assert client.post(f"/api/forget/requests/{vague}/deny", headers=me).status_code == 409
    assert client.post("/api/forget/requests/1/approve", headers=me).status_code == 404  # #1 is device.joined
    assert client.post("/api/forget/requests/99999/decline", headers=me).status_code == 404
    assert [r["hub_seq"] for r in client.get("/api/forget/requests", headers=me).json()["requests"]] == [refs]
    assert main._request_selector({"all": True}) == {}  # an agent can never ask to forget everything
    assert main._request_selector({"category": "Health"}) == {"kind_prefix": "health."}
    assert main._request_selector({"what": "#3, #4"}) == {"ids": ["#3", "#4"]}
    assert main._request_selector({"kind_prefix": "%"}) == {}


# ---------- #16 removing an app blocks it ----------

def test_removing_an_app_blocks_it_until_unblocked(client):
    me = join(client)
    key = db.owner()["ingest_key"]
    assert client.post(f"/api/ingest/owntracks?key={key}", json=OT).json() == []
    listing = client.get("/api/devices", headers=me).json()
    app_dev = [d for d in listing["devices"] if d["kind"] == "integration"][0]
    assert listing["blocked"] == []
    r = client.delete(f"/api/devices/{app_dev['id']}", headers=me).json()
    assert r["blocked"] is True and "blocked" in r["note"]
    before = len(events(client, me))
    r = client.post(f"/api/ingest/owntracks?key={key}", json={**OT, "tst": OT["tst"] + 60})
    assert r.status_code == 410 and "removed from Tempo" in r.json()["detail"]["message"]
    assert len(events(client, me)) == before
    listing = client.get("/api/devices", headers=me).json()
    assert [b["source"] for b in listing["blocked"]] == ["owntracks"]
    assert all(d["id"] != app_dev["id"] for d in listing["devices"])
    u = client.post(f"/api/devices/{app_dev['id']}/unblock", headers=me)
    assert u.status_code == 200 and u.json()["unblocked"] == app_dev["id"]
    assert client.post(f"/api/ingest/owntracks?key={key}", json={**OT, "tst": OT["tst"] + 60}).status_code == 200
    assert client.get("/api/devices", headers=me).json()["blocked"] == []
    phone = client.get("/api/devices", headers=me).json()["you"]
    assert client.post(f"/api/devices/{phone}/unblock", headers=me).status_code == 400
    assert client.post("/api/devices/d_nope/unblock", headers=me).status_code == 404


def test_bad_ingest_bodies_are_400_not_500(client):
    key = db.owner()["ingest_key"]
    assert client.post(f"/api/ingest/generic?key={key}", content=b"\xff\xfe not json").status_code == 400
    assert client.post(f"/api/ingest/generic?key={key}", content="[" * 100000).status_code == 400


# ---------- #13 web client ----------

def test_web_page_keeps_the_client_fixes(client):
    html = client.get("/").text
    for needle in ('store.del("tempo.join")', "new AbortController()", "30000", "Math.max(0, (cred.hub_seq || 0) - 40)",
                   "reconnect()", "setTimeout(start, 10000)", "isSecureContext", "sms:?&body=", "/api/forget/requests/",
                   'id="forgetMe"', "confirm(", "/api/integrations/reveal", "/unblock", "payload._simulated", "latest_hub_seq"):
        assert needle in html, needle
    assert 'trust_level === "simulated"' not in html
