"""Desktop agent and simulate.py: pure functions and the send loop with the network faked.
Nothing here starts launchd/systemd, joins a real hub or touches ~/.tempo."""
import importlib.util
import io
import json
import os
import plistlib
import sys
import tempfile
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
os.environ["TEMPO_AGENT_STATE"] = os.path.join(tempfile.mkdtemp(prefix="tempo-agent-test-"), "agent.json")

import pytest  # noqa: E402

from hub import adapters  # noqa: E402


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


agent = _load("desktop_agent", ROOT / "agent" / "desktop_agent.py")
sys.path.insert(0, str(ROOT / "scripts"))
simulate = _load("simulate", ROOT / "scripts" / "simulate.py")


class Stop(Exception):
    pass


@pytest.fixture()
def state_file(tmp_path, monkeypatch):
    path = tmp_path / ".tempo" / "agent.json"
    monkeypatch.setattr(agent, "STATE", path)
    monkeypatch.setattr(agent, "LOG_FILE", path.parent / "agent.log")
    for k in ("TEMPO_HUB_URL", "TEMPO_JOIN_TOKEN", "TEMPO_AGENT_TZ", "TEMPO_AGENT_TITLES"):
        monkeypatch.delenv(k, raising=False)
    return path


def http_error(code, detail=""):
    return urllib.error.HTTPError("http://hub/api/events", code, "x", {},
                                  io.BytesIO(json.dumps({"detail": detail}).encode()))


def quiet_machine(monkeypatch, app="Safari"):
    monkeypatch.setattr(agent, "front_app", lambda: (app, None))
    monkeypatch.setattr(agent, "idle_seconds", lambda: 3)
    monkeypatch.setattr(agent, "battery", lambda: (80, True))
    monkeypatch.setattr(agent, "system_tz", lambda: "Europe/London")


def stop_after(monkeypatch, n):
    calls = {"n": 0}

    def sleep(_):
        calls["n"] += 1
        if calls["n"] >= n:
            raise Stop

    monkeypatch.setattr(agent.time, "sleep", sleep)


# ---------- time: every event carries the local clock, its offset and the IANA zone ----------

def test_events_carry_local_time_with_offset_and_iana_tz():
    ev = agent.make_event("node.heartbeat", {"battery": 80}, 7, "Europe/London")
    assert ev["tz"] == "Europe/London" and ev["seq"] == 7
    t = datetime.fromisoformat(ev["event_time"])
    assert t.utcoffset() == datetime.now(ZoneInfo("Europe/London")).utcoffset()


def test_local_time_tells_tonights_two_0130s_apart():
    first = agent.local_time(datetime(2026, 10, 25, 0, 30, tzinfo=timezone.utc), "Europe/London")
    second = agent.local_time(datetime(2026, 10, 25, 1, 30, tzinfo=timezone.utc), "Europe/London")
    assert (first, second) == ("2026-10-25T01:30:00+01:00", "2026-10-25T01:30:00+00:00")
    # what the hub makes of them: two instants an hour apart, offsets kept, labelled BST then GMT
    (u1, o1), (u2, o2) = adapters.parse_time(first, "Europe/London"), adapters.parse_time(second, "Europe/London")
    assert (u1, o1, u2, o2) == ("2026-10-25T00:30:00Z", "+01:00", "2026-10-25T01:30:00Z", "+00:00")
    assert adapters.local_label(u1, "Europe/London") == "Sun 01:30 BST"
    assert adapters.local_label(u2, "Europe/London") == "Sun 01:30 GMT"


def test_iana_zone_from_the_system_clock_link():
    assert agent.iana_from_path("/private/var/db/timezone/tz/2024a.1.0/zoneinfo/Europe/London") == "Europe/London"
    assert agent.iana_from_path("/usr/share/zoneinfo/America/Argentina/Buenos_Aires") == "America/Argentina/Buenos_Aires"
    assert agent.iana_from_path("/usr/share/zoneinfo/posix/Asia/Tokyo") == "Asia/Tokyo"
    assert agent.iana_from_path("/etc/localtime") is None
    assert agent.iana_from_path("/usr/share/zoneinfo/Not/AZone") is None


def test_system_tz_override_and_posix_strings(monkeypatch):
    monkeypatch.setenv("TEMPO_AGENT_TZ", "Asia/Tokyo")
    assert agent.system_tz() == "Asia/Tokyo"
    monkeypatch.delenv("TEMPO_AGENT_TZ")
    monkeypatch.setenv("TZ", "GMT0BST,M3.5.0/1,M10.5.0")  # a POSIX rule, not a zone name
    tz = agent.system_tz()
    assert tz != "GMT0BST,M3.5.0/1,M10.5.0" and (tz is None or agent.valid_tz(tz))
    monkeypatch.setenv("TZ", ":Europe/Paris")
    assert agent.system_tz() == "Europe/Paris"
    assert not agent.valid_tz("../../etc/passwd") and not agent.valid_tz(None)


# ---------- finding and pinning the hub ----------

def test_hub_is_pinned_by_person_id():
    me = "p_1234"
    mine = {b"pid": agent.pid_tag(me).encode(), b"v": b"0"}
    theirs = {b"pid": agent.pid_tag("p_other").encode()}
    assert agent.hub_matches(theirs, None)  # before the first join any hub will do
    assert agent.hub_matches(mine, me)
    assert not agent.hub_matches(theirs, me)
    assert not agent.hub_matches({b"v": b"0"}, me)  # a hub that doesn't say whose it is
    assert not agent.hub_matches(None, me)
    assert agent.hub_matches({"person_id": me}, me)
    assert len(agent.pid_tag(me)) == 12 and me not in agent.pid_tag(me)


def test_join_token_only_goes_to_a_hub_the_person_named(state_file, monkeypatch):
    monkeypatch.setenv("TEMPO_JOIN_TOKEN", "secret")
    assert agent.register_body()["join_token"] is None  # discovered hubs never get it
    monkeypatch.setenv("TEMPO_HUB_URL", "http://192.168.1.20:8787")
    assert agent.register_body()["join_token"] == "secret"


def test_join_saves_the_person_id_and_waits_politely_on_403(state_file, monkeypatch):
    monkeypatch.setattr(agent, "discover_hub", lambda person_id=None: None)
    answers = [http_error(403, {"need": "link", "message": "Tap Add a device now"}),
               {"device_id": "d_1", "device_token": "tok", "person_id": "p_1", "joined_via": "join-window"}]
    seen = []

    def fake_http(method, url, body=None, token=None):
        seen.append(url)
        a = answers.pop(0)
        if isinstance(a, Exception):
            raise a
        return a

    monkeypatch.setattr(agent, "http", fake_http)
    monkeypatch.setattr(agent.time, "sleep", lambda s: None)
    st = agent.connect({"seq": 41})
    assert seen == ["http://127.0.0.1:8787/api/devices/register"] * 2
    assert st["person_id"] == "p_1" and st["device_token"] == "tok" and st["hub"] == agent.DEFAULT_HUB
    assert st["seq"] == 41  # seq numbers are never reused


# ---------- privacy: titles never become app names ----------

def test_window_titles_never_become_app_names_on_linux(monkeypatch):
    monkeypatch.setattr(agent, "SYSTEM", "Linux")
    monkeypatch.setattr(agent, "SEND_TITLES", False)
    title = "Re: salary review — Inbox — Mozilla Thunderbird"
    out = {"getwindowname": title, "getwindowpid": ""}
    monkeypatch.setattr(agent, "run", lambda cmd: out[cmd[-1]])
    assert agent.front_app() == (None, None)  # no process name: no app, and never the title
    out["getwindowpid"] = "4242"
    monkeypatch.setattr(agent, "_proc_comm", lambda pid: "thunderbird\n" if pid == "4242" else None)
    assert agent.front_app() == ("thunderbird", None)
    monkeypatch.setattr(agent, "SEND_TITLES", True)
    assert agent.front_app() == ("thunderbird", title)


def test_clean_app_name():
    assert agent.clean_app_name(r"C:\Program Files\Google\Chrome\Application\chrome.exe") == "chrome"
    assert agent.clean_app_name("/usr/lib/firefox/firefox-bin") == "firefox-bin"
    assert agent.clean_app_name("code\n") == "code"
    assert agent.clean_app_name("") is None and agent.clean_app_name(None) is None


# ---------- sending: bounded queue, batches, stop on 401, rediscover when offline ----------

def test_outbox_is_capped_at_1000_keeping_the_newest():
    box = list(range(1500))
    assert agent.cap_outbox(box) == 500
    assert len(box) == 1000 and box[0] == 500 and box[-1] == 1499
    assert agent.cap_outbox(box) == 0


def test_send_posts_in_batches_and_keeps_what_the_hub_did_not_take(monkeypatch):
    sizes = []
    monkeypatch.setattr(agent, "http", lambda m, u, body=None, token=None: sizes.append(len(body["events"])) or {})
    box = [{"kind": "node.heartbeat"}] * 1200
    assert agent.send("http://hub", "tok", box) == "ok" and box == [] and sizes == [500, 500, 200]

    def raises(exc):
        def f(*a, **k):
            raise exc
        return f

    for exc, status, left in ((http_error(401), "removed", 3), (http_error(410), "removed", 3), (http_error(403), "wait", 3),
                              (urllib.error.URLError("down"), "offline", 3), (TimeoutError(), "offline", 3),
                              (http_error(500), "error", 3), (http_error(422, "bad kind"), "rejected", 0)):
        monkeypatch.setattr(agent, "http", raises(exc))
        box = [{"kind": "x"}] * 3
        assert agent.send("http://hub", "tok", box) == status and len(box) == left


def test_401_stops_for_good_instead_of_rejoining(state_file, monkeypatch):
    quiet_machine(monkeypatch)
    monkeypatch.setattr(agent, "http", lambda *a, **k: (_ for _ in ()).throw(http_error(401)))
    monkeypatch.setattr(agent, "connect", lambda *a, **k: pytest.fail("must not re-join"))
    stop_after(monkeypatch, 5)
    agent.save_state({"hub": "http://10.0.0.5:8787", "device_token": "tok", "person_id": "p_1", "seq": 3})
    agent.main()  # returns instead of looping
    st = json.loads(state_file.read_text())
    assert "removed from Tempo" in st["stopped"] and "device_token" not in st
    assert st["person_id"] == "p_1" and st["seq"] >= 4
    agent.main()  # a restart (launchd, next login) stays stopped and doesn't join
    agent.rejoin()
    assert json.loads(state_file.read_text()) == {"seq": st["seq"]}


def test_rediscovers_a_moved_hub_after_repeated_failures(state_file, monkeypatch):
    quiet_machine(monkeypatch)
    old, new = "http://10.0.0.5:8787", "http://10.0.0.9:8787"
    posted = []

    def fake_http(method, url, body=None, token=None):
        if url.startswith(old):
            raise urllib.error.URLError("no route to host")
        posted.extend(body["events"])
        return {}

    asked = []
    monkeypatch.setattr(agent, "http", fake_http)
    monkeypatch.setattr(agent, "discover_hub", lambda person_id=None: asked.append(person_id) or new)
    stop_after(monkeypatch, agent.REDISCOVER_AFTER + 1)
    state = {"hub": old, "device_token": "tok", "person_id": "p_1", "seq": 0}
    with pytest.raises(Stop):
        agent.stream(state)
    assert asked == ["p_1"]  # pinned to this person
    assert state["hub"] == new and json.loads(state_file.read_text())["hub"] == new
    assert posted and all(e["tz"] == "Europe/London" for e in posted)
    assert [e["seq"] for e in posted] == sorted({e["seq"] for e in posted})
    assert any(e["kind"] == "desktop.activity" and e["payload"] == {"app": "Safari", "idle_s": 3} for e in posted)


# ---------- --install carries the settings into the login service ----------

def test_service_env_keeps_tempo_settings_and_drops_the_join_token_once_joined(monkeypatch):
    monkeypatch.setenv("TEMPO_HUB_URL", "http://10.0.0.5:8787")
    monkeypatch.setenv("TEMPO_JOIN_TOKEN", "secret")
    monkeypatch.setenv("TEMPO_AGENT_TITLES", "1")
    monkeypatch.setenv("UNRELATED", "x")
    env = agent.service_env(joined=False)
    assert env["TEMPO_HUB_URL"] == "http://10.0.0.5:8787" and env["TEMPO_JOIN_TOKEN"] == "secret"
    assert env["TEMPO_AGENT_TITLES"] == "1" and "UNRELATED" not in env
    assert "TEMPO_JOIN_TOKEN" not in agent.service_env(joined=True)


def test_launchd_plist_has_env_log_and_stays_stopped_after_a_clean_exit():
    env = {"TEMPO_HUB_URL": "http://10.0.0.5:8787/?a=1&b=<2>", "TEMPO_AGENT_TITLES": "1"}
    p = plistlib.loads(agent.launchd_plist("/py thon", "/x/agent.py", env, "/Users/me/.tempo/agent.log").encode())
    assert p["EnvironmentVariables"] == env
    assert p["ProgramArguments"] == ["/py thon", "/x/agent.py"]
    assert p["KeepAlive"] == {"SuccessfulExit": False} and p["RunAtLoad"] is True
    assert p["StandardOutPath"] == p["StandardErrorPath"] == "/Users/me/.tempo/agent.log"


def test_systemd_unit_and_windows_cmd_carry_env():
    env = {"TEMPO_HUB_URL": "http://h:8787/a%20b", "TEMPO_AGENT_TZ": "Europe/London"}
    unit = agent.systemd_unit("/usr/bin/python3", "/opt/agent.py", env)
    assert 'Environment="TEMPO_HUB_URL=http://h:8787/a%%20b"' in unit
    assert 'Environment="TEMPO_AGENT_TZ=Europe/London"' in unit
    assert "Restart=on-failure" in unit and 'ExecStart="/usr/bin/python3" "/opt/agent.py"' in unit
    cmd = agent.windows_cmd(r"C:\py\python.exe", r"C:\t\agent.py", env)
    assert 'set "TEMPO_HUB_URL=http://h:8787/a%%20b"\r\n' in cmd and cmd.endswith('"C:\\t\\agent.py"\r\n')


def test_install_creates_the_log_folder_joins_first_and_writes_env(state_file, tmp_path, monkeypatch):
    home = tmp_path / "home"
    monkeypatch.setattr(agent.Path, "home", classmethod(lambda cls: home))
    monkeypatch.setattr(agent, "SYSTEM", "Linux")
    ran = []
    monkeypatch.setattr(agent.subprocess, "run", lambda cmd, **k: ran.append(cmd))
    monkeypatch.setattr(agent, "connect", lambda st, once=False: {"hub": "http://10.0.0.5:8787", "device_token": "tok",
                                                                  "person_id": "p_1", "seq": 0})
    monkeypatch.setenv("TEMPO_HUB_URL", "http://10.0.0.5:8787")
    monkeypatch.setenv("TEMPO_JOIN_TOKEN", "secret")
    agent.install()
    assert state_file.parent.is_dir() and json.loads(state_file.read_text())["device_token"] == "tok"
    unit = (home / ".config/systemd/user/tempo-agent.service").read_text()
    assert 'Environment="TEMPO_HUB_URL=http://10.0.0.5:8787"' in unit and "secret" not in unit
    assert ["systemctl", "--user", "enable", "tempo-agent.service"] in ran


# ---------- scripts/simulate.py ----------

def test_simulated_gwr_notification_is_one_signal_event():
    now = datetime(2026, 10, 24, 17, 40, tzinfo=timezone.utc)
    evs = adapters.simple(simulate.tasker_body(now), "notification")
    assert [e["kind"] for e in evs] == ["notification.signal"]
    assert evs[0]["payload"] == {"app": "GWR", "title": "Your 08:12 to London Paddington",
                                 "text": "is delayed by 34 minutes"}
    assert evs[0]["event_tz"] == "Europe/London" and evs[0]["event_offset"] == "+01:00"


def test_simulated_times_follow_the_home_zone_across_the_clock_change():
    before, after = datetime(2026, 10, 24, 17, 0, tzinfo=timezone.utc), datetime(2026, 10, 25, 12, 0, tzinfo=timezone.utc)
    assert {e["event_offset"] for e in adapters.health_auto_export(simulate.health_auto_export_body(before))} == {"+01:00"}
    assert {e["event_offset"] for e in adapters.health_auto_export(simulate.health_auto_export_body(after))} == {"+00:00"}
    hc = adapters.health_connect(simulate.health_connect_body(before))
    assert hc and {e["event_tz"] for e in hc} == {"Europe/London"}


def test_clock_change_pair_is_two_instants():
    for now in (datetime(2026, 10, 24, 17, 0, tzinfo=timezone.utc), datetime(2026, 10, 25, 9, 0, tzinfo=timezone.utc)):
        body = simulate.clock_change_body(now)
        assert [b["time"] for b in body] == ["2026-10-25T01:30:00"] * 2
        assert [e["event_time_utc"] for e in adapters.simple(body, "health")] == ["2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z"]
    assert simulate.repeated_hour(datetime(2026, 11, 20, tzinfo=timezone.utc)) == datetime(2027, 10, 31, 1, 0)


def test_simulate_takes_hub_and_key_or_one_copied_app_url():
    assert simulate.hub_and_key(["http://127.0.0.1:8787/", "k1"]) == ("http://127.0.0.1:8787", "k1")
    assert simulate.hub_and_key(["http://192.168.1.5:8787/api/ingest/health-connect?key=abc123"]) == \
        ("http://192.168.1.5:8787", "abc123")
    assert simulate.hub_and_key(["http://h.local:8787/api/ingest/tasker?key=abcd••••••"]) is None  # masked
    assert simulate.hub_and_key([]) is None
