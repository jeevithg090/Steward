"""Input that used to 500 (re-check R, S, N): lone surrogates froze sync; years near 1 or 9999 overflowed."""
import os
import tempfile

os.environ["TEMPO_DB"] = os.path.join(tempfile.mkdtemp(prefix="tempo-test-"), "unused.db")  # never data/
os.environ["TEMPO_TEST_CLIENT_IP"] = "127.0.0.1"
os.environ["TEMPO_MDNS"] = "0"
os.environ["TEMPO_LLM_BASE_URL"] = "http://127.0.0.1:9"
os.environ["TEMPO_HOME_TZ"] = "Europe/London"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import adapters, db, main, memory  # noqa: E402

JSON = {"Content-Type": "application/json"}


@pytest.fixture()
def client(tmp_path):
    db.init(tmp_path / "b.db")
    with TestClient(main.app) as c:
        yield c


def test_a_lone_surrogate_never_freezes_sync(client):
    r = client.post("/api/devices/register", headers=JSON, content='{"name": "Phone \\ud83d"}')
    assert r.status_code == 200, r.text
    me = {"Authorization": f"Bearer {r.json()['device_token']}", **JSON}
    r = client.post("/api/events", headers=me, content='{"events": [{"kind": "x.note", "payload": {"note": "\\ud83d", "\\udc00k": 1}}]}')
    assert r.status_code == 200, r.text
    for path in ("/api/events?after=0", "/api/devices", "/api/timeline?hours=24", "/api/profile"):
        assert client.get(path, headers=me).status_code == 200, path


@pytest.mark.parametrize("t", ["0001-01-01T00:00:00Z", "9999-12-31T23:59:59+14:00", "0001-01-01T00:30:00-14:00",
                               "1960-01-01T00:00:00Z", 253402300800])
def test_far_off_years_become_now_instead_of_a_500(client, t):
    when, off = adapters.parse_time(t)
    assert "1970" <= when[:4] <= "2100" and off is None
    me = {"Authorization": f"Bearer {client.post('/api/devices/register', json={'name': 'p'}).json()['device_token']}"}
    good = {"kind": "x.note", "payload": {"n": 1}, "event_time": "2026-10-24T09:00:00Z"}
    r = client.post("/api/events", headers=me, json={"events": [{"kind": "x.note", "payload": {"n": 2}, "event_time": t}, good]})
    assert r.status_code == 200 and r.json()["accepted"] == 2  # the good item in the batch is kept
    assert client.get(f"/api/timeline?start={t}", headers=me).status_code in (200, 400)


def test_the_specs_rail_signal_is_not_mistaken_for_the_signal_messenger():
    assert not memory.is_hidden({"kind": "signal.rail_delay", "payload": {"operator": "GWR"}, "trust_level": "agent"})
    # a device's own signal.* is the Signal messenger (or a forgery): hidden like any message
    assert memory.is_hidden({"kind": "signal.notification", "payload": {"app": "Signal", "text": "door code 4821"},
                             "trust_level": "untrusted-external"})
    assert memory.is_hidden({"kind": "signal.message", "payload": {"app": "Signal", "text": "hi"}})
    assert memory.is_hidden({"kind": "signalapp.message", "payload": {"text": "hi"}})
