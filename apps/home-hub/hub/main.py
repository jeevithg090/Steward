"""Tempo hub: devices join by themselves, push events into one database, and a model reads it.

Run:  ./run.sh   (uvicorn hub.main:app --host 0.0.0.0 --port 8787 --no-access-log --no-proxy-headers)

Joining without QR codes (safe by default). A device only joins by itself when its request came
straight to this computer (no proxy/tunnel headers, TEMPO_PUBLIC_URL unset) and was addressed to one
of the hub's own names (its LAN IP, <hostname>.local, tempo-hub.local, localhost), which also stops
DNS rebinding. Then:
  * This computer: 127.0.0.1 (or this computer's own LAN address) joins by itself.
  * "Add a device now": an existing device opens a 2-minute join window; any device on the local
    network that opens the hub during that window joins by itself (the desktop agent retries, so it
    joins on its own too).
  * First device: while the person has no device yet, a device on TEMPO_HOME_CIDR joins by itself.
  * Your own network only: TEMPO_LAN_AUTOJOIN=1 with TEMPO_HOME_CIDR=172.20.10.0/28 (e.g. your
    phone hotspot) auto-joins devices on that subnet. Never enable it on shared/venue Wi-Fi.
  * Anywhere else: open your personal link once (/join#t=...), e.g. sent to yourself by text or email.
  * Apps (Health Connect webhook, Health Auto Export, OwnTracks, Shortcuts, Tasker) post to
    /api/ingest/<source>?key=... and appear as devices on their first delivery. Removing one blocks
    it (410) until it is unblocked.
"""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import math
import os
import re
import socket
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any, Literal
from urllib.parse import urlparse

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from . import adapters, db, memory, model

PORT = int(os.environ.get("TEMPO_PORT", "8787"))
WEB_DIR = Path(__file__).resolve().parent.parent / "web"
FORWARD_HEADERS = ("x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "forwarded", "via",
                   "x-real-ip", "cf-connecting-ip", "true-client-ip", "x-client-ip", "fastly-client-ip",
                   "tailscale-user-login", "x-original-forwarded-for", "x-cluster-client-ip", "forwarded-for",
                   "x-envoy-external-address")
JOIN_WINDOW_SECONDS = 120
MAX_BATCH = 1000
MAX_INGEST_BYTES = 20 * 1024 * 1024  # a big first Health Connect sync is a few MB
KIND_PREFIX = r"^[a-z0-9_]+(\.[a-z0-9_]*)*$"
_join_window = {"until": 0.0, "by": None}  # single-use; bound to the device that opened it
_join_lock = threading.Lock()  # check-and-consume is atomic: 12 devices racing one window -> 1 joins


def public_url() -> str | None:
    """TEMPO_PUBLIC_URL (e.g. a tunnel). When set, nothing joins automatically."""
    return os.environ.get("TEMPO_PUBLIC_URL") or None


def lan_autojoin() -> bool:
    return os.environ.get("TEMPO_LAN_AUTOJOIN", "0") == "1"


def home_networks() -> list:
    nets = []
    for part in os.environ.get("TEMPO_HOME_CIDR", "").split(","):
        if part.strip():
            try:
                nets.append(ipaddress.ip_network(part.strip(), strict=False))
            except ValueError:
                print(f"[tempo] ignoring bad TEMPO_HOME_CIDR entry: {part!r}")
    return nets


def in_home_network(ip) -> bool:
    return ip is not None and any(ip in n for n in home_networks())


def lan_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # no packet is sent; this just picks the LAN interface
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def _local_name() -> str:
    host = socket.gethostname().lower()
    return host if host.endswith(".local") else host + ".local"


def base_url() -> str:
    return (public_url() or f"http://{lan_ip()}:{PORT}").rstrip("/")


def name_url() -> str:
    """http://<computer-name>.local:port, for iPhone apps that refuse plain HTTP to bare IP addresses."""
    return (public_url() or f"http://{_local_name()}:{PORT}").rstrip("/")


def mdns_allowed() -> tuple[bool, str]:
    """mDNS advertising needs TEMPO_MDNS=1 and this computer's address inside TEMPO_HOME_CIDR,
    so the hub is never announced on shared/venue Wi-Fi."""
    if os.environ.get("TEMPO_MDNS", "0") != "1":
        return False, "off (set TEMPO_MDNS=1 and TEMPO_HOME_CIDR, on your own network only)"
    ip = lan_ip()
    if not in_home_network(ipaddress.ip_address(ip)):
        return False, f"off: this computer's address {ip} is not inside TEMPO_HOME_CIDR"
    return True, f"on for {ip}"


def join_summary() -> str:
    if public_url():
        return "OFF (TEMPO_PUBLIC_URL is set: devices join with the personal link)"
    nets = ", ".join(map(str, home_networks()))
    parts = ["this computer", "'Add a device now' (2-minute window)"]
    if nets:
        parts.append(f"the first device on {nets}")
        if lan_autojoin():
            parts.append(f"any device on {nets}")
    elif lan_autojoin():
        parts.append("(TEMPO_LAN_AUTOJOIN=1 is ignored without TEMPO_HOME_CIDR)")
    return ", ".join(parts)


async def _advertise(person_id: str):
    ok, why = mdns_allowed()
    if not ok:
        print(f"[tempo] mDNS advertising {why}")
        return None
    try:  # mDNS is a convenience, never a requirement
        from zeroconf import ServiceInfo
        from zeroconf.asyncio import AsyncZeroconf

        pid = hashlib.sha256(person_id.encode()).hexdigest()[:12]  # lets agents pin "my" hub
        zc = AsyncZeroconf()
        info = ServiceInfo("_tempo._tcp.local.", f"Tempo hub {pid[:6]}._tempo._tcp.local.",
                           addresses=[socket.inet_aton(lan_ip())], port=PORT,
                           properties={"path": "/", "v": "0", "pid": pid}, server="tempo-hub.local.")
        await zc.async_register_service(info)
        print(f"[tempo] mDNS advertising {why}")
        return zc
    except Exception as exc:
        print(f"[tempo] mDNS advertising off: {exc}")
        return None


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init()
    person = db.owner()
    try:  # notifications stored before the L1 rule existed get their signal.rail_delay (idempotent)
        if n := memory.prune_signals(person["id"]):
            print(f"[tempo] dropped {n} outdated or no-longer-shared rail signal(s)", flush=True)
        if n := len(memory.derive_signals(person["id"], 0, 5000)):
            print(f"[tempo] derived {n} rail signal(s) from stored notifications", flush=True)
    except Exception as exc:
        print(f"[tempo] signal backfill skipped: {type(exc).__name__}", flush=True)
    zc = await _advertise(person["id"])
    print("\n[tempo] Hub running.")
    if public_url():
        print(f"[tempo] Open from anywhere (TEMPO_PUBLIC_URL):  {base_url()}/")
    else:
        print(f"[tempo] Open on a device on this Wi-Fi:  {base_url()}/")
    # Never print the join token: terminals end up on projectors and in log files.
    print(f"[tempo] Personal link ({'works on any network' if public_url() else 'same Wi-Fi only'}): on a "
          "device that already uses Tempo, open 'Add another device or app' > 'Send my link'.")
    print(f"[tempo] Automatic joining: {join_summary()}\n", flush=True)  # shows up in log files at once
    yield
    if zc:
        await zc.async_close()


def _json_safe(obj: Any) -> Any:
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, str):
        return db.clean_str(obj)
    if isinstance(obj, dict):
        return {db.clean_str(k) if isinstance(k, str) else k: _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(v) for v in obj]
    return obj


class SafeJSONResponse(JSONResponse):
    """JSON that never fails on NaN/Infinity: they become null instead of a 500."""

    def render(self, content: Any) -> bytes:
        return json.dumps(_json_safe(content), ensure_ascii=False, allow_nan=False, default=str,
                          separators=(",", ":")).encode("utf-8")


# /docs and /openapi.json are served to this computer only (see api_docs below), not to the whole Wi-Fi.
app = FastAPI(title="Tempo hub", version="0.1", lifespan=lifespan, default_response_class=SafeJSONResponse,
              docs_url=None, redoc_url=None, openapi_url=None)
if (WEB_DIR / "static").exists():
    app.mount("/static", StaticFiles(directory=WEB_DIR / "static"), name="static")
if (WEB_DIR / "oxbank").exists():  # the demo bank the Navigator drives on the phone (web/oxbank/index.html)
    app.mount("/oxbank", StaticFiles(directory=WEB_DIR / "oxbank", html=True), name="oxbank")

MAX_BODY_BYTES = 64 * 1024  # everything except /api/ingest/* (which has its own 20 MB cap) and Bridge clips
BRIDGE_DRAFT_BYTES = 2 * 1024 * 1024 + 64 * 1024  # a ≤2 MB voice clip plus its multipart envelope


class BodyCap:
    """Refuse oversized bodies before anything parses them, so an unauthenticated caller (e.g. via the
    tunnel) can't make the hub buffer hundreds of MB just to be told 401."""

    def __init__(self, app_, limit: int = MAX_BODY_BYTES):
        self.app, self.limit = app_, limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["path"].startswith("/api/ingest/"):
            return await self.app(scope, receive, send)
        limit = BRIDGE_DRAFT_BYTES if scope["path"] == "/api/bridge/draft" else self.limit
        length = dict(scope.get("headers") or []).get(b"content-length", b"")
        if length.isdigit() and int(length) > limit:
            return await SafeJSONResponse({"detail": "Request too large"}, status_code=413)(scope, receive, send)
        seen = 0

        async def capped():
            nonlocal seen
            msg = await receive()
            if msg.get("type") == "http.request":
                seen += len(msg.get("body") or b"")
                if seen > limit:
                    raise HTTPException(413, "Request too large")
            return msg

        return await self.app(scope, capped, send)


app.add_middleware(BodyCap)


@app.exception_handler(RequestValidationError)
async def _validation_error(_: Request, exc: RequestValidationError):
    # The default handler echoes the input, and a NaN in it would turn the 422 into a 500.
    return SafeJSONResponse(status_code=422, content={"detail": jsonable_encoder(exc.errors())})


# ---------- helpers ----------

def _client_ip(request: Request):
    host = request.client.host if request.client else ""
    if host == "testclient":
        host = os.environ.get("TEMPO_TEST_CLIENT_IP", "8.8.8.8")  # tests choose the caller's address
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return None
    return (ip.ipv4_mapped or ip) if ip.version == 6 else ip


def _server_ip(request: Request) -> str:
    """The local address this connection arrived on (uvicorn's socket name)."""
    return str((request.scope.get("server") or ("",))[0] or "")


def proxied(request: Request) -> bool:
    return bool(public_url()) or via_tunnel(request)


def via_tunnel(request: Request) -> bool:
    """This request came through a proxy or tunnel (forwarding headers, or addressed to TEMPO_PUBLIC_URL's host)."""
    if any(h in request.headers for h in FORWARD_HEADERS):
        return True
    pub = (urlparse(public_url() or "").hostname or "").lower()
    return bool(pub) and request.headers.get("host", "").split(":")[0].rstrip(".").lower() == pub


def hub_hostnames(request: Request) -> set[str]:
    names = {lan_ip(), _local_name(), "tempo-hub.local", "localhost", "127.0.0.1", "::1"}
    try:  # an IP literal can't be DNS-rebound, so the address the client connected to is fine too
        names.add(str(ipaddress.ip_address(_server_ip(request))))
    except ValueError:
        pass
    if request.client and request.client.host == "testclient":
        names.add("testserver")
    return names


def host_allowed(request: Request) -> bool:
    """The Host header names this hub, not some other domain that resolves to it (DNS rebinding)."""
    return (request.url.hostname or "").lower().rstrip(".") in hub_hostnames(request)


def this_computer(request: Request) -> bool:
    """A request straight from the hub computer itself (loopback or its own LAN address), not via a proxy."""
    ip = _client_ip(request)
    return (ip is not None and not proxied(request) and host_allowed(request)
            and (ip.is_loopback or str(ip) == _server_ip(request)))


def _has_device(person_id: str) -> bool:
    """Any active phone/computer/browser (apps that push to us don't count: they can't let others in)."""
    return db.conn().execute("SELECT 1 FROM devices WHERE person_id=? AND removed=0 "
                             "AND coalesce(kind, '') <> 'integration' LIMIT 1", (person_id,)).fetchone() is not None


def join_route(request: Request) -> str | None:
    """How a device without a token may join, or None. Anything that came through a proxy or tunnel,
    or was addressed to a name that isn't this hub's, never auto-joins (raw TCP tunnels look like
    127.0.0.1, hence the PUBLIC_URL check)."""
    if proxied(request) or not host_allowed(request):
        return None
    ip = _client_ip(request)
    if ip is None:
        return None
    if this_computer(request):
        # A raw TCP tunnel or ssh -L also arrives as 127.0.0.1 with no forwarding header, so the hub computer
        # only joins by itself for the very first device, or while an 'Add a device now' window is open.
        if not _has_device(db.owner()["id"]) or time.time() < _join_window["until"]:
            return "this-computer"
        return None
    home = in_home_network(ip)
    if not (ip.is_private or home) or (home_networks() and not home):
        return None  # with TEMPO_HOME_CIDR set, only that range joins (venue Wi-Fi is private too)
    if home and lan_autojoin():
        return "home-network"
    if home and not _has_device(db.owner()["id"]):
        return "first-device"
    if time.time() < _join_window["until"]:  # checked last, so the routes above never use up the window
        return "join-window"
    return None


ASK_ONLY_PATHS = {"/api/ask", "/api/me"}
HANDS_PATHS = {"/api/hands/log", "/api/money/events", "/api/me"}  # a 'hands' device (phone/laptop agent) writes its audit log and the money ledger, reads nothing
ADMIN_JOINS = {"this-computer", "link", "first-device", "home-network"}  # home-network needs TEMPO_HOME_CIDR now
# Server mode: all the Kairos app and its voice agent need from the internet. Everything else (events, timeline,
# money, approvals, hands, Guardian, integrations) answers only on this computer or its Wi-Fi, whatever the token.
TUNNEL_PATHS = {"/api/me", "/api/ask", "/api/voice/session", "/api/consents"}
TUNNEL_PREFIXES = ("/api/bridge/",)
OWNER_ONLY_CAPS = {"vault", "hands", "guardian"}  # granted only by scripts/device_admin.py, never at sign-up


def _caps(dev: dict) -> list:
    caps = dev.get("capabilities")
    if isinstance(caps, str):
        try:
            caps = json.loads(caps or "[]")
        except ValueError:
            caps = []
    return caps if isinstance(caps, list) else []


def guardian_device(dev: dict) -> bool:
    """The Guardian process's own device (device_admin.py add-guardian / guardian/run.py): the capability alone is
    not enough, so a device that registered itself can never write protection alerts."""
    return "guardian" in _caps(dev) and dev.get("kind") == "guardian" and dev.get("joined_via") == "owner-cli"


def server_mode() -> bool:
    """KAIROS_SERVER_MODE=1: the hub is Kairos's server, reached by the app through the tunnel. Trust then comes
    from each token's capabilities instead of 'came through the tunnel = ask-only'; household controls (admin
    routes) still work only from this computer or its Wi-Fi (admin_device)."""
    return os.environ.get("KAIROS_SERVER_MODE") == "1"


def ask_only(dev: dict, request: Request) -> bool:
    """Voice agents (and, unless in server mode, anything arriving through a tunnel/proxy) may only ask
    questions (and say who they are)."""
    return dev.get("kind") == "agent" or "ask" in _caps(dev) or (via_tunnel(request) and not server_mode())


def current_device(request: Request, authorization: str = Header(default="")) -> dict:
    token = authorization.removeprefix("Bearer ").strip()
    dev = db.device_by_token(token) if token else None
    if not dev:
        if token and db.token_was_removed(token):  # 410, not 401: a removed tab must not re-join by itself
            raise HTTPException(410, "This device was removed from Tempo. To use it again, tap 'Add a device "
                                     "now' on a device that already uses Tempo, then 'Join now' here.")
        raise HTTPException(401, "Unknown device. Open Tempo on this device to join.")
    dev = dict(dev)
    dev["ask_only"] = ask_only(dev, request)
    path = request.url.path
    if server_mode() and via_tunnel(request):
        if path not in TUNNEL_PATHS and not path.startswith(TUNNEL_PREFIXES):
            raise HTTPException(403, "This works only on the hub computer or its Wi-Fi, not over the internet.")
        if dev.get("joined_via") == "join-window":  # joined during a 2-minute Wi-Fi window: lower trust, LAN only
            raise HTTPException(403, "A device added with 'Add a device now' works only on the hub's Wi-Fi.")
    if dev["ask_only"] and path not in ASK_ONLY_PATHS:
        raise HTTPException(403, "This device can only ask questions.")
    if "hands" in _caps(dev) and request.url.path not in HANDS_PATHS:
        raise HTTPException(403, "This device can only write the hands log.")
    db.touch_device(dev["id"])
    return dev


def admin_device(request: Request, dev: dict = Depends(current_device)) -> dict:
    """Household controls (add/remove devices, keys, links, forgetting) stay with devices the person set up
    directly; devices that came in through an 'Add a device now' window can read and ask, not administer.
    Never through the tunnel, even in server mode: a leaked phone token can't take over the hub."""
    if dev["ask_only"] or dev.get("joined_via") not in ADMIN_JOINS:
        raise HTTPException(403, "Do this from the device you set Tempo up on (or one joined with your personal link).")
    if via_tunnel(request):
        raise HTTPException(403, "Household controls work only on the hub computer or its Wi-Fi, never over the internet.")
    return dev


def _person(person_id: str):
    return db.conn().execute("SELECT * FROM persons WHERE id=?", (person_id,)).fetchone()


def _hub_event(dev: dict, kind: str, payload: dict, private: bool = False) -> None:
    ev: dict[str, Any] = {"kind": kind, "payload": payload}
    if private:
        ev["class"] = "vault"  # the person's own devices see it; ask-only callers, remote models and agents don't
    db.insert_events(dev["person_id"], dev["id"], [ev], source="hub", trust_level="hub")


def _signal_brief(e: dict, with_text: bool) -> dict:
    """L1 only (who, when, the parsed rail facts); the notification's own text only for a Conductor on this
    machine or network, and even then wrapped as untrusted data."""
    p = e.get("payload") or {}
    brief = {"id": e["id"], "ref": f"#{e['hub_seq']}", "kind": e["kind"], "time": e["event_time_utc"],
             "local": adapters.local_label(e["event_time_utc"], e.get("event_tz"), e.get("event_offset"), mark_repeat=True),
             "app": p.get("app") if isinstance(p.get("app"), str) else None, "simulated": memory.is_simulated(e),
             **memory.rail_fields(e)}
    if with_text:
        brief["text"] = memory.safe_text(e)
    return brief


def _post_to_conductor(url: str, body: dict) -> None:
    try:
        httpx.post(url, json=body, timeout=5).raise_for_status()
    except Exception as exc:  # the Conductor being down must never affect the hub
        print(f"[tempo] TEMPO_CONDUCTOR_URL didn't take the signal: {type(exc).__name__}", flush=True)


def conductor(person_id: str, after_hub_seq: int) -> list[dict]:
    """After new events are stored: run the mock Conductor rule (rail delay -> mission.suggested) over the
    new notification.signal events, and, when TEMPO_CONDUCTOR_URL is set, POST the new signals there in the
    background. Only allow-listed apps' signals (TEMPO_NOTIFY_APPS) leave the hub. Never breaks intake.
    First, rail delay notifications get their L1 signal.rail_delay (memory.rail_signal)."""
    try:
        memory.derive_signals(person_id, after_hub_seq)
    except Exception as exc:
        print(f"[tempo] signal rule skipped: {type(exc).__name__}", flush=True)
    try:
        suggestions = memory.conductor_scan(person_id, after_hub_seq)
    except Exception as exc:
        print(f"[tempo] mock Conductor rule skipped: {type(exc).__name__}", flush=True)
        suggestions = []
    url = os.environ.get("TEMPO_CONDUCTOR_URL")
    if url:
        try:
            new = [e for e in db.events_after(person_id, after_hub_seq, 500)
                   if e["kind"] == "notification.signal" and not memory.is_hidden(e)]
        except Exception:
            new = []
        if new:
            local = model.vault_allowed(url)
            shared = {e["id"] for e in new}  # suggestions only from notifications that may leave the hub
            body = {"hub": "Tempo", "signals": [_signal_brief(e, local) for e in new],
                    "suggestions": [{"text": s.get("suggestion"), "ref": s.get("ref"), "amount_gbp": s.get("amount_gbp"),
                                     "trust_level": "untrusted-derived", "simulated": bool(s.get("_simulated") or s.get("simulated"))}
                                    for s in suggestions if s.get("from_event") in shared]}
            threading.Thread(target=_post_to_conductor, args=(url, body), daemon=True).start()
    return suggestions


# ---------- web client ----------

@app.get("/", include_in_schema=False)
@app.get("/join", include_in_schema=False)
def index():
    return FileResponse(WEB_DIR / "index.html")


@app.get("/manifest.json", include_in_schema=False)
def manifest():
    return FileResponse(WEB_DIR / "manifest.json", media_type="application/manifest+json")


@app.get("/openapi.json", include_in_schema=False)
def openapi_json(request: Request):
    """The API schema, for whoever sits at the hub computer (not the whole Wi-Fi)."""
    if not this_computer(request):
        raise HTTPException(404, "Not Found")
    return app.openapi()


@app.get("/docs", include_in_schema=False)
def api_docs(request: Request):
    if not this_computer(request):
        raise HTTPException(404, "Not Found")
    return get_swagger_ui_html(openapi_url="/openapi.json", title="Tempo hub API")


@app.get("/api/hello")
def hello():
    """Unauthenticated, so it says only that this is a Tempo hub (no activity counter, no join state)."""
    return {"hub": "Tempo", "version": app.version}


# ---------- devices ----------

class RegisterIn(BaseModel):
    name: str = "Unnamed device"
    platform: str | None = None
    kind: str | None = None  # phone | laptop | tablet | watch | browser
    capabilities: list[str] = Field(default_factory=list)
    join_token: str | None = None


@app.post("/api/devices/register")
def register(body: RegisterIn, request: Request):
    person = None
    via = None
    if body.join_token:
        person = db.person_by_join_token(body.join_token)
        via = "link"
    opened_by = None
    with _join_lock:
        if person is None and (route := join_route(request)):
            person = db.owner()
            via = route
            if via == "join-window":  # single-use: the first device through closes it
                opened_by = _join_window["by"]
                _join_window.update(until=0.0, by=None)
        if person is None:
            raise HTTPException(403, detail={"need": "link", "message":
                "Not connected yet. On a device that already uses Tempo, tap 'Add a device now', then tap "
                "'Join now' here. Or open your personal Tempo link on this device."})
        ua = request.headers.get("user-agent")
        caps = [c for c in body.capabilities if str(c).strip().lower() not in OWNER_ONLY_CAPS]  # owner-only grants
        dev = db.add_device(person["id"], body.name, body.platform, body.kind, caps, via, ua)
    who = {"opened_by": opened_by, "ip": str(_client_ip(request)), "user_agent": db.clean_str((ua or "")[:160])} \
        if opened_by else {}  # the name is whatever the device chose; the address and browser help spot an intruder
    db.insert_events(person["id"], dev["id"], [{
        "kind": "device.joined", "class": "mission",
        "payload": {"name": dev["name"], "platform": dev["platform"], "kind": dev["kind"], "via": via, **who}}],
        source="hub", trust_level="hub")
    return {"device_id": dev["id"], "device_token": dev["token"], "name": dev["name"], "person_id": person["id"],
            "person_name": person["name"], "joined_via": via, "hub_seq": db.latest_hub_seq()}


@app.post("/api/join-window")
def open_join_window(dev: dict = Depends(admin_device)):
    """'Add a device now': for 2 minutes, devices on the local network that open the hub join by themselves.
    Every join is announced to all devices as a device.joined event."""
    _join_window.update(until=time.time() + JOIN_WINDOW_SECONDS, by=dev["id"])
    _hub_event(dev, "device.join_window_opened", {"seconds": JOIN_WINDOW_SECONDS, "by": dev["name"]})
    return {"open_for_seconds": JOIN_WINDOW_SECONDS}


@app.get("/api/me")
def me(dev: dict = Depends(current_device)):
    out = {"device_id": dev["id"], "name": dev["name"], "person_id": dev["person_id"], "joined_via": dev["joined_via"]}
    if not dev["ask_only"] and "hands" not in _caps(dev):  # a live counter of every event: only for devices that sync
        out["hub_seq"] = db.latest_hub_seq()
    return out


def _blocked_apps(person_id: str) -> list[dict]:
    """Apps the person removed (and hasn't re-added): their deliveries get 410 until unblocked."""
    rows = db.conn().execute(
        "SELECT id, name, platform FROM devices d WHERE person_id=? AND kind='integration' AND removed=1 "
        "AND NOT EXISTS (SELECT 1 FROM devices a WHERE a.person_id=d.person_id AND a.kind='integration' "
        "AND a.platform=d.platform AND a.removed=0) ORDER BY created_at DESC", (person_id,)).fetchall()
    out: dict[str, dict] = {}
    for r in rows:
        out.setdefault(r["platform"], {"id": r["id"], "name": r["name"], "source": r["platform"]})
    return list(out.values())


@app.get("/api/devices")
def devices(dev: dict = Depends(current_device)):
    return {"devices": db.list_devices(dev["person_id"]), "you": dev["id"],
            "blocked": _blocked_apps(dev["person_id"])}


def _device_row(person_id: str, device_id: str):
    return db.conn().execute("SELECT * FROM devices WHERE id=? AND person_id=?", (device_id, person_id)).fetchone()


@app.delete("/api/devices/{device_id}")
def remove(device_id: str, dev: dict = Depends(admin_device)):
    """Remove a device. For an app (integration) this blocks it: its deliveries get 410 until unblocked."""
    row = _device_row(dev["person_id"], device_id)
    if not row or not db.remove_device(dev["person_id"], device_id):
        raise HTTPException(404, "No such device")
    is_app = row["kind"] == "integration"
    _hub_event(dev, "device.removed", {"device_id": device_id, "blocked": is_app})
    if row["platform"] in ("signals", "conductor"):  # its shared signals / pending suggestions go now, not at restart
        memory.prune_signals(dev["person_id"])
    out = {"removed": device_id, "blocked": is_app}
    if is_app:
        out["note"] = f"{row['name']} is blocked: it can't send anything until you unblock it."
    return out


@app.post("/api/devices/{device_id}/unblock")
def unblock(device_id: str, dev: dict = Depends(admin_device)):
    """Let a removed app send again (its old URL works again)."""
    row = _device_row(dev["person_id"], device_id)
    if not row:
        raise HTTPException(404, "No such device")
    if row["kind"] != "integration":
        raise HTTPException(400, "Only apps can be unblocked. A removed phone or computer joins again by "
                                 "opening Tempo ('Add a device now', or your personal link).")
    restored = db.restore_integration(dev["person_id"], row["platform"])
    _hub_event(dev, "device.unblocked", {"device_id": restored["id"], "source": row["platform"]})
    return {"unblocked": restored["id"], "source": row["platform"], "name": restored["name"]}


@app.get("/api/link")
def personal_link(dev: dict = Depends(admin_device)):
    person = _person(dev["person_id"])
    anywhere = bool(public_url())
    _hub_event(dev, "hub.link_shown", {"by": dev["name"]})  # every device sees who fetched the permanent link
    tok = person["join_token"]
    return {"link": f"{base_url()}/join#t={tok}", "masked": f"{base_url()}/join#t={tok[:4]}••••",
            "works": "anywhere" if anywhere else "same-wifi",
            "label": "Works on any network." if anywhere else
                     "Same Wi-Fi only: this link works on devices on this hub's network (TEMPO_PUBLIC_URL isn't set)."}


class RotateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    join_token: bool = True
    ingest_key: bool = True


@app.post("/api/rotate")
@app.post("/api/keys/rotate")
def rotate(body: RotateIn | None = None, dev: dict = Depends(admin_device)):
    """New personal link and/or app key. Joined devices keep working; old links and app URLs stop."""
    body = body or RotateIn()
    if not (body.join_token or body.ingest_key):
        raise HTTPException(400, "Nothing to rotate: set join_token and/or ingest_key to true.")
    person = db.rotate_keys(dev["person_id"], join_token=body.join_token, ingest_key=body.ingest_key)
    rotated = [k for k in ("join_token", "ingest_key") if getattr(body, k)]
    _hub_event(dev, "hub.keys_rotated", {"rotated": rotated, "by": dev["name"]})
    return {"rotated": rotated, "link": f"{base_url()}/join#t={person['join_token']}",
            "note": "Old personal links stop working." + (
                " Paste the new app URLs into each app (Health Connect, Health Auto Export, OwnTracks...)."
                if body.ingest_key else "")}


# ---------- events ----------

class EventIn(BaseModel):
    kind: str
    payload: dict[str, Any] = Field(default_factory=dict)
    event_time: str | int | float | dict[str, Any] | None = None  # or envelope v1 {utc|local, offset, tz, fold}
    id: str | None = None
    seq: int | None = Field(default=None, ge=0, le=2 ** 53)  # SQLite can't store bigger; 2^53 is JS-safe
    hlc: str | None = None
    tz: str | None = None
    fold: str | None = None  # "earlier" | "later" for naive local times in a repeated hour (clocks go back)
    cls: str | None = Field(default=None, alias="class")
    alg: str | None = None   # envelope v1 security fields: stored now, verified later
    sig: str | None = None
    deps: list[str] | None = None
    base: str | None = None
    consent_scope: str | None = None
    v: str | int | None = None
    body_raw: str | None = None  # the exact signed body string
    body: Any = None             # envelope v1 spelling of body_raw (kept only when it is a string)


class EventsIn(BaseModel):
    events: list[EventIn]


def _reject_whatsapp(kinds) -> None:
    """message.whatsapp comes only from the signed, loopback-only WhatsApp source, never another app or device."""
    if any(db.norm_kind(k) == "message.whatsapp" for k in kinds):
        raise HTTPException(422, "message.whatsapp is only accepted from wacli via /api/ingest/whatsapp; nothing was stored.")


def _reject_reserved(kinds, allow: tuple = ()) -> None:
    """`allow` lists reserved prefixes this caller may write (the Guardian device writes guardian.*)."""
    bad = sorted({db.norm_kind(k) for k in kinds if db.is_reserved_kind(k) and not db.norm_kind(k).startswith(allow)})
    if bad:
        raise HTTPException(422, detail={"message": "Only the hub writes kinds starting with "
                                         f"{', '.join(repr(p) for p in db.RESERVED_PREFIXES)}; nothing was stored.",
                                         "kinds": bad[:20]})


@app.post("/api/events")
def post_events(body: EventsIn, dev: dict = Depends(current_device)):
    if len(body.events) > MAX_BATCH:
        raise HTTPException(413, f"At most {MAX_BATCH} events per request; send the rest in another one.")
    guardian = guardian_device(dev)  # the Guardian process (guardian/run.py): writes guardian.* as an agent-trust source
    _reject_reserved((e.kind for e in body.events), allow=("guardian.",) if guardian else ())
    _reject_whatsapp(e.kind for e in body.events)
    evs = []
    for e in body.events:
        t = adapters.event_time_fields(e.event_time, e.tz, e.fold)
        evs.append({"kind": e.kind, "payload": e.payload, "event_time_utc": t["event_time_utc"],
                    "event_offset": t["event_offset"], "event_tz": t["event_tz"], "fold": t["fold"],
                    "id": e.id, "seq": e.seq, "hlc": e.hlc, "class": e.cls, "alg": e.alg, "sig": e.sig,
                    "deps": e.deps, "base": e.base, "consent_scope": e.consent_scope, "v": e.v,
                    "body_raw": e.body_raw if e.body_raw is not None else (e.body if isinstance(e.body, str) else None)})
    seq0 = db.latest_hub_seq()
    try:
        stored = db.insert_events(dev["person_id"], dev["id"], evs, source=dev["platform"] or dev["kind"],
                                  trust_level="agent" if guardian else "device")
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    acc, dup = stored
    out = {"accepted": acc, "duplicates": dup, "hub_seq": db.latest_hub_seq()}
    if stored.forgotten:
        out["forgotten"] = stored.forgotten  # counted in duplicates too: records the person asked to forget
    if acc and any(db.norm_kind(e.kind) == "notification.signal" for e in body.events):
        if suggested := conductor(dev["person_id"], seq0):
            out["suggested"] = len(suggested)
    return out


@app.get("/api/events")
def get_events(after: int = 0, limit: int = 500, dev: dict = Depends(current_device)):
    """Everything after hub sequence `after`. latest_hub_seq lets a client notice the hub was reset
    (latest_hub_seq < its cursor) and start again."""
    after = max(0, min(after, 2 ** 62))
    evs = db.events_after(dev["person_id"], after, limit)
    for e in evs:  # private messages: the data syncs as is, but a page shows only '[notification from X hidden]'
        if memory.is_hidden(e):
            e["hidden"], e["display_text"] = True, memory.redact(e)["text"]
    return {"events": evs, "hub_seq": evs[-1]["hub_seq"] if evs else after, "latest_hub_seq": db.latest_hub_seq()}


@app.get("/api/timeline")
def get_timeline(hours: float | None = None, kinds: str | None = None, limit: int = 100,
                 start: str | None = None, end: str | None = None, dev: dict = Depends(current_device)):
    """The model's view of the log: the last `hours` (default 24) or start..end (ISO 8601), kinds as prefixes."""
    try:
        return memory.get_timeline(dev["person_id"], hours, kinds.split(",") if kinds else None, limit,
                                   start=start, end=end)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.get("/api/profile")
def get_profile(dev: dict = Depends(current_device)):
    return memory.get_profile(dev["person_id"])


# ---------- forget ----------

class ForgetIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ids: list[str] | None = None
    device_id: str | None = None
    kinds: list[Annotated[str, Field(pattern=KIND_PREFIX, max_length=80)]] | None = Field(default=None, max_length=20)
    kind_prefix: str | None = Field(default=None, pattern=KIND_PREFIX)
    all: bool = False


def _backup() -> Path:
    """A copy of the whole database in <db dir>/backups/<UTC time>.db, taken before a delete-all."""
    folder = db.DB_PATH.parent / "backups"
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = db.backup_to(folder / f"{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.db")
    # Write for me drafts and call sessions are short-lived by design: not part of the undo copy. VACUUM, so the
    # deleted rows don't linger in free pages.
    import sqlite3
    b = sqlite3.connect(path)
    try:
        for table in ("drafts", "kairos_sessions"):
            if b.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
                b.execute(f"DELETE FROM {table}")
        b.commit()
        b.execute("VACUUM")
    finally:
        b.close()
    return path


def _clean_ids(ids) -> list[str]:
    out = [str(i).strip() for i in ids or [] if str(i).strip()]
    return [i for i in out if not re.fullmatch(r"#\d{19,}", i)][:5000]  # a '#ref' bigger than SQLite allows


def _refs_for(person_id: str, ids: list[str], device_id: str | None = None) -> list[str]:
    """The '#hub_seq' refs of the stored events these ids/refs name, so clients can drop their copies."""
    c = db.conn()
    seqs: set[int] = set()
    for s in ids:
        if re.fullmatch(r"#\d+", s):
            rows = c.execute("SELECT hub_seq FROM events WHERE person_id=? AND hub_seq=?", (person_id, int(s[1:])))
        else:
            rows = c.execute(
                "SELECT hub_seq FROM events WHERE person_id=? AND (id=? OR id=? OR (client_id=? AND (? IS NULL OR device_id=?)))",
                (person_id, s, f"{device_id}:{s}" if device_id else s, s, device_id, device_id))
        seqs.update(r[0] for r in rows)
    return [f"#{n}" for n in sorted(seqs)]


def _forget(dev: dict, ids=None, device_id: str | None = None, kind_prefix: str | None = None,
            everything: bool = False, reason: str = "forget", extra: dict | None = None,
            receipt_if_none: bool = True, kinds: list[str] | None = None) -> dict:
    """Delete, leave tombstones (db does that, so re-sent copies are dropped), then append a hub
    'forget.done' receipt holding only refs / the selector and a count, never the content, so every
    open page and agent cache can drop its copies."""
    person_id = dev["person_id"]
    out: dict[str, Any] = {}
    refs = None
    derived: list[str] = []
    if everything:
        out["backup"] = _backup().name
    if ids:
        ids = _clean_ids(ids)
        refs = _refs_for(person_id, ids, device_id)
        n = db.delete_ids(person_id, ids, device_id=device_id, reason=reason, derived=derived)
    else:
        n = db.forget(person_id, device_id, kind_prefix, everything=everything, kinds=kinds, derived=derived)
    rail = reason != "deleted by the app" and (everything or derived or device_id or (kinds and any(str(k).startswith(("notification", "signal")) for k in kinds))
            or (kind_prefix and ("notification".startswith(kind_prefix) or kind_prefix.startswith(("notification", "signal"))))
            or (ids and reason != "deleted by the app"))
    if rail:  # rail signals are rebuilt from the alerts still stored: nothing from a forgotten alert lingers
        try:
            memory.rebuild_signals(person_id)
        except Exception as exc:
            print(f"[tempo] rebuilding signals skipped: {type(exc).__name__}", flush=True)
    if n or receipt_if_none:
        receipt: dict[str, Any] = {"count": n, "reason": reason, "by": dev["name"], **(extra or {})}
        if refs is not None:
            receipt["refs"] = refs
        if derived:
            receipt["derived_refs"] = derived  # e.g. a suggestion made from a forgotten notification
        if device_id:
            receipt["device_id"] = device_id
        if kind_prefix:
            receipt["kind_prefix"] = kind_prefix
        if kinds:
            receipt["kinds"] = sorted(set(kinds))
        if everything:
            receipt["all"] = True
        # Private: a receipt says when and what kind of thing was forgotten (a WhatsApp 'delete for everyone',
        # a health category), which ask-only callers and agents must not learn.
        _hub_event(dev, "forget.done", receipt, private=True)
        url = os.environ.get("TEMPO_CONDUCTOR_URL")
        if url and everything:
            threading.Thread(target=_post_to_conductor, args=(url, {"hub": "Tempo", "forget": {"all": True, "count": n}}),
                             daemon=True).start()
        elif url and reason != "deleted by the app" and (refs or derived):
            # spec §4.7: the Conductor drops its copies too: only refs it could hold, and a count
            threading.Thread(target=_post_to_conductor, args=(url, {"hub": "Tempo", "forget": {
                "refs": refs or [], "derived_refs": derived, "count": n}}), daemon=True).start()
    return {"deleted_events": n, **out}


@app.post("/api/forget")
def forget(body: ForgetIn, dev: dict = Depends(admin_device)):
    """Forget ids / '#refs', a device's events, exact kinds (a profile fact's whole topic), a kind prefix,
    or everything (all=true, after a backup)."""
    if not (body.ids or body.device_id or body.kinds or body.kind_prefix or body.all):
        raise HTTPException(400, "Say what to forget: ids, device_id, kinds, kind_prefix, or all=true.")
    if body.all and (body.ids or body.device_id or body.kinds or body.kind_prefix):
        raise HTTPException(400, "all=true forgets everything; don't combine it with other selectors.")
    if body.ids and body.kinds:
        raise HTTPException(400, "Forget either ids or kinds, not both at once.")
    return _forget(dev, ids=body.ids, device_id=body.device_id, kind_prefix=body.kind_prefix,
                   everything=body.all, kinds=body.kinds)


def _request_selector(p: dict) -> dict:
    """What a forget.requested event asks for, as a forget selector: {ids} / {kind_prefix} / {device_id},
    or {} when it only describes a topic (the person then has to decline or forget by hand).
    Agent requests can never ask to forget everything."""
    ids = p.get("ids") if p.get("ids") is not None else p.get("refs")
    if isinstance(ids, str):
        ids = re.split(r"[\s,]+", ids)
    if isinstance(ids, list):
        ids = _clean_ids(ids)
        if ids:
            return {"ids": ids}
    for key in ("kind_prefix", "category", "kind", "what"):
        v = p.get(key)
        if not isinstance(v, str) or not v.strip():
            continue
        v = v.strip().lower()
        refs = re.findall(r"#\d{1,18}", v)
        if refs and not re.sub(r"[#\d\s,]", "", v):
            return {"ids": refs}
        if re.fullmatch(KIND_PREFIX, v):
            return {"kind_prefix": v if "." in v else v + "."}
    did = p.get("device_id")
    if isinstance(did, str) and did.strip():
        return {"device_id": did.strip()[:100]}
    return {}


def _describe_selector(person_id: str, sel: dict) -> str:
    c = db.conn()
    if sel.get("ids"):
        return f"{len(sel['ids'])} specific event(s)"
    if sel.get("kind_prefix"):
        pat = sel["kind_prefix"].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        n = c.execute("SELECT count(*) FROM events WHERE person_id=? AND kind LIKE ? ESCAPE '\\'",
                      (person_id, pat)).fetchone()[0]
        return f"everything under '{sel['kind_prefix']}' ({n} events now)"
    if sel.get("device_id"):
        row = _device_row(person_id, sel["device_id"])
        n = c.execute("SELECT count(*) FROM events WHERE person_id=? AND device_id=?",
                      (person_id, sel["device_id"])).fetchone()[0]
        return f"everything from {row['name'] if row else sel['device_id']} ({n} events now)"
    return "a topic Tempo can't match exactly"


def _answered(person_id: str) -> set[str]:
    return {str(e["payload"].get("request")) for e in
            db.timeline(person_id, kinds=["forget.approved", "forget.declined"], limit=1000)}


def _pending_request(person_id: str, hub_seq: int) -> dict:
    evs = db.events_after(person_id, max(0, min(hub_seq, 2 ** 62) - 1), 1)
    if not evs or evs[0]["hub_seq"] != hub_seq or evs[0]["kind"] != "forget.requested":
        raise HTTPException(404, "No such forget request")
    if f"#{hub_seq}" in _answered(person_id):
        raise HTTPException(409, "This request was already answered")
    return evs[0]


@app.get("/api/forget/requests")
def forget_requests(dev: dict = Depends(current_device)):
    """Agents' requests to forget something that the person hasn't approved or declined yet."""
    pid = dev["person_id"]
    answered = _answered(pid)
    out = []
    for e in db.timeline(pid, kinds=["forget.requested"], limit=200):
        if f"#{e['hub_seq']}" in answered:
            continue
        p = e["payload"]
        sel = _request_selector(p)
        asker = _device_row(pid, e["device_id"])
        out.append({"ref": f"#{e['hub_seq']}", "hub_seq": e["hub_seq"], "time": e["event_time_utc"],
                    "from": asker["name"] if asker else (e.get("source") or e["device_id"]),
                    "what": p.get("what") or p.get("topic"),
                    "reason": p.get("reason"), "selector": sel, "can_apply": bool(sel),
                    "summary": _describe_selector(pid, sel)})
    return {"requests": out}


@app.post("/api/forget/requests/{hub_seq}/approve")
def approve_forget(hub_seq: int, dev: dict = Depends(admin_device)):
    """The person approves an agent's request: forget exactly what it names (tombstones included),
    then record forget.approved."""
    req = _pending_request(dev["person_id"], hub_seq)
    sel = _request_selector(req["payload"])
    if not sel:
        raise HTTPException(422, "This request doesn't say exactly what to forget (event refs or a kind like "
                                 "'location.'). Decline it, or forget the facts by hand.")
    res = _forget(dev, **sel, reason="approved request", extra={"request": f"#{hub_seq}"})
    _hub_event(dev, "forget.approved", {"request": f"#{hub_seq}", "count": res["deleted_events"], "by": dev["name"],
                                        **{k: v for k, v in sel.items() if k != "ids"},
                                        **({"ids": len(sel["ids"])} if sel.get("ids") else {})})
    return {"approved": f"#{hub_seq}", **res}


@app.post("/api/forget/requests/{hub_seq}/decline")
@app.post("/api/forget/requests/{hub_seq}/deny")
def decline_forget(hub_seq: int, dev: dict = Depends(admin_device)):
    _pending_request(dev["person_id"], hub_seq)
    _hub_event(dev, "forget.declined", {"request": f"#{hub_seq}", "by": dev["name"]})
    return {"declined": f"#{hub_seq}"}


# ---------- approvals: agents ask, only the person decides ----------

APPROVAL_ASKS = ("approval.requested", "mission.suggested")


def _money(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else None


@app.get("/api/approvals")
def approvals(dev: dict = Depends(current_device)):
    """Steps agents want to take for the person (approval.requested, the Conductor's mission.suggested) that
    nobody has approved, declined or withdrawn yet. Newest first."""
    pid = dev["person_id"]
    done = memory.approval_decisions(pid)
    out = []
    for e in db.timeline(pid, kinds=list(APPROVAL_ASKS), limit=200):
        if f"#{e['hub_seq']}" in done or e.get("trust_level") not in ("agent", "hub"):
            continue
        p = e["payload"] if isinstance(e["payload"], dict) else {}
        asker = _device_row(pid, e["device_id"])
        out.append({"ref": f"#{e['hub_seq']}", "hub_seq": e["hub_seq"], "kind": e["kind"], "time": e["event_time_utc"],
                    "from": asker["name"] if asker else (e.get("source") or e["device_id"]),
                    "summary": memory._clean(p.get("summary") or p.get("suggestion") or e.get("text"), 300),
                    "amount_gbp": _money(p.get("amount_gbp")), "simulated": memory.is_simulated(e),
                    "mission_id": str(p.get("mission_id") or p.get("mission") or "")[:100] or None})
    return {"approvals": out}


_decide_lock = threading.Lock()


def _decide(dev: dict, hub_seq: int, approve: bool) -> dict:
    with _decide_lock:  # two taps at once: the first decides, the second gets 409
        return _decide_locked(dev, hub_seq, approve)


def _decide_locked(dev: dict, hub_seq: int, approve: bool) -> dict:
    pid = dev["person_id"]
    evs = db.events_after(pid, max(0, min(hub_seq, 2 ** 62) - 1), 1)
    if (not evs or evs[0]["hub_seq"] != hub_seq or evs[0]["kind"] not in APPROVAL_ASKS
            or evs[0].get("trust_level") not in ("agent", "hub")):
        raise HTTPException(404, "No such approval request")
    if f"#{hub_seq}" in memory.approval_decisions(pid):
        raise HTTPException(409, "This request was already answered")
    p = evs[0]["payload"] if isinstance(evs[0]["payload"], dict) else {}
    decision = {"request": f"#{hub_seq}", "request_kind": evs[0]["kind"], "by": dev["name"],
                "mission_id": str(p.get("mission_id") or p.get("mission") or "")[:100] or None,
                "amount_gbp": _money(p.get("amount_gbp"))}
    _hub_event(dev, "approval.granted" if approve else "approval.denied", decision)
    url = os.environ.get("TEMPO_CONDUCTOR_URL")
    if url:  # the agent waiting on this hears straight away (refs and the decision only)
        threading.Thread(target=_post_to_conductor, args=(url, {"hub": "Tempo", "approval": {
            **decision, "status": "approved" if approve else "declined"}}), daemon=True).start()
    return {("approved" if approve else "declined"): f"#{hub_seq}"}


# Any of the person's own devices may decide (the phone in their hand is the point), but never an
# ask-only one: voice agents and anything arriving through a tunnel can't approve their own requests.
@app.post("/api/approvals/{hub_seq}/approve")
def approve_step(hub_seq: int, dev: dict = Depends(current_device)):
    return _decide(dev, hub_seq, True)


@app.post("/api/approvals/{hub_seq}/decline")
@app.post("/api/approvals/{hub_seq}/deny")
def decline_step(hub_seq: int, dev: dict = Depends(current_device)):
    return _decide(dev, hub_seq, False)


# ---------- hands: an audit log of what Tempo's agents did on the person's phone and laptop ----------

class HandsLogIn(BaseModel):
    """One task Tempo's hands carried out (or refused). Steps are short action labels ('Opened Weather'),
    never screen contents. Sending the same task_id again updates the entry (started -> done)."""
    model_config = ConfigDict(extra="forbid")
    task_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.:-]+$")
    device: Literal["phone", "laptop"]
    task: str = Field(min_length=1, max_length=300)
    user_confirmed: bool = False
    status: Literal["started", "done", "refused", "failed", "cancelled", "needs_confirmation"]
    steps: list[Annotated[str, Field(max_length=80)]] = Field(default_factory=list, max_length=40)
    answer: str | None = Field(default=None, max_length=500)
    requested_via: Literal["voice", "phone", "laptop", "web", "other"] | None = None
    started: str | None = Field(default=None, max_length=40)
    finished: str | None = Field(default=None, max_length=40)


@app.post("/api/hands/log")
def hands_log(body: HandsLogIn, request: Request, dev: dict = Depends(current_device)):
    """Record one hands task as private (vault) history: the person's own devices and local model see it; the
    voice agent, anything through the tunnel, remote models and MCP agents never do. Only a device made with
    scripts/device_admin.py add-hands may write here, only from this computer, and it can read nothing."""
    if "hands" not in _caps(dev):
        raise HTTPException(403, "Only a Tempo hands device can write the hands log.")
    ip = _client_ip(request)
    if ip is None or not ip.is_loopback or via_tunnel(request):
        raise HTTPException(403, "The hands log is written only by agents on the hub computer itself.")
    scrub = lambda t: adapters._PHONE.sub("[number]", t) if isinstance(t, str) else t  # noqa: E731
    payload = {**body.model_dump(), "task": scrub(body.task), "answer": scrub(body.answer),
               "steps": [scrub(x) for x in body.steps], "logged_by": dev["name"]}
    ev = {"kind": "hands.task", "id": f"hands:{body.task_id}", "upsert": True, "payload": payload}
    if body.started:
        ev["event_time"] = body.started
    eid = f"{dev['id']}:hands:{body.task_id}"
    find = "SELECT hub_seq FROM events WHERE id=? AND person_id=?"
    existed = db.conn().execute(find, (eid, dev["person_id"])).fetchone() is not None
    db.insert_events(dev["person_id"], dev["id"], [ev], source="hands", trust_level="agent")
    row = db.conn().execute(find, (eid, dev["person_id"])).fetchone()
    return {"stored": bool(row), "ref": f"#{row['hub_seq']}" if row else None, "updated": existed and bool(row)}


# ---------- money: the Navigator's ledger (tempo-hub/navigator) ----------

class MoneyEventIn(BaseModel):
    """One step of one payment handled by the Navigator (money.requested, .checked, .verified, .awaiting_approval,
    .approved, .sent, .refused, .mismatch, .stopped, .expired, ...)."""
    model_config = ConfigDict(extra="forbid")
    kind: str = Field(max_length=50, pattern=r"^money\.[a-z_]{2,40}$")
    payment_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.:-]+$")
    event_time: str | None = Field(default=None, max_length=40)
    payload: dict = Field(default_factory=dict)


class MoneyEventsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    events: list[MoneyEventIn] = Field(min_length=1, max_length=50)


def _money_scrub(v: Any, depth: int = 0) -> Any:
    """Short strings, no approval tokens, bounded depth: the ledger holds facts about a payment, not secrets."""
    if depth > 4:
        return None
    if isinstance(v, dict):
        return {str(k)[:40]: _money_scrub(x, depth + 1) for k, x in list(v.items())[:40] if str(k) not in ("token",)}
    if isinstance(v, list):
        return [_money_scrub(x, depth + 1) for x in v[:40]]
    if isinstance(v, str):
        return adapters._PHONE.sub("[number]", v)[:500]
    return v


@app.post("/api/money/events")
def money_events(body: MoneyEventsIn, request: Request, dev: dict = Depends(current_device)):
    """Append the Navigator's time-stamped steps for a payment. Private (vault) like the hands log: written only by
    the hands device on this computer; the voice agent, the tunnel, remote models and MCP agents never read it."""
    if "hands" not in _caps(dev):
        raise HTTPException(403, "Only a Tempo hands device can write the money ledger.")
    ip = _client_ip(request)
    if ip is None or not ip.is_loopback or via_tunnel(request):
        raise HTTPException(403, "The money ledger is written only by the Navigator on the hub computer itself.")
    evs = []
    for e in body.events:
        payload = _money_scrub(e.payload)
        payload.update({"payment_id": e.payment_id, "logged_by": dev["name"]})
        ev = {"kind": e.kind, "id": f"money:{e.payment_id}:{e.kind}:{hashlib.sha256((e.event_time or '').encode()).hexdigest()[:8]}",
              "payload": payload}
        if e.event_time:
            ev["event_time"] = e.event_time
        evs.append(ev)
    db.insert_events(dev["person_id"], dev["id"], evs, source="navigator", trust_level="agent")
    return {"stored": len(evs)}


@app.get("/api/money/ledger")
def money_ledger(dev: dict = Depends(current_device), limit: int = 300):
    """Every payment the Navigator handled, newest first, each with its time-stamped steps. For the person's own
    devices (the hub page). Ask-only devices and anything through the tunnel never see money."""
    if dev["ask_only"]:
        raise HTTPException(403, "Money history is private to the person's own devices.")
    rows = db.timeline(dev["person_id"], kinds=["money.*"], limit=max(1, min(int(limit), 2000)))
    payments: dict[str, dict] = {}
    for e in reversed(rows):  # oldest first, so the last kind is the current status
        p = e["payload"] if isinstance(e["payload"], dict) else {}
        pid = str(p.get("payment_id") or "")
        rec = payments.setdefault(pid, {"payment_id": pid, "steps": [], "status": None, "task": None, "amount": None,
                                        "payee_id": None, "cop_name": None, "readback": None, "started": e["event_time_utc"]})
        rec["steps"].append({"kind": e["kind"], "time": e["event_time_utc"], "local": e.get("local"), "ref": f"#{e['hub_seq']}"})
        rec["status"] = e["kind"].split(".", 1)[1]
        rec["finished"] = e["event_time_utc"]
        if e["kind"] == "money.requested":
            rec["task"] = memory._clean(p.get("text"), 300)
        elif e["kind"] == "money.checked":
            rec["amount"], rec["readback"] = p.get("amount"), memory._clean(p.get("readback"), 200)
        elif e["kind"] in ("money.verified", "money.mismatch"):
            rec["cop_name"] = memory._clean(p.get("name_on_screen"), 80)
        elif e["kind"] == "money.sent":
            rec["payee_id"], rec["amount"] = p.get("payee_id"), p.get("amount")
    out = sorted(payments.values(), key=lambda r: r["started"], reverse=True)
    return {"payments": out, "count": len(out)}


# ---------- the model ----------

class AskIn(BaseModel):
    question: str
    # Optional: the language to answer in, e.g. "en", "cy", "Welsh" (a voice agent knows what it heard).
    language: str | None = Field(default=None, max_length=40, pattern=r"^[A-Za-z][A-Za-z _\-()]*$")


ASK_PER_MINUTE = int(os.environ.get("TEMPO_ASK_PER_MINUTE", "20"))  # per device
ASK_CONCURRENCY = int(os.environ.get("TEMPO_ASK_CONCURRENCY", "2" if model.ON_OLLAMA else "8"))  # one local model only queues
ASK_WAIT_S = 5.0  # how long a question waits for a free slot before "busy" (comes out of the model's budget)
_ask_slots = threading.BoundedSemaphore(max(1, ASK_CONCURRENCY))
_ask_times: dict[str, list[float]] = {}
_ask_lock = threading.Lock()


def _ask_allowed(device_id: str) -> float:
    """0 if this device may ask now, else the seconds until it may (a sliding one-minute window)."""
    if ASK_PER_MINUTE <= 0:
        return 0.0  # TEMPO_ASK_PER_MINUTE=0: no per-device limit
    now = time.monotonic()
    with _ask_lock:
        recent = [t for t in _ask_times.get(device_id, []) if now - t < 60]
        if len(recent) >= ASK_PER_MINUTE:
            _ask_times[device_id] = recent
            return 60 - (now - recent[0])
        _ask_times[device_id] = recent + [now]
        return 0.0


def killed(switch: str) -> bool:
    """KAIROS_KILL_VOICE / KAIROS_KILL_SEND: stop voice answers / message hand-offs at once, whatever spend caps
    at the providers say (theirs take minutes to apply). Set in the hub's env, or flipped live by adding
    KAIROS_KILL_VOICE=1 to voice/.env (re-read on change, no restart)."""
    from . import providers
    return "1" in ((os.environ.get(switch) or "").strip(), (providers._env_file_values().get(switch) or "").strip())


@app.post("/api/ask")
def ask(body: AskIn, request: Request, dev: dict = Depends(current_device),
        x_kairos_session: str = Header(default="")):
    # Ask-only callers (voice agents, anything through the tunnel) get answers without private data, unless
    # the person gave that device the 'vault' capability (scripts/device_admin.py vault <id> on).
    if dev["ask_only"] and killed("KAIROS_KILL_VOICE"):
        raise HTTPException(503, "Voice answers are paused (KAIROS_KILL_VOICE).")
    session_value = x_kairos_session.strip()
    if session_value.lower() == "none" or (session_value.startswith("{{") and session_value.endswith("}}")):
        session_value = ""  # the agent's placeholder ('none') or an unfilled {{secret__kairos_session}}: no session
    sess = None
    if session_value:  # a Kairos call: whose call it is comes from the session, never from model text
        sess = db.kairos_session(session_value)
        started_by = sess and db.conn().execute("SELECT removed FROM devices WHERE id=?", (sess["device_id"],)).fetchone()
        if not sess or sess["person_id"] != dev["person_id"] or not started_by or started_by["removed"]:
            raise HTTPException(401, "This call's Kairos session has expired; start a new call.")
    # In server mode, private answers ('vault') through the internet need a live call the app started: never the
    # agent token alone, and never any other token arriving through the tunnel (the app itself doesn't use /api/ask).
    remote = server_mode() and via_tunnel(request)
    allow = (not dev["ask_only"] and not remote) or ("vault" in _caps(dev) and (sess is not None or not server_mode()))
    wait = _ask_allowed(dev["id"])
    if wait:
        raise HTTPException(429, "Too many questions from this device; try again in a minute.",
                            headers={"Retry-After": str(int(wait) + 1)})
    t0 = time.monotonic()
    if not _ask_slots.acquire(timeout=ASK_WAIT_S):
        raise HTTPException(429, "Tempo is busy answering other questions; try again in a few seconds.",
                            headers={"Retry-After": "5"})
    waited = time.monotonic() - t0
    try:  # the wait counts against the answer budget (and the voice budget), so a queued voice question still
        # beats the webhook timeout
        r = model.ask(dev["person_id"], body.question[:2000], allow_vault=allow, language=body.language,
                      spoken=dev["ask_only"], budget=model.BUDGET - waited)
    finally:
        _ask_slots.release()
    if dev["ask_only"] and isinstance(r, dict) and isinstance(r.get("answer"), str):
        # Voice agents read the answer aloud: event refs ('#114') go in their own field.
        r["answer"], r["refs"] = model.speakable(r["answer"])
    if isinstance(r, dict):
        r.setdefault("timings", {})["wait_ms"] = int(waited * 1000)
    return r


# ---------- Kairos voice sessions (M3) ----------

def server_env(name: str) -> str | None:
    """A server secret: the process env first, else KAIROS_ENV_FILE (default voice/.env, mode 600), parsed the same
    way the providers parse it ('export', quotes, inline comments). Never logged."""
    from . import providers
    return providers.env(name) or None


EL_CONVAI = "https://api.elevenlabs.io/v1/convai/conversation"
VOICE_SESSIONS_PER_DAY = int(os.environ.get("KAIROS_VOICE_SESSIONS_PER_DAY", "4"))  # 4 × 15 min = 60 voice minutes


def _mint_conversation_token() -> str:
    """A one-call WebRTC token for the Kairos agent, minted with the server's own ElevenLabs key."""
    key, agent = server_env("ELEVENLABS_API_KEY"), server_env("ELEVENLABS_AGENT_ID")
    if not key or not agent:
        raise HTTPException(503, "Voice isn't set up on the server (ElevenLabs key or agent id missing).")
    try:
        r = httpx.get(f"{EL_CONVAI}/token", params={"agent_id": agent}, headers={"xi-api-key": key}, timeout=3)
        r.raise_for_status()
        data = r.json()
        token = data.get("token") if isinstance(data, dict) else None
        if not isinstance(token, str) or not token:
            raise ValueError("no token in the reply")
        return token
    except (httpx.HTTPError, KeyError, ValueError, TypeError) as exc:
        raise HTTPException(502, f"Couldn't start a voice call ({type(exc).__name__}); try Write for me.") from None


@app.post("/api/voice/session")
def voice_session(dev: dict = Depends(current_device)):
    """The Kairos app's device token -> an ElevenLabs call token plus a 15-minute kairos_session. The app passes
    the session to the agent as secret__kairos_session; ElevenLabs puts it only in tool headers (X-Kairos-Session),
    so /api/ask knows whose call it is without trusting anything a model says."""
    if dev["ask_only"] or "hands" in _caps(dev) or "guardian" in _caps(dev):
        raise HTTPException(403, "Start calls from the Kairos app's own device token.")
    if killed("KAIROS_KILL_VOICE"):
        raise HTTPException(503, "Voice is paused (KAIROS_KILL_VOICE). Write for me still works.")
    day = db.usage_take(dev["person_id"], "voice_sessions", VOICE_SESSIONS_PER_DAY)  # counted before the mint
    if not day:
        raise HTTPException(429, "Today's voice minutes are used up; Write for me still works.")
    t0 = time.monotonic()
    try:
        token = _mint_conversation_token()
        session, expires = db.new_kairos_session(dev["person_id"], dev["id"])
    except BaseException:
        db.usage_add(dev["person_id"], "voice_sessions", -1, day)  # no call started: give it back, to the same day
        raise
    return {"conversation_token": token, "kairos_session": session, "expires_at": expires,
            "session_header": "X-Kairos-Session", "timings": {"mint_ms": int((time.monotonic() - t0) * 1000)}}


@app.get("/api/health")
def health():
    """Liveness for the app and monitors: no data, no counters, no versions of anything private."""
    from . import providers
    usable = model._providers()  # 'none': API keys only and no key set yet, so answers are the hub's own summaries
    kind = "api" if any(providers.llm_family(p[0]) != "ollama" for p in usable) else ("local" if usable else "none")
    return {"ok": True, "voice": not killed("KAIROS_KILL_VOICE"), "send": not killed("KAIROS_KILL_SEND"), "model": kind}


# ---------- apps that push to us ----------

HOWTO = {
    "health-connect": "Android: install HC Webhook (free 'foss' APK from github.com/mcnaveen/health-connect-webhook/releases), add this URL as a webhook, allow all types + 'Access data in the background', interval 15–60 min. Covers Samsung/Galaxy Watch, Google Health/Pixel/Fitbit, Garmin, Oura, Gadgetbridge (CMF etc.).",
    "health-auto-export": "iPhone: Health Auto Export → Automations → REST API → paste this URL, JSON, schedule hourly. Covers Apple Watch and anything that writes to Apple Health.",
    "shortcut": "iPhone (free): a Shortcut that finds Health samples and does 'Get Contents of URL' POST JSON to this URL; personal automation 'When WhatsApp is opened' → Run Immediately.",
    "owntracks": "iPhone/Android: OwnTracks → Mode HTTP → paste this URL. Sends location automatically.",
    "tasker": "Android: Tasker/AutoNotification → HTTP Request POST JSON {app, title, text} to this URL.",
    "generic": "Anything else that can POST JSON.",
    "whatsapp": "This computer only: wacli sync --follow --webhook-allow-private --webhook <this URL> --webhook-secret \"$(cat data/wacli.secret)\" (make the secret with scripts/wacli_secret.py; wacli refuses a localhost webhook without --webhook-allow-private). Messages stay private (vault). After rotating the ingest key, restart wacli with the new URL.",
}


def _mask(key: str) -> str:
    return f"{key[:4]}••••••"


def _integration_list(key: str, masked: bool) -> list[dict]:
    shown = _mask(key) if masked else key
    local = f"http://127.0.0.1:{os.environ.get('TEMPO_PORT', '8787')}"
    return [{"source": s, "name": name, "how": HOWTO.get(s, ""),
             # WhatsApp is accepted only from wacli on the hub computer itself: never a LAN or tunnel URL
             "url": f"{local if s == 'whatsapp' else base_url()}/api/ingest/{s}?key={shown}",
             "url_by_name": f"{local if s == 'whatsapp' else name_url()}/api/ingest/{s}?key={shown}"}
            for s, (name, _) in adapters.ADAPTERS.items()]


@app.get("/api/integrations")
def integrations(dev: dict = Depends(current_device)):
    """App URLs with the key masked (safe on a projector). POST /api/integrations/reveal for the real ones."""
    person = _person(dev["person_id"])
    return {"integrations": _integration_list(person["ingest_key"], masked=True), "masked": True,
            "reveal": "/api/integrations/reveal"}


@app.post("/api/integrations/reveal")
def reveal_integrations(dev: dict = Depends(admin_device)):
    """The full app URLs, for a joined device to copy into an app. Every reveal is announced."""
    person = _person(dev["person_id"])
    _hub_event(dev, "hub.ingest_key_shown", {"by": dev["name"]})
    return {"integrations": _integration_list(person["ingest_key"], masked=False), "masked": False}


@app.post("/api/ingest/{source}")
async def ingest(source: str, request: Request, key: str = "", simulated: bool = False,
                 x_tempo_key: str = Header(default=""), authorization: str = Header(default="")):
    if source not in adapters.ADAPTERS:
        raise HTTPException(404, f"Unknown source. Known: {', '.join(adapters.ADAPTERS)}")
    if source == "whatsapp":  # other people's messages: only from wacli on this computer, never via the tunnel/LAN
        ip = _client_ip(request)
        if ip is None or not ip.is_loopback or via_tunnel(request):
            raise HTTPException(403, "WhatsApp messages are only accepted from wacli on the hub computer itself.")
    k = key or x_tempo_key or authorization.removeprefix("Bearer ").strip()
    if not k:
        raise HTTPException(401, "Bad or missing ingest key")
    try:
        declared = int(request.headers.get("content-length") or 0)
    except ValueError:
        declared = 0
    if declared > MAX_INGEST_BYTES:
        raise HTTPException(413, f"Body too big (max {MAX_INGEST_BYTES // 1024 // 1024} MB); send it in parts.")
    if not await run_in_threadpool(db.person_by_ingest_key, k):  # before reading a byte of the body
        raise HTTPException(401, "Bad or missing ingest key")
    chunks, size = [], 0
    async for chunk in request.stream():  # a chunked upload can't make the hub buffer more than the cap
        size += len(chunk)
        if size > MAX_INGEST_BYTES:
            raise HTTPException(413, f"Body too big (max {MAX_INGEST_BYTES // 1024 // 1024} MB); send it in parts.")
        chunks.append(chunk)
    raw = b"".join(chunks)
    if source == "whatsapp":
        secret = wacli_secret()
        if not secret:
            raise HTTPException(403, "Make the wacli webhook secret first: .venv/bin/python scripts/wacli_secret.py")
        want = "sha256=" + hmac.new(secret, raw, hashlib.sha256).hexdigest()
        got = request.headers.get("x-wacli-signature", "").strip().lower().encode("utf-8", "replace")
        if not hmac.compare_digest(got, want.encode()):
            raise HTTPException(401, "Bad or missing X-Wacli-Signature")
    # Parsing and SQLite work run in the threadpool, so a big first sync never blocks other requests.
    return await run_in_threadpool(_ingest, source, k, raw, simulated)


def wacli_secret() -> bytes | None:
    """The wacli webhook secret: TEMPO_WACLI_SECRET, else data/wacli.secret (scripts/wacli_secret.py makes it)."""
    s = os.environ.get("TEMPO_WACLI_SECRET", "").strip()
    if not s:
        try:
            s = (db.DB_PATH.parent / "wacli.secret").read_text().strip()
        except OSError:
            s = ""
    return s.encode() if s else None


def _ingest(source: str, k: str, raw: bytes, simulated: bool):
    person = db.person_by_ingest_key(k)
    if not person:
        raise HTTPException(401, "Bad or missing ingest key")
    try:
        body = json.loads(raw or b"{}")
    except (ValueError, RecursionError):
        raise HTTPException(400, "Body must be JSON")
    name, fn = adapters.ADAPTERS[source]
    if source == "whatsapp":
        fn = lambda b: adapters.wacli(b, key=wacli_secret() or b"")  # noqa: E731 (pseudonyms keyed with the secret)
    dev = db.integration_device(person["id"], source, name)
    if dev is None:
        raise HTTPException(410, detail={"blocked": True, "message":
            f"{name} was removed from Tempo, so nothing it sends is stored. To connect it again, open Tempo "
            "on a joined device: Your devices > Blocked apps > Unblock."})
    dev = dict(dev)
    try:
        evs = fn(body)
    except Exception:  # adapters skip what they can't read; this is a last resort, never a 500
        raise HTTPException(400, "Couldn't read this body")
    deletes = [e["id"] for e in evs if e.get("kind") == "_delete"]
    evs = [e for e in evs if e.get("kind") != "_delete"]
    _reject_reserved(e.get("kind") for e in evs)
    if source != "whatsapp":
        _reject_whatsapp(e.get("kind") for e in evs)
    if source == "whatsapp":
        for e in evs:
            if (e.get("payload") or {}).get("edited"):
                old = db.conn().execute("SELECT payload FROM events WHERE id=? AND person_id=?",
                                        (f"{dev['id']}:{e['id']}", person["id"])).fetchone()
                prev = json.loads(old["payload"]) if old and old["payload"] else {"chat": "a chat", "sender": None}
                e["payload"] = {**prev, **{k: v for k, v in e["payload"].items() if k in ("text", "caption", "edited", "media")}}
    seq0 = db.latest_hub_seq()
    try:
        if deletes:
            _forget(dev, ids=deletes, device_id=dev["id"], reason="deleted by the app", receipt_if_none=False)
        stored = db.insert_events(person["id"], dev["id"], evs, source=source, trust_level="integration",
                                  simulated=simulated)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    acc, dup = stored
    if source == "whatsapp" and any((e.get("payload") or {}).get("edited") for e in evs):
        db._checkpoint(db.conn())  # the pre-edit text must not linger in the WAL
    suggested = conductor(person["id"], seq0) if acc else []
    if source == "owntracks":
        return JSONResponse([])  # OwnTracks expects a JSON array back
    out = {"accepted": acc, "duplicates": dup, "parsed": len(evs), "hub_seq": db.latest_hub_seq()}
    if stored.forgotten:
        out["forgotten"] = stored.forgotten
    if suggested:
        out["suggested"] = len(suggested)
    return out


# ---------- the Communications Bridge ("Write for me", hub/bridge.py) ----------
from . import bridge  # noqa: E402

bridge.mount(app, current_device, killed)


# ---------- the Guardian (tempo-hub/guardian): protection status, the vault, lockdown ----------
try:
    from guardian import api as _guardian_api
    _guardian_api.mount(app, current_device, admin_device, _client_ip, via_tunnel, db, memory)
except Exception as _e:  # noqa: BLE001 - the hub must run even if the Guardian package is broken or missing
    print(f"guardian API not mounted: {type(_e).__name__}: {_e}", flush=True)
