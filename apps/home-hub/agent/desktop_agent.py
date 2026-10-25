#!/usr/bin/env python3
"""Tempo desktop agent: finds the hub, joins by itself, and streams what this computer is doing.

    python agent/desktop_agent.py            # run in this terminal
    python agent/desktop_agent.py --install  # join now, then start automatically at login (macOS / Windows / Linux)
    python agent/desktop_agent.py --rejoin --install   # after "removed from Tempo": forget the old hub, join again

Joining: on the hub computer it joins by itself (http://127.0.0.1:8787). On another computer, tap
'Add a device now' on a device that uses Tempo, then start the agent with TEMPO_HUB_URL=http://<hub>:8787
(mDNS discovery also works where the hub advertises itself). From another network, also set
TEMPO_JOIN_TOKEN (from your personal link); it is only ever sent to the hub named in TEMPO_HUB_URL.
After the first join the hub is pinned by its person id: another Tempo hub on the network is ignored.
If the hub says this computer was removed (401), the agent stops for good until you run --rejoin.
Privacy: sends the app name (the process name, never a window title), idle time and battery.
Window titles only with TEMPO_AGENT_TITLES=1. Every event carries the local time with its UTC offset
and the IANA zone ('tz'), so tonight's two 01:30s stay two different times.
Standard library only (zeroconf is used for discovery and psutil for battery if they're installed).
"""
from __future__ import annotations

import hashlib
import json
import os
import platform
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape as _xml

try:
    from zoneinfo import ZoneInfo
except ImportError:  # Python < 3.9: no zone names, offsets only
    ZoneInfo = None  # type: ignore[assignment,misc]

STATE = Path(os.environ.get("TEMPO_AGENT_STATE", Path.home() / ".tempo" / "agent.json"))
LOG_FILE = STATE.parent / "agent.log"
INTERVAL = int(os.environ.get("TEMPO_AGENT_INTERVAL", "15"))  # seconds between samples
HEARTBEAT_EVERY = 60
SEND_TITLES = os.environ.get("TEMPO_AGENT_TITLES") == "1"
SYSTEM = platform.system()
DEFAULT_HUB = "http://127.0.0.1:8787"  # the hub on this computer joins us as 'this-computer'
OUTBOX_MAX = 1000      # events kept while the hub can't be reached; the oldest go first
BATCH = 500            # events per POST (the hub takes up to 1000)
REDISCOVER_AFTER = 4   # failed sends in a row before looking for the hub again (its IP may have changed)
LABEL = "io.tempo.agent"


def log(msg: str) -> None:
    print(f"[tempo-agent {datetime.now():%H:%M:%S}] {msg}", flush=True)


# ---------- time: local clock + IANA zone on every event ----------

_TZ_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_+\-]*(/[A-Za-z0-9_+\-]+)*")
WINDOWS_ZONES = {  # `tzutil /g` names for common zones (used when tzlocal isn't installed)
    "GMT Standard Time": "Europe/London", "Greenwich Standard Time": "Atlantic/Reykjavik",
    "W. Europe Standard Time": "Europe/Berlin", "Romance Standard Time": "Europe/Paris",
    "Central Europe Standard Time": "Europe/Budapest", "Central European Standard Time": "Europe/Warsaw",
    "GTB Standard Time": "Europe/Bucharest", "FLE Standard Time": "Europe/Kiev",
    "Eastern Standard Time": "America/New_York", "Central Standard Time": "America/Chicago",
    "Mountain Standard Time": "America/Denver", "Pacific Standard Time": "America/Los_Angeles",
    "India Standard Time": "Asia/Kolkata", "China Standard Time": "Asia/Shanghai",
    "Singapore Standard Time": "Asia/Singapore", "Tokyo Standard Time": "Asia/Tokyo",
    "AUS Eastern Standard Time": "Australia/Sydney", "UTC": "UTC",
}


def _zone(name: str | None):
    if not name or ZoneInfo is None:
        return None
    try:
        return ZoneInfo(name)
    except Exception:  # unknown name, or no tz database on this machine
        return None


def valid_tz(name) -> bool:
    """True for an IANA zone name like 'Europe/London' (POSIX TZ strings like 'GMT0BST,M3.5.0' aren't)."""
    if not isinstance(name, str) or len(name) > 64 or not _TZ_NAME.fullmatch(name):
        return False
    return _zone(name) is not None or _zone("UTC") is None  # no tz database here: trust the shape


def iana_from_path(path: str) -> str | None:
    """'Europe/London' from where /etc/localtime points, e.g. /var/db/timezone/zoneinfo/Europe/London."""
    m = re.search(r"zoneinfo/(?:posix/|right/)?(.+)$", str(path))
    return m.group(1) if m and valid_tz(m.group(1)) else None


def system_tz() -> str | None:
    """The IANA zone this computer's clock is set to, or None if it can't be told.
    TEMPO_AGENT_TZ overrides it (e.g. for a machine kept on UTC)."""
    for name in (os.environ.get("TEMPO_AGENT_TZ"), os.environ.get("TZ", "").lstrip(":")):
        if valid_tz(name):
            return name
    try:
        from tzlocal import get_localzone_name  # optional
        name = get_localzone_name()
        if valid_tz(name):
            return name
    except Exception:
        pass
    if SYSTEM == "Windows":
        return WINDOWS_ZONES.get(run(["tzutil", "/g"]))
    try:
        name = iana_from_path(os.path.realpath("/etc/localtime"))
        if name:
            return name
    except OSError:
        pass
    try:
        name = Path("/etc/timezone").read_text().strip()  # Debian / Ubuntu
        if valid_tz(name):
            return name
    except OSError:
        pass
    name = run(["timedatectl", "show", "-p", "Timezone", "--value"])
    return name if valid_tz(name) else None


def local_time(utc: datetime | None = None, tz: str | None = None) -> str:
    """The local clock with its offset, e.g. '2026-10-25T01:30:00+01:00' then '...01:30:00+00:00'
    an hour later tonight. Read in `tz` when it's known, so the offset always agrees with it."""
    utc = utc or datetime.now(timezone.utc)
    z = _zone(tz)
    return (utc.astimezone(z) if z else utc.astimezone()).isoformat(timespec="seconds")


def make_event(kind: str, payload: dict, seq: int, tz: str | None) -> dict:
    ev = {"kind": kind, "event_time": local_time(tz=tz), "seq": seq, "payload": payload}
    if tz:
        ev["tz"] = tz
    return ev


# ---------- finding the hub ----------

def pid_tag(person_id: str) -> str:
    """The short, one-way person tag a hub advertises in its mDNS TXT record as pid=..."""
    return hashlib.sha256(person_id.encode()).hexdigest()[:12]


def _text(v) -> str | None:
    return v.decode(errors="replace") if isinstance(v, bytes) else (None if v is None else str(v))


def hub_matches(props: dict | None, person_id: str | None) -> bool:
    """Before the first join any Tempo hub will do. After it, only a hub whose TXT record says it
    belongs to the same person (pid=sha256(person_id)[:12]); a hub that doesn't say is ignored."""
    if not person_id:
        return True
    p = {_text(k): _text(v) for k, v in (props or {}).items()}
    return p.get("pid") == pid_tag(person_id) or p.get("person_id") == person_id


def _addresses(info) -> list[str]:
    try:
        addrs = list(info.parsed_addresses())
    except AttributeError:  # old zeroconf
        addrs = [socket.inet_ntoa(a) for a in info.addresses if len(a) == 4]
    return sorted(addrs, key=lambda a: ":" in a)  # IPv4 first


def discover_hub(person_id: str | None = None, timeout: float = 4.0) -> str | None:
    """TEMPO_HUB_URL if set, else a Tempo hub advertised on this network (pinned to person_id)."""
    if os.environ.get("TEMPO_HUB_URL"):
        return os.environ["TEMPO_HUB_URL"].rstrip("/")
    try:
        from zeroconf import ServiceBrowser, Zeroconf
    except ImportError:
        return None
    found: list[str] = []
    ignored: list[str] = []

    class Listener:
        def add_service(self, zc, type_, name):
            try:
                info = zc.get_service_info(type_, name)
                addrs = _addresses(info) if info else []
                if addrs:
                    host = addrs[0] if ":" not in addrs[0] else f"[{addrs[0]}]"
                    url = f"http://{host}:{info.port}"
                    (found if hub_matches(info.properties, person_id) else ignored).append(url)
            except Exception:
                pass

        def update_service(self, *a):
            pass

        def remove_service(self, *a):
            pass

    zc = Zeroconf()
    try:
        ServiceBrowser(zc, "_tempo._tcp.local.", Listener())
        end = time.time() + timeout
        while not found and time.time() < end:
            time.sleep(0.2)
    finally:
        zc.close()
    if ignored and not found:
        log(f"ignored {len(set(ignored))} Tempo hub(s) on this network that aren't yours: {', '.join(sorted(set(ignored)))}")
    return found[0] if found else None


def http(method: str, url: str, body: dict | None = None, token: str | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read() or b"{}")


def _detail(e: urllib.error.HTTPError) -> str:
    """The hub's message from an error response, if it sent one."""
    try:
        d = json.loads(e.read() or b"{}").get("detail")
        return str(d.get("message") if isinstance(d, dict) else d or "")[:300]
    except Exception:
        return ""


def load_state() -> dict:
    try:
        s = json.loads(STATE.read_text())
        return s if isinstance(s, dict) else {}
    except (OSError, ValueError):
        return {}


def save_state(s: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(s, indent=2))
    try:
        STATE.chmod(0o600)
    except OSError:
        pass


def register_body() -> dict:
    name = f"{socket.gethostname().split('.')[0]} · {'Mac' if SYSTEM == 'Darwin' else SYSTEM} agent"
    # The join token is a long-lived secret: only send it to a hub the person named, never to
    # whatever answered on the network.
    token = os.environ.get("TEMPO_JOIN_TOKEN") if os.environ.get("TEMPO_HUB_URL") else None
    return {"name": name, "platform": SYSTEM.lower(), "kind": "laptop",
            "capabilities": ["desktop.activity", "battery", "idle"], "join_token": token}


def join(hub: str) -> dict:
    body = register_body()
    res = http("POST", f"{hub}/api/devices/register", body)
    log(f"joined hub {hub} as '{body['name']}' via {res.get('joined_via')}")
    return {**res, "hub": hub}


def connect(state: dict, once: bool = False) -> dict:
    """Find the hub and join it, waiting politely until we're let in. Returns the new state
    (or the old one if once=True and joining didn't work)."""
    if os.environ.get("TEMPO_JOIN_TOKEN") and not os.environ.get("TEMPO_HUB_URL"):
        log("TEMPO_JOIN_TOKEN is only sent to the hub named in TEMPO_HUB_URL; set that too to use it")
    told = False
    while True:
        hub = discover_hub(state.get("person_id"))
        if not hub:
            if not told:
                log(f"no hub found on the network (no zeroconf, or the hub doesn't advertise); trying "
                    f"this computer at {DEFAULT_HUB}. Set TEMPO_HUB_URL=http://<hub>:8787 to choose one.")
            hub = DEFAULT_HUB
        try:
            return {**join(hub), "seq": int(state.get("seq") or 0)}
        except urllib.error.HTTPError as e:  # before URLError: HTTPError is a kind of URLError
            if e.code == 403:
                if not told:
                    log(f"hub {hub} found, waiting to be let in: tap 'Add a device now' on a device that uses "
                        f"Tempo (or set TEMPO_HUB_URL + TEMPO_JOIN_TOKEN). {_detail(e)}".rstrip())
                wait = 10
            else:
                log(f"hub {hub} answered {e.code} {_detail(e)}".rstrip())
                wait = 15
        except (urllib.error.URLError, OSError, ValueError) as e:
            if not told:
                log(f"hub not reachable at {hub} ({e}); retrying every 15 s")
            wait = 15
        told = True
        if once:
            return state
        time.sleep(wait)


# ---------- reading this computer ----------

def run(cmd: list[str]) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=3).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


_BIDI = re.compile(r"[\u200e\u200f\u202a-\u202e\u2066-\u2069]")


def clean_app_name(name) -> str | None:
    """'chrome' from 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'firefox' from 'firefox\\n'."""
    if not name:
        return None
    base = re.split(r"[\\/]", _BIDI.sub("", str(name)).strip())[-1]
    base = re.sub(r"\.(exe|bin|appimage)$", "", base, flags=re.I).strip()
    return base[:60] or None


def _proc_comm(pid: str) -> str | None:
    try:
        return Path(f"/proc/{pid}/comm").read_text()
    except OSError:
        return None


def _windows_front() -> tuple[str | None, str | None]:
    import ctypes
    from ctypes import wintypes
    user32, kernel32 = ctypes.windll.user32, ctypes.windll.kernel32
    hwnd = user32.GetForegroundWindow()
    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    app = None
    handle = kernel32.OpenProcess(0x1000, False, pid.value)  # PROCESS_QUERY_LIMITED_INFORMATION
    if handle:
        try:
            buf, size = ctypes.create_unicode_buffer(1024), wintypes.DWORD(1024)
            if kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)):
                app = clean_app_name(buf.value)
        finally:
            kernel32.CloseHandle(handle)
    title = None
    if SEND_TITLES:
        n = user32.GetWindowTextLengthW(hwnd)
        tbuf = ctypes.create_unicode_buffer(n + 1)
        user32.GetWindowTextW(hwnd, tbuf, n + 1)
        title = tbuf.value or None
    return app, title


def front_app() -> tuple[str | None, str | None]:
    """(app, title). The app is always a process name, never parsed from a window title; the title is
    read only with TEMPO_AGENT_TITLES=1."""
    if SYSTEM == "Darwin":  # lsappinfo needs no extra permission
        asn = run(["lsappinfo", "front"])
        out = run(["lsappinfo", "info", "-only", "name", asn]) if asn else ""
        m = re.search(r'"(?:LSDisplayName|name)"="([^"]+)"', out)
        return (_BIDI.sub("", m.group(1)).strip()[:60] or None if m else None), None
    if SYSTEM == "Windows":
        try:
            return _windows_front()
        except Exception:
            return None, None
    pid = run(["xdotool", "getactivewindow", "getwindowpid"])  # Linux/X11 if installed
    app = clean_app_name(_proc_comm(pid)) if pid.isdigit() else None
    title = (run(["xdotool", "getactivewindow", "getwindowname"]) or None) if SEND_TITLES else None
    return app, title


def idle_seconds() -> int | None:
    if SYSTEM == "Darwin":
        m = re.search(r'"HIDIdleTime" = (\d+)', run(["ioreg", "-c", "IOHIDSystem"]))
        return int(m.group(1)) // 1_000_000_000 if m else None
    if SYSTEM == "Windows":
        try:
            import ctypes

            class LII(ctypes.Structure):
                _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]
            lii = LII(ctypes.sizeof(LII), 0)
            ctypes.windll.user32.GetLastInputInfo(ctypes.byref(lii))
            return ((ctypes.windll.kernel32.GetTickCount() - lii.dwTime) & 0xFFFFFFFF) // 1000  # tick wraps at ~49 days
        except Exception:
            return None
    out = run(["xprintidle"])
    return int(out) // 1000 if out.isdigit() else None


def battery() -> tuple[int | None, bool | None]:
    if SYSTEM == "Darwin":
        out = run(["pmset", "-g", "batt"])
        m = re.search(r"(\d+)%", out)
        on_ac = "AC Power" in out.splitlines()[0] if out else None  # plugged in, even when 'not charging'
        return (int(m.group(1)), on_ac) if m else (None, None)
    try:
        import psutil  # optional
        b = psutil.sensors_battery()
        return (round(b.percent), b.power_plugged) if b else (None, None)
    except Exception:
        return None, None


# ---------- sending ----------

def cap_outbox(outbox: list) -> int:
    """Keep at most OUTBOX_MAX queued events (the newest). Returns how many were dropped."""
    drop = max(0, len(outbox) - OUTBOX_MAX)
    del outbox[:drop]
    return drop


def send(hub: str, token: str, outbox: list) -> str:
    """POST queued events in batches of BATCH; each batch leaves the queue once the hub has it.
    Returns 'ok', 'offline' (no answer), 'removed' (401/410), 'wait' (403), 'rejected' (the hub will never
    take that batch, so it was dropped rather than blocking the queue) or 'error' (kept for a retry)."""
    while outbox:
        batch = outbox[:BATCH]
        try:
            http("POST", f"{hub}/api/events", {"events": batch}, token)
        except urllib.error.HTTPError as e:
            if e.code in (401, 410):  # unknown or blocked device
                return "removed"
            if e.code == 403:
                return "wait"
            if 400 <= e.code < 500 and e.code not in (408, 425, 429):
                del outbox[:len(batch)]
                log(f"hub refused {len(batch)} events ({e.code} {_detail(e)}); dropped them".rstrip())
                return "rejected"
            return "error"
        except (urllib.error.URLError, OSError):  # includes timeouts
            return "offline"
        except ValueError:  # an answer that isn't JSON: not our hub, or a proxy page
            return "error"
        del outbox[:len(batch)]
    return "ok"


def stop_removed(state: dict) -> dict:
    """The hub no longer knows this device: it was removed from Tempo, or the hub was reset.
    Never re-join silently; stay stopped until the person runs --rejoin."""
    log("STOPPED: the hub no longer accepts this computer (removed from Tempo, or the hub was reset). "
        "It will not re-join by itself. To connect it again run: "
        f"{sys.executable} {Path(__file__).resolve()} --rejoin --install (or just --rejoin to run it in a terminal)")
    stopped = {k: state[k] for k in ("hub", "person_id", "device_id", "seq") if k in state}
    stopped["stopped"] = f"removed from Tempo (hub said 401/410) at {datetime.now().astimezone().isoformat(timespec='seconds')}"
    save_state(stopped)
    return stopped


def stream(state: dict) -> dict:
    """Sample this computer every INTERVAL seconds and push events. Returns only when stopped."""
    hub, token = state["hub"], state["device_token"]
    outbox: list[dict] = []
    last_app, last_beat, seq = None, 0.0, int(state.get("seq") or 0)
    tz = system_tz()
    failures, last_status = 0, "ok"
    log(f"streaming to {hub} every {INTERVAL} s (titles {'on' if SEND_TITLES else 'off'}, time zone {tz or 'unknown'})")
    while True:
        app, title = front_app()
        idle = idle_seconds()
        if app and app != last_app and (idle is None or idle < 1800):
            seq += 1
            payload = {"app": app, "idle_s": idle}
            if SEND_TITLES and title:
                payload["title"] = title[:120]
            outbox.append(make_event("desktop.activity", payload, seq, tz))
            last_app = app
        if time.time() - last_beat >= HEARTBEAT_EVERY:
            tz = system_tz() or tz  # follows the laptop to a new zone
            seq += 1
            pct, charging = battery()
            outbox.append(make_event("node.heartbeat", {"battery": pct, "charging": charging, "idle_s": idle,
                                                        "online": True, "host": socket.gethostname().split(".")[0]},
                                     seq, tz))
            last_beat = time.time()
        if seq != state.get("seq"):
            state["seq"] = seq  # saved when assigned, so a restart never reuses a seq
            save_state(state)
        dropped = cap_outbox(outbox)
        if dropped:
            log(f"queue full: dropped the {dropped} oldest events (keeping the newest {OUTBOX_MAX})")
        status = send(hub, token, outbox) if outbox else "ok"
        if status == "removed":
            return stop_removed(state)
        if status == "offline":
            failures += 1
            if failures >= REDISCOVER_AFTER:
                failures = 0
                found = discover_hub(state.get("person_id"))
                if found and found != hub:
                    log(f"hub moved: {hub} -> {found}")
                    hub = state["hub"] = found
                    save_state(state)
                    continue
        else:
            failures = 0
        if status != last_status:
            log({"ok": f"sending to {hub} again",
                 "offline": f"hub not reachable at {hub}; queueing (up to {OUTBOX_MAX} events)",
                 "wait": "hub refused this device for now (403); keeping events queued and retrying",
                 "rejected": "continuing with the next events",
                 "error": f"hub error; keeping {len(outbox)} events queued"}[status])
            last_status = status
        time.sleep(INTERVAL)


def main() -> None:
    state = load_state()
    if state.get("stopped"):
        log(f"not running: {state['stopped']}. Run with --rejoin --install to connect this computer again.")
        return
    if not state.get("device_token"):
        state = connect(state)
        save_state(state)
    stream(state)


def rejoin() -> None:
    """Forget the saved hub, device and pin (keeps seq) so the next run joins again."""
    seq = load_state().get("seq") or 0
    save_state({"seq": seq})
    log("cleared the saved hub and device; this computer will join again")


# ---------- start at login ----------

def service_env(joined: bool) -> dict[str, str]:
    """TEMPO_* settings (and the X display on Linux) for the login service. The join token is
    left out once this computer has joined: the device token in the state file is enough."""
    keep = ("DISPLAY", "XAUTHORITY", "WAYLAND_DISPLAY")
    return {k: v for k, v in sorted(os.environ.items())
            if (k.startswith("TEMPO_") or k in keep) and not (joined and k == "TEMPO_JOIN_TOKEN")}


def launchd_plist(py: str, script: str, env: dict[str, str], log_path: str) -> str:
    """macOS LaunchAgent: runs at login and restarts after a crash, but not after a clean stop
    (e.g. removed from Tempo)."""
    env_xml = "".join(f"\n    <key>{_xml(k)}</key><string>{_xml(v)}</string>" for k, v in env.items())
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>{LABEL}</string>
  <key>ProgramArguments</key><array><string>{_xml(py)}</string><string>{_xml(script)}</string></array>
  <key>EnvironmentVariables</key><dict>{env_xml}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>{_xml(log_path)}</string>
  <key>StandardErrorPath</key><string>{_xml(log_path)}</string>
</dict></plist>
"""


def _sd(s: str) -> str:
    """Quote a value for a systemd unit file."""
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"').replace("%", "%%") + '"'


def systemd_unit(py: str, script: str, env: dict[str, str]) -> str:
    lines = ["[Unit]", "Description=Tempo agent", "", "[Service]", f"ExecStart={_sd(py)} {_sd(script)}"]
    lines += [f"Environment={_sd(f'{k}={v}')}" for k, v in env.items()]
    lines += ["Restart=on-failure", "RestartSec=30", "", "[Install]", "WantedBy=default.target", ""]
    return "\n".join(lines)


def windows_cmd(py: str, script: str, env: dict[str, str]) -> str:
    sets = "".join(f'set "{k}={v.replace("%", "%%")}"\r\n' for k, v in env.items())
    return f'@echo off\r\n{sets}start "" /min "{py}" "{script}"\r\n'


def install() -> None:
    py, script = sys.executable, str(Path(__file__).resolve())
    STATE.parent.mkdir(parents=True, exist_ok=True)  # launchd won't create the log folder itself
    state = load_state()
    if state.get("stopped"):
        print(f"Note: {state['stopped']}. Run with --rejoin --install to connect it again.")
    elif not state.get("device_token"):
        state = connect(state, once=True)  # join now, in the foreground, so you see the result
        if state.get("device_token"):
            save_state(state)
        else:
            print("Not joined yet; the installed agent keeps trying in the background.")
    env = service_env(joined=bool(state.get("device_token")))
    if SYSTEM == "Darwin":
        plist = Path.home() / f"Library/LaunchAgents/{LABEL}.plist"
        plist.parent.mkdir(parents=True, exist_ok=True)
        plist.write_text(launchd_plist(py, script, env, str(LOG_FILE)))
        plist.chmod(0o600)  # may hold TEMPO_JOIN_TOKEN
        subprocess.run(["launchctl", "unload", str(plist)], capture_output=True)
        subprocess.run(["launchctl", "load", str(plist)])
        print(f"Installed: starts at login ({plist}). Logs: {LOG_FILE}")
    elif SYSTEM == "Windows":
        startup = Path(os.environ["APPDATA"]) / r"Microsoft\Windows\Start Menu\Programs\Startup" / "tempo-agent.cmd"
        startup.write_text(windows_cmd(py, script, env))
        print(f"Installed: starts at login ({startup})")
    else:
        unit = Path.home() / ".config/systemd/user/tempo-agent.service"
        unit.parent.mkdir(parents=True, exist_ok=True)
        unit.write_text(systemd_unit(py, script, env))
        unit.chmod(0o600)
        subprocess.run(["systemctl", "--user", "daemon-reload"])
        subprocess.run(["systemctl", "--user", "enable", "tempo-agent.service"])
        subprocess.run(["systemctl", "--user", "restart", "tempo-agent.service"])
        print(f"Installed: systemd user service ({unit}). Logs: journalctl --user -u tempo-agent")
    if env:
        print("Settings carried into the service: " + ", ".join(env))


if __name__ == "__main__":
    try:
        if "--rejoin" in sys.argv:
            rejoin()
        if "--install" in sys.argv:
            install()
        else:
            main()
    except KeyboardInterrupt:
        pass
