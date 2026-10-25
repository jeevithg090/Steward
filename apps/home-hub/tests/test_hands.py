"""The hands audit log: what Tempo's agents did on the phone and laptop, written only by an owner-made, write-only
device on this computer, kept private (vault), and never readable by the voice agent or the tunnel."""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

os.environ["TEMPO_DB"] = os.path.join(tempfile.mkdtemp(prefix="tempo-test-"), "unused.db")  # never data/
os.environ["TEMPO_TEST_CLIENT_IP"] = "127.0.0.1"
os.environ["TEMPO_MDNS"] = "0"
os.environ["TEMPO_LLM_BASE_URL"] = "http://127.0.0.1:9"
os.environ["TEMPO_HOME_TZ"] = "Europe/London"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import db, main, memory  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
TASK = {"task_id": "t-1", "device": "phone", "task": "What's the weather? Call me on +44 7700 900123", "user_confirmed": False,
        "status": "started", "steps": ["Opened Weather"], "requested_via": "voice", "started": "2026-10-24T20:00:00Z"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TEMPO_TEST_CLIENT_IP", "127.0.0.1")
    db.init(tmp_path / "h.db")
    with TestClient(main.app) as c:
        yield c


@pytest.fixture()
def hands(client, tmp_path):
    client.post("/api/devices/register", json={"name": "laptop"})
    tok = tmp_path / "hands.token"
    out = subprocess.run([sys.executable, "scripts/device_admin.py", "add-hands", "--name", "Tempo hands (iPhone)",
                          "--token-file", str(tok)], cwd=ROOT, env={**os.environ, "TEMPO_DB": str(db.DB_PATH)},
                         capture_output=True, text=True, check=True).stdout
    assert "hands-log-only" in out and oct(tok.stat().st_mode & 0o777) == "0o600"
    return {"Authorization": f"Bearer {tok.read_text().strip()}"}


def entries():
    rows = db.conn().execute("SELECT * FROM events WHERE kind='hands.task' ORDER BY hub_seq").fetchall()
    return [db._row_to_event(r) for r in rows]


def test_a_task_is_logged_privately_and_updated_by_task_id(client, hands):
    r = client.post("/api/hands/log", headers=hands, json=TASK)
    assert r.status_code == 200 and r.json()["stored"]
    done = {**TASK, "status": "done", "steps": ["Opened Weather", "Read forecast"], "answer": "12°C and rain later",
            "finished": "2026-10-24T20:00:30Z"}
    assert client.post("/api/hands/log", headers=hands, json=done).json()["updated"] is True
    [e] = entries()
    assert e["class"] == "vault" and e["payload"]["status"] == "done" and len(e["payload"]["steps"]) == 2
    assert "7700" not in str(e) and "[number]" in e["payload"]["task"]
    pid = db.owner()["id"]
    assert memory.call_tool(pid, "search_events", {"query": "weather"}, allow_vault=False)["count"] == 0  # voice: never
    assert memory.call_tool(pid, "search_events", {"query": "weather"})["count"] == 1  # the person's own model


def test_only_an_owner_made_hands_device_writes_and_it_can_read_nothing(client, hands, monkeypatch):
    for path in ("/api/events?after=0", "/api/timeline", "/api/link"):
        assert client.get(path, headers=hands).status_code == 403, path
    assert client.post("/api/ask", headers=hands, json={"question": "hi"}).status_code == 403
    assert client.get("/api/me", headers=hands).status_code == 200
    owner = client.post("/api/join-window", headers={"Authorization": "Bearer x"})  # unknown token
    assert owner.status_code == 401
    laptop = db.add_device(db.owner()["id"], "laptop2", "mac", "laptop", [], "this-computer")
    assert client.post("/api/hands/log", headers={"Authorization": f"Bearer {laptop['token']}"}, json=TASK).status_code == 403
    assert client.post("/api/events", headers={"Authorization": f"Bearer {laptop['token']}"},
                       json={"events": [{"kind": "hands.task", "payload": {"task": "forged"}}]}).status_code == 422
    assert client.post("/api/hands/log", headers={**hands, "X-Forwarded-For": "94.119.32.4"}, json=TASK).status_code == 403
    monkeypatch.setenv("TEMPO_TEST_CLIENT_IP", "10.232.29.77")
    assert client.post("/api/hands/log", headers=hands, json=TASK).status_code == 403  # only from this computer


def test_the_log_schema_is_strict(client, hands):
    assert client.post("/api/hands/log", headers=hands, json={**TASK, "screen": "contents"}).status_code == 422
    assert client.post("/api/hands/log", headers=hands, json={**TASK, "steps": ["x" * 81]}).status_code == 422
    assert client.post("/api/hands/log", headers=hands, json={**TASK, "device": "car"}).status_code == 422
    assert client.post("/api/hands/log", headers=hands, json={**TASK, "task_id": "../x"}).status_code == 422


def test_a_device_cant_give_itself_hands_or_vault(client):
    client.post("/api/devices/register", json={"name": "laptop"})
    client.post("/api/join-window", headers={"Authorization": "Bearer nope"})
    me = client.get("/api/me")
    assert me.status_code == 401
    d = db.add_device(db.owner()["id"], "seed", "mac", "laptop", [], "this-computer")
    client.post("/api/join-window", headers={"Authorization": f"Bearer {d['token']}"})
    os.environ["TEMPO_TEST_CLIENT_IP"] = "10.232.29.77"
    try:
        r = client.post("/api/devices/register", json={"name": "x", "capabilities": ["hands", "Vault"]}).json()
    finally:
        os.environ["TEMPO_TEST_CLIENT_IP"] = "127.0.0.1"
    caps = db.conn().execute("SELECT capabilities FROM devices WHERE id=?", (r["device_id"],)).fetchone()[0]
    assert "hands" not in caps and "ault" not in caps
