import os

os.environ.setdefault("TEMPO_TEST_CLIENT_IP", "127.0.0.1")
os.environ["TEMPO_MDNS"] = "0"
os.environ["TEMPO_LLM_BASE_URL"] = "http://127.0.0.1:9"  # no model: exercises the fallback

import pytest
from fastapi.testclient import TestClient

from hub import db, main


@pytest.fixture()
def client(tmp_path):
    os.environ["TEMPO_TEST_CLIENT_IP"] = "127.0.0.1"
    db.init(tmp_path / "s.db")
    with TestClient(main.app) as c:
        yield c
    main._join_window.update(until=0.0, by=None)


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_voice_agent_token_can_only_ask_and_never_sees_vault(client):
    owner = client.post("/api/devices/register", json={"name": "laptop"}).json()
    key = db.owner()["ingest_key"]
    client.post(f"/api/ingest/owntracks?key={key}", json={"_type": "location", "lat": 51.76, "lon": -1.258, "tst": 1792850000})
    agent = db.add_device(owner["person_id"], "voice", "voice", "agent", ["ask"], "owner-cli")
    tok = agent["token"]
    for method, path in (("GET", "/api/events?after=0"), ("GET", "/api/link"), ("POST", "/api/join-window"),
                         ("POST", "/api/keys/rotate"), ("GET", "/api/devices")):
        assert client.request(method, path, headers=_h(tok)).status_code == 403, path
    assert client.post("/api/forget", headers=_h(tok), json={"all": True}).status_code == 403
    r = client.post("/api/ask", headers=_h(tok), json={"question": "where am I?"}).json()
    assert r["model"] is None and "51.76" not in r["answer"] and "-1.258" not in r["answer"]
    own = client.post("/api/ask", headers=_h(owner["device_token"]), json={"question": "where am I?"}).json()
    assert "51.76" in own["answer"]  # the owner's own device still sees it


def test_tunnelled_requests_are_ask_only_even_with_owner_token(client, monkeypatch):
    owner = client.post("/api/devices/register", json={"name": "laptop"}).json()
    hdr = {**_h(owner["device_token"]), "X-Forwarded-For": "94.119.32.4"}
    assert client.get("/api/link", headers=hdr).status_code == 403
    assert client.post("/api/ask", headers=hdr, json={"question": "hi"}).status_code == 200
    monkeypatch.setenv("TEMPO_PUBLIC_URL", "https://tempo.example.com")
    assert client.get("/api/link", headers=_h(owner["device_token"])).status_code == 200  # local, not tunnelled
    assert client.get("/api/link", headers={**_h(owner["device_token"]), "Host": "tempo.example.com"}).status_code == 403


def test_window_joined_devices_cannot_administer(client):
    owner = client.post("/api/devices/register", json={"name": "laptop"}).json()
    client.post("/api/join-window", headers=_h(owner["device_token"]))
    os.environ["TEMPO_TEST_CLIENT_IP"] = "10.232.29.77"
    phone = client.post("/api/devices/register", json={"name": "phone"}).json()
    assert phone["joined_via"] == "join-window"
    assert client.get("/api/events?after=0", headers=_h(phone["device_token"])).status_code == 200
    assert client.post("/api/join-window", headers=_h(phone["device_token"])).status_code == 403
    assert client.post("/api/keys/rotate", headers=_h(phone["device_token"])).status_code == 403


def test_loopback_joins_only_first_device_or_inside_a_window(client):
    first = client.post("/api/devices/register", json={"name": "laptop"})
    assert first.json()["joined_via"] == "this-computer"
    # e.g. a raw TCP tunnel / ssh -L arriving as 127.0.0.1
    assert client.post("/api/devices/register", json={"name": "tunnel"}).status_code == 403
    client.post("/api/join-window", headers=_h(first.json()["device_token"]))
    assert client.post("/api/devices/register", json={"name": "agent2"}).status_code == 200


def test_oversized_bodies_are_refused_before_auth(client):
    big = "x" * (70 * 1024)
    r = client.post("/api/ask", content=('{"question":"' + big + '"}').encode(), headers={"Content-Type": "application/json"})
    assert r.status_code == 413
