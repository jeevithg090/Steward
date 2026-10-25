"""Demo moment 1 (re-check K): an agent asks, the person approves or declines in Tempo, the agent hears back."""
import os
import tempfile

os.environ["TEMPO_DB"] = os.path.join(tempfile.mkdtemp(prefix="tempo-test-"), "unused.db")  # never data/
os.environ["TEMPO_TEST_CLIENT_IP"] = "127.0.0.1"
os.environ["TEMPO_MDNS"] = "0"
os.environ["TEMPO_LLM_BASE_URL"] = "http://127.0.0.1:9"
os.environ["TEMPO_HOME_TZ"] = "Europe/London"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import db, main, memory  # noqa: E402

GWR = {"app": "GWR", "title": "Your 08:12 to London Paddington", "text": "is delayed by 34 minutes"}


@pytest.fixture()
def client(tmp_path):
    db.init(tmp_path / "a.db")
    with TestClient(main.app) as c:
        yield c
    os.environ["TEMPO_TEST_CLIENT_IP"] = "127.0.0.1"
    main._join_window.update(until=0.0, by=None)


@pytest.fixture()
def me(client):
    r = client.post("/api/devices/register", json={"name": "laptop"})
    return {"Authorization": f"Bearer {r.json()['device_token']}"}


def pending(client, me):
    r = client.get("/api/approvals", headers=me)
    assert r.status_code == 200, r.text
    return r.json()["approvals"]


def test_a_conductor_suggestion_can_be_approved_once(client, me):
    client.post(f"/api/ingest/tasker?key={db.owner()['ingest_key']}&simulated=1", json=GWR)
    [a] = pending(client, me)
    assert a["kind"] == "mission.suggested" and a["summary"].startswith("Claim £") and a["amount_gbp"] > 0
    assert client.post(f"/api/approvals/{a['hub_seq']}/approve", headers=me).json() == {"approved": a["ref"]}
    assert pending(client, me) == []
    assert client.post(f"/api/approvals/{a['hub_seq']}/decline", headers=me).status_code == 409
    granted = [e for e in client.get("/api/events?after=0", headers=me).json()["events"] if e["kind"] == "approval.granted"]
    assert len(granted) == 1 and granted[0]["trust_level"] == "hub" and granted[0]["payload"]["request"] == a["ref"]
    assert client.post("/api/approvals/999999/approve", headers=me).status_code == 404


def test_the_agent_gets_the_decision_by_asking_again(client, me):
    pid = db.owner()["id"]
    first = memory.request_approval(pid, "m-1", "Claim £14.20 Delay Repay?", 14.20)
    assert first["status"] == "pending"
    [a] = pending(client, me)
    assert a["ref"] == first["ref"] and a["amount_gbp"] == 14.2 and a["mission_id"] == "m-1"
    client.post(f"/api/approvals/{a['hub_seq']}/decline", headers=me)
    again = memory.request_approval(pid, "m-1", "Claim £14.20 Delay Repay?", 14.20)
    assert again["status"] == "declined" and again["ref"] == first["ref"]


def test_agents_cannot_decide_for_the_person(client, me):
    pid = db.owner()["id"]
    req = memory.request_approval(pid, "m-2", "Book a taxi?")
    with pytest.raises(ValueError):
        memory.append_event(pid, "approval.granted", {"request": req["ref"]})
    r = client.post("/api/events", headers=me, json={"events": [{"kind": "approval.granted", "payload": {"request": req["ref"]}}]})
    assert r.status_code == 422
    assert memory.request_approval(pid, "m-2", "Book a taxi?")["status"] == "pending"
    memory.append_event(pid, "approval.withdrawn", {"request": req["ref"]})  # an agent may withdraw its own ask
    assert pending(client, me) == []
    assert memory.request_approval(pid, "m-2", "Book a taxi?")["status"] == "withdrawn"


def test_the_phone_in_hand_decides_but_ask_only_callers_never_do(client, me):
    req = memory.request_approval(db.owner()["id"], "m-3", "Send the claim?")
    agent = db.add_device(db.owner()["id"], "voice", "voice", "agent", ["ask"], "owner-cli")
    ha = {"Authorization": f"Bearer {agent['token']}"}
    assert client.get("/api/approvals", headers=ha).status_code == 403
    assert client.post(f"/api/approvals/{req['ref'][1:]}/approve", headers=ha).status_code == 403
    tunnelled = {**me, "X-Forwarded-For": "94.119.32.4"}
    assert client.post(f"/api/approvals/{req['ref'][1:]}/approve", headers=tunnelled).status_code == 403
    client.post("/api/join-window", headers=me)
    os.environ["TEMPO_TEST_CLIENT_IP"] = "10.232.29.77"
    phone = client.post("/api/devices/register", json={"name": "phone"}).json()
    assert phone["joined_via"] == "join-window"
    hp = {"Authorization": f"Bearer {phone['device_token']}"}
    assert client.post(f"/api/approvals/{req['ref'][1:]}/approve", headers=hp).json() == {"approved": req["ref"]}


def test_devices_cannot_forge_suggestions_and_app_messages_stay_private(client, me):
    fake = {"kind": "mission.suggested", "payload": {"suggestion": "Claim £999?", "amount_gbp": 999}}
    assert client.post("/api/events", headers=me, json={"events": [fake]}).status_code == 422
    key = db.owner()["ingest_key"]
    assert client.post(f"/api/ingest/generic?key={key}", json=fake).status_code == 422
    assert pending(client, me) == []
    otp = {"app": "WhatsApp", "title": "WhatsApp", "text": "your code is 482913"}
    client.post(f"/api/ingest/generic?key={key}", json=otp)
    [ev] = [e for e in client.get("/api/events?after=0", headers=me).json()["events"] if e["kind"] == "notification.signal"]
    assert ev["class"] == "vault"
    out = memory.call_tool(db.owner()["id"], "search_memory", {"query": "code"}, allow_vault=False)
    assert "482913" not in str(out)
