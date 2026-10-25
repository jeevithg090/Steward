"""The hub side of the Navigator: the money ledger is written only by the hands device on this computer, is private
(vault), is readable by the person's own devices and never by ask-only ones; the demo bank is served at /oxbank/."""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

os.environ["TEMPO_DB"] = os.path.join(tempfile.mkdtemp(prefix="tempo-test-"), "unused.db")
os.environ["TEMPO_TEST_CLIENT_IP"] = "127.0.0.1"
os.environ["TEMPO_MDNS"] = "0"
os.environ["TEMPO_LLM_BASE_URL"] = "http://127.0.0.1:9"
os.environ["TEMPO_HOME_TZ"] = "Europe/London"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import db, main  # noqa: E402
from navigator.ledger import Ledger  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
EVENTS = {"events": [
    {"kind": "money.requested", "payment_id": "p-1", "event_time": "2026-10-25T01:10:00Z", "payload": {"text": "send fifty pounds to my son"}},
    {"kind": "money.checked", "payment_id": "p-1", "event_time": "2026-10-25T01:10:01Z", "payload": {"amount": "50.00", "readback": "Send £50.00 to Arjun Gaddam, account ending 4821."}},
    {"kind": "money.verified", "payment_id": "p-1", "event_time": "2026-10-25T01:10:04Z", "payload": {"name_on_screen": "ARJUN GADDAM", "ok": True}},
    {"kind": "money.awaiting_approval", "payment_id": "p-1", "event_time": "2026-10-25T01:10:05Z", "payload": {"token": "secret-approval-token", "ttl_seconds": 90}},
    {"kind": "money.sent", "payment_id": "p-1", "event_time": "2026-10-25T01:10:20Z", "payload": {"payee_id": "son", "amount": "50.00", "phone": "07700 900821"}},
]}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TEMPO_TEST_CLIENT_IP", "127.0.0.1")
    db.init(tmp_path / "h.db")
    with TestClient(main.app) as c:
        yield c


@pytest.fixture()
def owner(client):
    r = client.post("/api/devices/register", json={"name": "laptop"})
    return {"Authorization": f"Bearer {r.json()['device_token']}"}


@pytest.fixture()
def hands(client, owner, tmp_path):
    tok = tmp_path / "hands.token"
    subprocess.run([sys.executable, "scripts/device_admin.py", "add-hands", "--name", "Tempo hands (this Mac)", "--token-file", str(tok)],
                   cwd=ROOT, env={**os.environ, "TEMPO_DB": str(db.DB_PATH)}, capture_output=True, text=True, check=True)
    return tok


def test_ledger_is_written_by_hands_only_and_read_by_owner_devices(client, owner, hands):
    hdr = {"Authorization": f"Bearer {hands.read_text().strip()}"}
    assert client.post("/api/money/events", headers=owner, json=EVENTS).status_code == 403, "an ordinary device can't write it"
    r = client.post("/api/money/events", headers=hdr, json=EVENTS)
    assert r.status_code == 200 and r.json() == {"stored": 5}
    led = client.get("/api/money/ledger", headers=owner).json()
    assert led["count"] == 1
    p = led["payments"][0]
    assert p["status"] == "sent" and p["amount"] == "50.00" and p["payee_id"] == "son" and p["cop_name"] == "ARJUN GADDAM"
    assert [s["kind"] for s in p["steps"]] == ["money.requested", "money.checked", "money.verified", "money.awaiting_approval", "money.sent"]
    assert p["task"] == "send fifty pounds to my son"
    rows = db.conn().execute("SELECT * FROM events WHERE kind LIKE 'money.%' ORDER BY hub_seq").fetchall()
    assert len(rows) == 5 and all(r["class"] == "vault" and r["trust_level"] == "agent" for r in rows)
    stored = " ".join(str(db._row_to_event(r)["payload"]) for r in rows)
    assert "secret-approval-token" not in stored, "approval tokens are never stored"
    assert "07700 900821" not in stored and "[number]" in stored, "phone numbers are scrubbed"


def test_ask_only_devices_and_the_tunnel_never_see_money(client, owner, hands, tmp_path):
    hdr = {"Authorization": f"Bearer {hands.read_text().strip()}"}
    client.post("/api/money/events", headers=hdr, json=EVENTS)
    tok = tmp_path / "agent.token"
    subprocess.run([sys.executable, "scripts/device_admin.py", "add-agent", "--name", "voice", "--token-file", str(tok)],
                   cwd=ROOT, env={**os.environ, "TEMPO_DB": str(db.DB_PATH)}, capture_output=True, text=True, check=True)
    agent = {"Authorization": f"Bearer {tok.read_text().strip()}"}
    assert client.get("/api/money/ledger", headers=agent).status_code == 403
    assert client.post("/api/money/events", headers={**hdr, "X-Forwarded-For": "203.0.113.9"}, json=EVENTS).status_code == 403, "never through a tunnel"


def test_bad_events_are_refused(client, hands):
    hdr = {"Authorization": f"Bearer {hands.read_text().strip()}"}
    assert client.post("/api/money/events", headers=hdr, json={"events": [{"kind": "hands.task", "payment_id": "p", "payload": {}}]}).status_code == 422
    assert client.post("/api/money/events", headers=hdr, json={"events": []}).status_code == 422
    assert client.post("/api/money/events", headers=hdr, json={"events": [{"kind": "money.sent", "payment_id": "p 1", "payload": {}}]}).status_code == 422


def test_navigator_ledger_posts_to_the_hub(client, owner, hands, tmp_path, monkeypatch):
    """The Navigator's Ledger writes locally and posts the same event to the hub (here, through the test client)."""
    led = Ledger(tmp_path / "ledger.jsonl", token_path=hands, post=False)
    ev = led.record("p-9", "requested", {"text": "pay the water bill"})
    body = {"events": [{"kind": ev["kind"], "payment_id": ev["payment_id"], "event_time": ev["time"], "payload": ev["payload"]}]}
    r = client.post("/api/money/events", headers={"Authorization": f"Bearer {hands.read_text().strip()}"}, json=body)
    assert r.status_code == 200
    assert client.get("/api/money/ledger", headers=owner).json()["payments"][0]["task"] == "pay the water bill"
    assert led.events("p-9")[0]["kind"] == "money.requested"
    assert oct((tmp_path / "ledger.jsonl").stat().st_mode & 0o777) == "0o600"


def test_oxbank_demo_bank_is_served(client):
    r = client.get("/oxbank/")
    assert r.status_code == 200 and "OxBank" in r.text and "Confirm payment" in r.text and "Pay someone" in r.text
