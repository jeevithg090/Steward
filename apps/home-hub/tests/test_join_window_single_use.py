import os

os.environ.setdefault("TEMPO_TEST_CLIENT_IP", "127.0.0.1")
os.environ["TEMPO_MDNS"] = "0"
os.environ["TEMPO_LLM_BASE_URL"] = "http://127.0.0.1:9"

import pytest
from fastapi.testclient import TestClient

from hub import db, main


@pytest.fixture()
def client(tmp_path):
    db.init(tmp_path / "w.db")
    with TestClient(app := main.app) as c:
        yield c
    main._join_window.update(until=0.0, by=None)
    os.environ["TEMPO_TEST_CLIENT_IP"] = "127.0.0.1"


def test_join_window_is_single_use_and_names_its_opener(client):
    os.environ["TEMPO_TEST_CLIENT_IP"] = "127.0.0.1"
    opener = client.post("/api/devices/register", json={"name": "laptop"}).json()
    client.post("/api/join-window", headers={"Authorization": f"Bearer {opener['device_token']}"})
    os.environ["TEMPO_TEST_CLIENT_IP"] = "10.232.29.77"
    first = client.post("/api/devices/register", json={"name": "my phone"})
    assert first.status_code == 200 and first.json()["joined_via"] == "join-window"
    second = client.post("/api/devices/register", json={"name": "stranger"})
    assert second.status_code == 403  # window closed by the first join
    os.environ["TEMPO_TEST_CLIENT_IP"] = "127.0.0.1"
    evs = client.get("/api/events?after=0", headers={"Authorization": f"Bearer {opener['device_token']}"}).json()["events"]
    joined = [e for e in evs if e["kind"] == "device.joined" and e["payload"].get("name") == "my phone"][0]
    assert joined["payload"]["opened_by"] == opener["device_id"]


# ---------- re-check U ----------

def test_window_follow_ups_race_cidr_removed_tabs_and_who_joined(tmp_path, monkeypatch):
    import threading
    from fastapi.testclient import TestClient
    from hub import db, main
    db.init(tmp_path / "u.db")
    monkeypatch.setenv("TEMPO_TEST_CLIENT_IP", "127.0.0.1")
    with TestClient(main.app) as c:
        owner = c.post("/api/devices/register", json={"name": "laptop"}).json()
        me = {"Authorization": f"Bearer {owner['device_token']}"}
        c.post("/api/join-window", headers=me)
        monkeypatch.setenv("TEMPO_TEST_CLIENT_IP", "10.232.29.77")
        codes = []
        def go():
            codes.append(c.post("/api/devices/register", json={"name": "racer"}).status_code)
        threads = [threading.Thread(target=go) for _ in range(12)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        assert codes.count(200) == 1 and codes.count(403) == 11
        joined = [e for e in c.get("/api/events?after=0", headers=me).json()["events"] if e["kind"] == "device.joined"][-1]
        assert joined["payload"]["ip"] == "10.232.29.77" and "user_agent" in joined["payload"]

        monkeypatch.setenv("TEMPO_HOME_CIDR", "192.168.1.0/24")
        monkeypatch.setenv("TEMPO_TEST_CLIENT_IP", "127.0.0.1")
        c.post("/api/join-window", headers=me)
        monkeypatch.setenv("TEMPO_TEST_CLIENT_IP", "10.232.29.78")  # venue Wi-Fi: private, but not home
        assert c.post("/api/devices/register", json={"name": "venue"}).status_code == 403
        monkeypatch.setenv("TEMPO_LAN_AUTOJOIN", "1")
        monkeypatch.setenv("TEMPO_TEST_CLIENT_IP", "192.168.1.20")
        assert c.post("/api/devices/register", json={"name": "home"}).json()["joined_via"] == "home-network"
        assert main._join_window["until"] > 0  # the home route didn't use up the window
        monkeypatch.delenv("TEMPO_LAN_AUTOJOIN")
        phone = c.post("/api/devices/register", json={"name": "phone"}).json()
        assert phone["joined_via"] == "join-window"

        monkeypatch.setenv("TEMPO_TEST_CLIENT_IP", "127.0.0.1")
        assert c.delete(f"/api/devices/{phone['device_id']}", headers=me).status_code == 200
        r = c.get("/api/me", headers={"Authorization": f"Bearer {phone['device_token']}"})
        assert r.status_code == 410 and "removed" in r.json()["detail"]
        assert c.get("/api/me", headers={"Authorization": "Bearer nonsense"}).status_code == 401
    main._join_window.update(until=0.0, by=None)
