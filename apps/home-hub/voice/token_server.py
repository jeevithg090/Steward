#!/usr/bin/env python3
"""Tap-to-talk page + token minting for the ElevenLabs "Tempo" agent. Port 8788, loopback only.

The phone opens  https://<tunnel>/voice/#k=<phone key>  in a normal Safari tab. The page asks this server for
a short-lived conversation token (WebRTC) or a signed URL (WebSocket fallback). The ElevenLabs API key stays
in .env on this Mac: it is never sent to the page and never logged.

    GET  /voice/            the page (phone_page/index.html) and its files
    GET  /voice/health      {"ok": true, "agent": true}  (no secrets)
    POST /voice/token       header X-Tempo-Phone-Key; body {"mode": "webrtc" | "websocket"}
                            -> {"token": ...} or {"signed_url": ...}
    POST /voice/phone-task  header X-Tempo-Tool-Secret (ElevenLabs' phone_task tool) or X-Tempo-Phone-Key;
                            body {"task": "...", "device": "auto"|"phone"|"laptop"|"both"|"team"|"hub", "user_confirmed": false,
                                  "wait": seconds (default 20, max 55)}
                            -> phone: tempo-hub/phone/phone_agent.py (local model + iCTRL on the iPhone);
                               laptop: tempo-hub/hands/laptop_agent.py (local model + safe Mac actions);
                               both: the two in parallel; team: hands/conductor.py splits the request into
                               up to 5 agents across hub, laptop and phone; hub: just ask the Tempo hub.
                               Waits up to `wait` s (default 20), then
                            {"status": "done"|"running"|"busy"|"locked"|..., "answer": ...}
    GET  /voice/phone-task/latest   header X-Tempo-Phone-Key -> the latest task's status, steps and answer
                            (the page polls it and tells the voice agent via sendContextualUpdate)
    ANY  /voice/agents/...  header X-Tempo-Phone-Key; forwarded to the agents service (agents/server.py,
                            127.0.0.1:8789) as /agents/...: the letter reader and the other in-app agents.
                            POST bodies up to 9 MB (a photo of a letter, base64 JSON). No tool secret here:
                            only the person's own phone may send photos of their letters.
    POST /voice/phone-task  with body {"agent_path": "/agents/...", "payload": {...}} (phone key only) is the same
                            thing in an envelope: the tunnel's older rule forwards only this POST path, so the app
                            and the page fall back to it when a direct POST /voice/agents/... gets a bare 404.

The phone key (TEMPO_PHONE_KEY in .env) is what stops strangers who find the tunnel URL from talking to
the agent, which can read your hub. It travels in the link's #fragment, so it never reaches ngrok's or
anyone's request logs. Make one with:  python3 token_server.py --new-phone-key   (copies the phone link;
--link copies it again). The phone_task tool secret: python3 token_server.py --new-tool-secret

Run: python3 token_server.py      (stdlib only; macOS's /usr/bin/python3 3.9 is fine)
"""
import hmac
import json
import os
import re
import secrets
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
try:  # tempo-hub/navigator: the Mobile Money / Banking Navigator (send money, pay bills, check the balance)
    from navigator import intent as nav_intent
    from navigator.brain import Brain
    from navigator.hands import ICTRLHands
    from navigator.ledger import Ledger
    from navigator.navigator import Navigator
    from navigator.payees import Book
    NAVIGATOR_OK = True
except Exception as _e:  # the rest of the voice server works without it
    NAVIGATOR_OK = False
    print(f"[voice] navigator unavailable: {type(_e).__name__}: {_e}", file=sys.stderr)
try:  # tempo-hub/guardian/lockdown.py: the Guardian's kill switch (stdlib only). Honoured here for every task.
    from guardian import lockdown as guardian_lockdown
except Exception:  # noqa: BLE001
    guardian_lockdown = None
GUARDIAN_STATUS = HERE.parent / "data" / "guardian_status.json"
PAGE_DIR = HERE / "phone_page"
ENV_FILE = HERE / ".env"
PORT = int(os.environ.get("TEMPO_VOICE_PORT", "8788"))
EL_API = "https://api.elevenlabs.io/v1/convai/conversation"
PUBLIC_URL = os.environ.get("TEMPO_VOICE_PUBLIC_URL", "https://unreleasing-laree-nebulously.ngrok-free.dev")

# Token minting limits: each token opens one call (max 300 s), so these cap cost if a phone key ever leaks.
PER_IP_PER_MIN = 6
ALL_PER_HOUR = 60
BAD_KEY_LOCKOUT = (10, 600)  # 10 wrong keys from one IP -> that IP is refused for 10 minutes

TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
         ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
         ".json": "application/json", ".map": "application/json"}


def read_env() -> dict:
    env = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            k, sep, v = line.partition("=")
            if sep and k.strip() and not k.lstrip().startswith("#"):
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def set_env(name: str, value: str) -> None:
    """Add or replace one line in .env, keeping every other line as it is (chmod 600)."""
    lines = ENV_FILE.read_text().splitlines() if ENV_FILE.exists() else []
    out, done = [], False
    for line in lines:
        if line.split("=", 1)[0].strip() == name:
            out.append(f"{name}={value}")
            done = True
        else:
            out.append(line)
    if not done:
        out += ["", "# Phone key: in the phone link's #fragment, checked by token_server.py. SECRET.", f"{name}={value}"]
    tmp = ENV_FILE.with_suffix(".tmp")
    tmp.write_text("\n".join(out) + "\n")
    tmp.chmod(0o600)
    tmp.replace(ENV_FILE)


def log(msg: str) -> None:
    # Never log keys, tokens, query strings or bodies.
    print(f"{time.strftime('%H:%M:%S')} {msg}", flush=True)


class Limits:
    def __init__(self):
        self.lock = threading.Lock()
        self.per_ip, self.all, self.bad = {}, [], {}

    def blocked(self, ip: str) -> bool:
        with self.lock:
            n, since = self.bad.get(ip, (0, 0.0))
            return n >= BAD_KEY_LOCKOUT[0] and time.time() - since < BAD_KEY_LOCKOUT[1]

    def bad_key(self, ip: str) -> None:
        with self.lock:
            n, since = self.bad.get(ip, (0, time.time()))
            if time.time() - since >= BAD_KEY_LOCKOUT[1]:
                n, since = 0, time.time()
            self.bad[ip] = (n + 1, since)

    def take(self, ip: str) -> bool:
        now = time.time()
        with self.lock:
            mine = [t for t in self.per_ip.get(ip, []) if now - t < 60]
            self.all = [t for t in self.all if now - t < 3600]
            if len(mine) >= PER_IP_PER_MIN or len(self.all) >= ALL_PER_HOUR:
                self.per_ip[ip] = mine
                return False
            self.per_ip[ip] = mine + [now]
            self.all.append(now)
            return True


LIMITS = Limits()


def voice_killed(env: dict) -> bool:
    """KAIROS_KILL_VOICE=1 (in voice/.env, re-read live, or the environment) pauses voice; the hub reads the same flag."""
    return "1" in (env.get("KAIROS_KILL_VOICE", "").strip(), os.environ.get("KAIROS_KILL_VOICE", "").strip())


class DailyCap:
    """Counts calls per London day, shared with the hub's KAIROS_VOICE_SESSIONS_PER_DAY (default 4).
    A WebSocket mint within 30 s of a WebRTC mint from the same address is the page's fallback, not a new call.
    Persisted next to this file so a restart doesn't reset it."""
    FILE = Path(__file__).resolve().parent / ".voice_sessions.json"

    def __init__(self):
        self.lock = threading.Lock()
        self.last_rtc = {}

    @staticmethod
    def today() -> str:
        os.environ.setdefault("TZ", "Europe/London")
        time.tzset()
        return time.strftime("%Y-%m-%d")

    def _load(self) -> dict:
        try:
            data = json.loads(self.FILE.read_text())
            return data if data.get("day") == self.today() else {"day": self.today(), "count": 0}
        except (OSError, ValueError):
            return {"day": self.today(), "count": 0}

    def take(self, env: dict, ip: str, mode: str) -> bool:
        try:
            cap = int(env.get("KAIROS_VOICE_SESSIONS_PER_DAY") or os.environ.get("KAIROS_VOICE_SESSIONS_PER_DAY") or 4)
        except ValueError:
            cap = 4
        now = time.time()
        with self.lock:
            if mode == "websocket" and now - self.last_rtc.get(ip, 0) < 30:
                return True  # fallback for a call already counted
            data = self._load()
            if data["count"] >= cap:
                return False
            data["count"] += 1
            if mode == "webrtc":
                self.last_rtc[ip] = now
            self.FILE.write_text(json.dumps(data))
            return True


DAILY = DailyCap()
TEMPO_APP =os.environ.get("TEMPO_APP_BUNDLE", "uk.oxhack.tempo.6q9wsfp48t")
AGENTS_URL = os.environ.get("TEMPO_AGENTS_URL", "http://127.0.0.1:8789")  # agents/server.py, loopback only
AGENTS_MAX_BODY = 9 * 1024 * 1024  # one photo of a letter as base64 JSON; the app shrinks photos first
AGENTS_PATH = re.compile(r"^/agents(?:/[A-Za-z0-9_.-]{1,64}){0,4}$")
LAST_CLIENT = {"name": "page", "at": 0.0}  # which front end minted the latest call: the Tempo app or the web page


def return_bundle() -> str:
    """Where the phone goes after a helper used it: the Tempo app if the user is talking from it, else Safari."""
    recent = time.time() - LAST_CLIENT["at"] < 900
    return TEMPO_APP if recent and LAST_CLIENT["name"] == "app" else "com.apple.mobilesafari"


_NAV = None
_NAV_LOCK = threading.Lock()


def lan_ip() -> str:
    import socket
    try:
        s_ = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s_.connect(("10.255.255.255", 1))
        ip = s_.getsockname()[0]
        s_.close()
        return ip
    except OSError:
        return "127.0.0.1"


def navigator():
    """One Navigator for the process: the payee book, the iPhone through iCTRL, Gemini (or the local model) for
    judgement calls, and the ledger that writes to the hub."""
    global _NAV
    with _NAV_LOCK:
        if _NAV is None:
            url = os.environ.get("TEMPO_OXBANK_URL") or f"http://{lan_ip()}:{os.environ.get('TEMPO_PORT', '8787')}/oxbank/"
            _NAV = Navigator(Book.load(create_demo=True), ICTRLHands(), brain=Brain(), ledger=Ledger(), oxbank_url=url)
            log(f"navigator ready: brain={_NAV.brain.describe()}, bank page {url}")
        return _NAV


NAV_RUNNING = ("understanding", "checking", "navigating", "verifying", "executing")
LAPTOP_WORDS = ("laptop", "mac", "macbook", "computer", "desktop", "my files", "documents", "downloads")


def pick_device(device: str, task: str) -> str:
    device = (device or "auto").lower()
    if device in ("phone", "laptop", "both", "team", "hub"):
        return device
    t = task.lower()
    on_laptop = any(w in t for w in LAPTOP_WORDS)
    on_phone = any(w in t for w in ("phone", "iphone"))
    return "both" if on_laptop and on_phone else "laptop" if on_laptop else "phone"


class Tasks:
    """Tasks for Tempo's hands: the iPhone (iCTRL) and this Mac. One at a time per device; the two devices can
    work at the same time ("both"). The voice agent starts a task; the page polls the latest one."""
    WAIT_FOR_ANSWER = 20  # seconds the webhook waits before answering "started" (ElevenLabs' tool timeout is 30 s)

    def __init__(self):
        self.lock = threading.Lock()
        self.busy = set()   # devices working right now
        self.latest = None  # {id, device, task, status, steps, answer, started, finished}

    def start(self, task: str, confirmed: bool, device: str = "auto", wait: float = None, channel: str = "cloud") -> dict:
        if NAVIGATOR_OK and self.latest and self.latest.get("money") and self.latest["status"] in ("running", "needs_confirmation") \
                and nav_intent.parse(task).kind == "stop":
            out = navigator().stop(self.latest["nav_id"])
            return {"status": "stopped" if out.get("stopped") else "none", "task_id": self.latest["id"], "device": "phone",
                    "answer": "Stopped. Nothing was sent." if out.get("stopped") else "Nothing was running."}
        if guardian_lockdown is not None:
            if NAVIGATOR_OK and nav_intent.looks_like_money(task) and guardian_lockdown.is_locked("money"):
                log("money task refused: guardian lockdown")
                return {"status": "refused", "device": "phone", "answer": guardian_lockdown.say("money")}
            if device != "hub" and guardian_lockdown.is_locked("hands"):
                log("phone/laptop task refused: guardian lockdown")
                return {"status": "refused", "device": device, "answer": guardian_lockdown.say("hands")}
        if NAVIGATOR_OK and nav_intent.looks_like_money(task):
            return self.start_money(task, wait, channel)
        device = pick_device(device, task)
        need = {"phone", "laptop"} if device in ("both", "team") else set() if device == "hub" else {device}
        with self.lock:
            if self.busy & need:
                return {"status": "busy", "device": device,
                        "message": "That device is still doing the last task. Ask again in a moment."}
            self.busy |= need
            rec = {"id": secrets.token_hex(4), "device": device, "task": task, "status": "running", "steps": [],
                   "answer": None, "started": time.time(), "finished": None}
            self.latest = rec
        threading.Thread(target=self._run, args=(rec, confirmed, need, channel), daemon=True).start()
        deadline = time.time() + min(max(wait or self.WAIT_FOR_ANSWER, 1), 55)
        while time.time() < deadline and rec["status"] == "running":
            time.sleep(0.3)
        if rec["status"] == "running":
            return {"status": "running", "task_id": rec["id"], "device": device,
                    "message": f"Started on your {device if device != 'both' else 'phone and laptop'}. "
                               "It's still working; the result will follow shortly."}
        return {"status": rec["status"], "task_id": rec["id"], "device": device, "answer": rec["answer"]}

    def start_money(self, task: str, wait: float = None, channel: str = "cloud") -> dict:
        """Banking and mobile money go to the Navigator: it understands, checks the payee book and limits, drives the
        bank app on the iPhone, verifies the name on the review screen, then waits for the owner's Yes (Face ID) on
        the Kairos card. The voice agent only ever gets the short answer; the ledger stays on this Mac and in the hub."""
        with self.lock:
            if "phone" in self.busy:
                return {"status": "busy", "device": "phone", "message": "Your phone is still doing the last task. Ask again in a moment."}
            self.busy.add("phone")
            nav = navigator()
            rec = {"id": secrets.token_hex(4), "device": "phone", "task": task, "status": "running", "steps": [], "answer": None,
                   "started": time.time(), "finished": None, "money": True, "nav_id": None, "payment": None,
                   "nav_before": nav.latest_id}
            self.latest = rec

        def work():
            try:
                out = nav.run(task, on_step=lambda st: rec["steps"].append(st), via="voice")
                rec["answer"] = out.get("answer")
                rec["status"] = "done" if out["status"] == "done" else out["status"]
            except Exception as e:
                rec["answer"], rec["status"] = "Something went wrong with the bank task.", "error"
                log(f"navigator task failed: {type(e).__name__}")
            finally:
                with self.lock:
                    self.busy.discard("phone")
                rec["finished"] = time.time()
                log(f"money task {rec['id']}: {rec['status']} in {rec['finished'] - rec['started']:.0f}s, {len(rec['steps'])} steps")
        threading.Thread(target=work, daemon=True).start()
        deadline = time.time() + min(max(wait or self.WAIT_FOR_ANSWER, 1), 55)
        while time.time() < deadline:
            self._sync_money(rec)
            if rec["status"] not in ("running",):
                break
            time.sleep(0.3)
        self._sync_money(rec)
        out = {"status": rec["status"], "task_id": rec["id"], "device": "phone", "answer": rec["answer"]}
        if rec["status"] == "needs_confirmation":
            out["payment"] = {k: v for k, v in (rec["payment"] or {}).items() if k != "token"}
        elif rec["status"] == "running":
            out["message"] = "I'm working on it in your bank app. Say stop at any time."
        return out

    def _sync_money(self, rec: dict) -> None:
        """Mirror the Navigator's state into the record the Kairos app polls: awaiting_approval shows the card."""
        nav = navigator()
        if rec.get("nav_id") is None:
            if nav.latest_id == rec.get("nav_before"):
                return  # the Navigator hasn't opened this payment's record yet
            rec["nav_id"] = nav.latest_id
        st = nav.status(rec["nav_id"]) if rec["nav_id"] else {}
        if not st or st.get("status") == "none":
            return
        s_ = st["status"]
        if s_ == "awaiting_approval":
            rec["status"], rec["payment"] = "needs_confirmation", st.get("payment")
            p = st["payment"]
            rec["answer"] = (f"I've filled it in and checked the bank's screen: it shows {p.get('cop_name') or p['payee']} and {p['amount']}. "
                             f"Tap Yes on your phone to send it. You have about {p.get('expires_in', 90)} seconds.")
        elif s_ in NAV_RUNNING:
            rec["status"] = "running"
        elif rec["status"] in ("running", "needs_confirmation") and st.get("answer"):
            rec["status"], rec["answer"] = s_, st["answer"]

    @staticmethod
    def _one(device: str, task: str, confirmed: bool, on_step, channel: str = "cloud") -> dict:
        if device in ("team", "hub"):
            sys.path.insert(0, str(HERE.parent / "hands"))
            import conductor  # tempo-hub/hands/conductor.py: splits into up to 5 agents across hub/laptop/phone
            if device == "hub":
                on_step("Asked the Tempo hub")
                return conductor.ask_hub(task)
            return conductor.run_team(task, user_confirmed=confirmed, on_step=on_step, channel=channel,
                                      return_bundle=return_bundle())
        if device == "laptop":
            sys.path.insert(0, str(HERE.parent / "hands"))
            import laptop_agent  # tempo-hub/hands/laptop_agent.py: safe Mac actions, local model
            return laptop_agent.run(task, on_step=on_step, via="voice")
        sys.path.insert(0, str(HERE.parent / "phone"))
        import phone_agent  # tempo-hub/phone/phone_agent.py: local model + iCTRL on the iPhone
        return phone_agent.run(task, user_confirmed=confirmed, on_step=on_step, via="voice", channel=channel,
                               return_bundle=return_bundle())

    def _run(self, rec: dict, confirmed: bool, need: set, channel: str = "cloud") -> None:
        try:
            if rec["device"] == "both":  # the two hands work in parallel
                results = {}

                def work(dev):
                    results[dev] = self._one(dev, rec["task"], confirmed, lambda s, d=dev: rec["steps"].append(f"{d}: {s}"), channel)
                threads = [threading.Thread(target=work, args=(d,)) for d in ("laptop", "phone")]
                [t.start() for t in threads]
                [t.join() for t in threads]
                rec["answer"] = " ".join(f"On your {d}: {results[d]['answer']}" for d in ("phone", "laptop") if d in results)
                rec["status"] = "done" if all(r["status"] == "done" for r in results.values()) else "partial"
            else:
                out = self._one(rec["device"], rec["task"], confirmed, lambda s: rec["steps"].append(s), channel)
                rec["answer"], rec["status"] = out["answer"], out["status"]
        except Exception as e:  # never let a task kill the server
            rec["answer"], rec["status"] = "Something went wrong.", "error"
            log(f"task failed: {type(e).__name__}")
        finally:
            with self.lock:
                self.busy -= need
        rec["finished"] = time.time()
        log(f"task {rec['id']} on {rec['device']}: {rec['status']} in {rec['finished'] - rec['started']:.0f}s, {len(rec['steps'])} steps")

    APPROVAL_TTL = 120  # seconds a pending action can be approved

    def approve(self, task_id: str) -> dict:
        """One-time: re-run exactly the task that stopped for confirmation, now confirmed, if it is still fresh.
        A money task is different: the Navigator is still on the bank's review screen, so the Yes lets it press
        Confirm (the token's own expiry applies)."""
        r = self.latest
        if r and r["id"] == task_id and r.get("money"):
            if r["status"] != "needs_confirmation":
                return {"status": "refused", "message": "There's nothing waiting for your OK."}
            out = navigator().approve(r["nav_id"], by="phone")
            if out.get("status") == "approved":
                r["status"], r["answer"] = "running", None
                r["steps"].append("Approved by you on the phone")
                log(f"money task {task_id} approved on the phone")
                deadline = time.time() + 20
                while time.time() < deadline and r["status"] == "running":
                    self._sync_money(r)
                    time.sleep(0.3)
                return {"status": r["status"], "task_id": r["id"], "answer": r["answer"]}
            return out
        if not r or r["id"] != task_id or r["status"] != "needs_confirmation" or r.get("approved"):
            return {"status": "refused", "message": "There's nothing waiting for your OK."}
        if time.time() - (r["finished"] or 0) > self.APPROVAL_TTL:
            return {"status": "expired", "message": "That request is too old. Please ask again."}
        r["approved"] = True
        log(f"task {task_id} approved on the phone")
        return self.start(r["task"], True, r["device"] if r["device"] in ("phone", "laptop") else "phone", None, "device")

    def view(self) -> dict:
        r = self.latest
        if not r:
            return {"status": "none"}
        if r.get("money") and r["status"] in ("running", "needs_confirmation"):
            self._sync_money(r)
        out = {k: r.get(k) for k in ("id", "device", "task", "status", "steps", "answer", "started", "finished")}
        if r.get("money"):
            out["money"] = True
            if r["status"] == "needs_confirmation" and r.get("payment"):
                st = navigator().status(r["nav_id"])
                p = dict(st.get("payment") or r["payment"])
                p.pop("token", None)  # the phone key already proves it's the owner's phone
                out["payment"] = p
        return out


TASKS = Tasks()


def mint(mode: str, env: dict) -> dict:
    agent = urllib.parse.quote(env["ELEVENLABS_AGENT_ID"])
    path = f"/token?agent_id={agent}" if mode == "webrtc" else f"/get-signed-url?agent_id={agent}"
    req = urllib.request.Request(EL_API + path, headers={"xi-api-key": env["ELEVENLABS_API_KEY"]})
    with urllib.request.urlopen(req, timeout=10) as r:
        data = json.loads(r.read().decode())
    return {"token": data["token"]} if mode == "webrtc" else {"signed_url": data["signed_url"]}


class Handler(BaseHTTPRequestHandler):
    server_version = "tempo-voice"
    sys_version = ""

    def log_message(self, *args):  # the default logs full request lines; we log our own short lines
        pass

    def client_ip(self) -> str:
        # Behind ngrok the socket peer is 127.0.0.1; ngrok APPENDS the phone's real address to X-Forwarded-For.
        # Use the last entry: earlier ones are whatever the caller sent, so trusting them would let anyone
        # dodge the lockout and rate limits. Direct requests on this Mac have no header.
        fwd = self.headers.get("X-Forwarded-For", "")
        return fwd.split(",")[-1].strip() or self.client_address[0]

    def send(self, code: int, body: bytes, ctype: str, extra=None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def json(self, code: int, obj: dict) -> None:
        self.send(code, json.dumps(obj).encode(), "application/json")

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        if path == "/voice":
            return self.send(308, b"", "text/plain", {"Location": "/voice/"})
        if path == "/voice/phone-task/latest":
            return self.phone_task_status()
        if path == "/voice/guardian/status":
            return self.guardian_status()
        if path.startswith("/voice/agents/"):
            return self.proxy_agents("GET")
        if path == "/voice/health":
            env = read_env()
            return self.json(200, {"ok": True, "agent": bool(env.get("ELEVENLABS_AGENT_ID")),
                                   "phone_key": bool(env.get("TEMPO_PHONE_KEY"))})
        if not path.startswith("/voice/"):
            return self.json(404, {"error": "not found"})
        rel = path[len("/voice/"):] or "index.html"
        f = (PAGE_DIR / rel).resolve()
        if PAGE_DIR.resolve() not in f.parents or not f.is_file():
            return self.json(404, {"error": "not found"})
        csp = ("default-src 'self'; script-src 'self' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; "
               "connect-src 'self' https: wss:; media-src 'self' blob: data:; img-src 'self' data:; "
               "frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
        self.send(200, f.read_bytes(), TYPES.get(f.suffix, "application/octet-stream"),
                  {"Content-Security-Policy": csp} if f.suffix == ".html" else None)

    def authorised(self, env: dict, tool: bool = False) -> str:
        """Which credential matched: "device" (the phone key: the page or Siri on the user's phone), "cloud" (the
        tool secret ElevenLabs sends, only if tool=True), or "" (refused)."""
        checks = [("device", "TEMPO_PHONE_KEY", "X-Tempo-Phone-Key")] + \
                 ([("cloud", "TEMPO_VOICE_TOOL_SECRET", "X-Tempo-Tool-Secret")] if tool else [])
        for channel, env_name, header in checks:
            want, got = env.get(env_name, ""), self.headers.get(header, "")
            if want and got and hmac.compare_digest(want.encode(), got.encode()):
                return channel
        LIMITS.bad_key(self.client_ip())
        return ""

    def phone_task_status(self):
        if LIMITS.blocked(self.client_ip()):
            return self.json(429, {"error": "Too many tries. Wait 10 minutes."})
        if not self.authorised(read_env()):
            return self.json(403, {"error": "not allowed"})
        self.json(200, TASKS.view())

    def guardian_status(self):
        """What the Kairos app's shield shows: the Guardian's status file (written every minute on this Mac) plus the
        live lockdown state. Phone key required; never any secrets, never raw events."""
        if LIMITS.blocked(self.client_ip()):
            return self.json(429, {"error": "Too many tries. Wait 10 minutes."})
        if not self.authorised(read_env()):
            return self.json(403, {"error": "not allowed"})
        try:
            st = json.loads(GUARDIAN_STATUS.read_text())
        except (OSError, ValueError):
            st = {"protected": False, "headline": "Protection isn't running on the hub computer yet.", "alerts": [], "running": False}
        fresh = False
        try:
            t = time.strptime(str(st.get("checked_at", ""))[:19], "%Y-%m-%dT%H:%M:%S")
            fresh = (time.time() - (time.mktime(t) - time.timezone)) < 180
        except (ValueError, OverflowError):
            pass
        st["running"] = fresh
        if not fresh:
            st["protected"] = False
            st["headline"] = st.get("headline") if not st.get("checked_at") else "Protection paused: the Guardian hasn't checked in for a while."
        if guardian_lockdown is not None:
            st["lockdown"] = guardian_lockdown.status()
            if st["lockdown"]["locked"] and fresh:
                st["headline"] = "Kairos stopped something. " + ", ".join(st["lockdown"]["scopes"]).capitalize() + " are paused until you check."
        self.json(200, {k: st.get(k) for k in ("protected", "running", "headline", "checked_at", "lockdown", "alerts", "alert_counts",
                                                "integrity", "vault", "baseline", "canaries")})

    def guardian_unlock(self):
        """The owner's phone (phone key + the app's Face ID) switches Kairos back on after a lockdown."""
        if LIMITS.blocked(self.client_ip()):
            return self.json(429, {"error": "Too many tries. Wait 10 minutes."})
        if self.authorised(read_env()) != "device":
            return self.json(403, {"error": "Only the user's phone can switch Kairos back on."})
        if guardian_lockdown is None:
            return self.json(503, {"error": "no guardian"})
        was = guardian_lockdown.status()
        ok = guardian_lockdown.unlock("phone")
        log("guardian lockdown cleared from the phone")
        self.json(200, {"unlocked": ok, "was": was})

    def proxy_agents(self, method: str, path: str = None, body: bytes = None):
        """/voice/agents/<path> -> the agents service at /agents/<path>, after the phone-key check. The service
        itself answers only this computer, so this is the one door phones have to the letter reader.
        `path`/`body` are given when the call arrived in a phone-task envelope (see the module docstring)."""
        ip = self.client_ip()
        if LIMITS.blocked(ip):
            return self.json(429, {"error": "Too many tries. Wait 10 minutes."})
        if not self.authorised(read_env()):
            log("agents request refused: wrong or missing phone key")
            return self.json(403, {"error": "not allowed"})
        if path is None:
            path = urllib.parse.urlsplit(self.path).path[len("/voice"):]
        if not AGENTS_PATH.match(path):
            return self.json(404, {"error": "not found"})
        if method == "POST" and body is None:
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = 0
            if length > AGENTS_MAX_BODY:
                return self.json(413, {"error": "That photo is too big. Please try again; the app will shrink it."})
            body = self.rfile.read(length)
        req = urllib.request.Request(AGENTS_URL + path, data=body, method=method,
                                     headers={"Content-Type": "application/json"})
        t0 = time.time()
        try:
            with urllib.request.urlopen(req, timeout=125) as r:
                code, data = r.status, r.read()
        except urllib.error.HTTPError as e:
            code, data = e.code, e.read()
        except (urllib.error.URLError, OSError):
            log(f"agents {method} {path}: service unreachable")
            return self.json(503, {"error": "The letter reader isn't running on the laptop yet (agents/run.sh)."})
        log(f"agents {method} {path}: {code} in {time.time() - t0:.1f}s")  # never the body: it's someone's letter
        self.send(code, data, "application/json")

    def phone_task_start(self):
        if LIMITS.blocked(self.client_ip()):
            return self.json(429, {"error": "Too many tries. Wait 10 minutes."})
        channel = self.authorised(read_env(), tool=True)
        if not channel:
            log("phone task refused: wrong or missing secret")
            return self.json(403, {"error": "not allowed"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length > 4096:
            # Only an agents envelope (a slice of a photo) may be this big, and only from the person's own phone.
            if channel != "device" or length > AGENTS_MAX_BODY:
                return self.json(413, {"error": "Too big."})
            try:
                env_body = json.loads(self.rfile.read(length) or b"{}")
            except ValueError:
                return self.json(400, {"error": "Bad JSON."})
            if not isinstance(env_body, dict) or not env_body.get("agent_path"):
                return self.json(413, {"error": "Say what to do on the phone, in under 4 KB."})
            return self.proxy_agents("POST", str(env_body["agent_path"]), json.dumps(env_body.get("payload") or {}).encode())
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            body = {}
        if isinstance(body, dict) and body.get("agent_path"):  # a small agents call in the envelope (e.g. interpret)
            if channel != "device":
                return self.json(403, {"error": "Only the user's phone may use the agents."})
            return self.proxy_agents("POST", str(body["agent_path"]), json.dumps(body.get("payload") or {}).encode())
        task = " ".join(str(body.get("task") or "").split())[:300]
        if not task:
            return self.json(400, {"error": "Say what to do on the phone."})
        if body.get("approve"):  # the user tapped "Yes" on the phone for one exact pending action
            if channel != "device":
                return self.json(403, {"error": "Only the user's phone can approve."})
            return self.json(200, TASKS.approve(str(body["approve"])))
        # Consent never comes from the cloud LLM's word: "user_confirmed" from ElevenLabs is ignored. Risky steps
        # stop with status "needs_confirmation" and the Kairos app shows a Yes/No card (see TASKS.approve).
        confirmed = False
        device = str(body.get("device") or "auto")
        try:
            wait = float(body.get("wait") or 0) or None  # Siri Shortcuts can wait longer than ElevenLabs' 30 s
        except (TypeError, ValueError):
            wait = None
        log(f"task requested for {pick_device(device, task)} ({'confirmed' if confirmed else 'unconfirmed'})")
        self.json(200, TASKS.start(task, confirmed, device, wait, channel))

    def do_POST(self):
        path = urllib.parse.urlsplit(self.path).path
        if path == "/voice/guardian/unlock":
            return self.guardian_unlock()
        if path == "/voice/phone-task":
            return self.phone_task_start()
        if path.startswith("/voice/agents/"):
            return self.proxy_agents("POST")
        if path != "/voice/token":
            return self.json(404, {"error": "not found"})
        ip = self.client_ip()
        if LIMITS.blocked(ip):
            log(f"token refused: too many wrong keys from one address")
            return self.json(429, {"error": "Too many tries. Wait 10 minutes."})
        env = read_env()  # re-read each time, so a new agent ID or phone key works without a restart
        want = env.get("TEMPO_PHONE_KEY", "")
        got = self.headers.get("X-Tempo-Phone-Key", "")
        if not want or not hmac.compare_digest(want.encode(), got.encode()):
            LIMITS.bad_key(ip)
            log("token refused: wrong or missing phone key")
            return self.json(403, {"error": "This link isn't valid. Ask for a new Tempo link."})
        if voice_killed(env):
            log("token refused: KAIROS_KILL_VOICE is on")
            return self.json(503, {"error": "Kairos's voice is paused right now. Try again later."})
        if not env.get("ELEVENLABS_API_KEY") or not env.get("ELEVENLABS_AGENT_ID"):
            return self.json(503, {"error": "Tempo's voice agent isn't set up on the laptop yet."})
        try:
            length = min(int(self.headers.get("Content-Length") or 0), 1024)
            mode = json.loads(self.rfile.read(length) or b"{}").get("mode", "webrtc")
        except (ValueError, AttributeError):
            mode = "webrtc"
        mode = "websocket" if mode == "websocket" else "webrtc"
        if not LIMITS.take(ip):
            log("token refused: rate limit")
            return self.json(429, {"error": "Too many calls just now. Try again in a minute."})
        if not DAILY.take(env, ip, mode):
            log("token refused: daily voice limit reached")
            return self.json(429, {"error": "Kairos has used today's voice calls. Please try again tomorrow."})
        try:
            out = mint(mode, env)
        except urllib.error.HTTPError as e:
            log(f"token {mode}: ElevenLabs said {e.code}")
            return self.json(502, {"error": f"ElevenLabs said {e.code}."})
        except (urllib.error.URLError, OSError, KeyError, ValueError):
            log(f"token {mode}: ElevenLabs unreachable")
            return self.json(502, {"error": "Can't reach ElevenLabs from the laptop."})
        LAST_CLIENT.update(name="app" if self.headers.get("X-Tempo-Client") == "app" else "page", at=time.time())
        log(f"token {mode}: ok ({LAST_CLIENT['name']})")
        self.json(200, out)


def main() -> int:
    if "--new-tool-secret" in sys.argv:  # shared with ElevenLabs as a workspace secret for the phone_task tool
        set_env("TEMPO_VOICE_TOOL_SECRET", secrets.token_urlsafe(32))
        print("New tool secret saved in .env as TEMPO_VOICE_TOOL_SECRET (not printed).")
        return 0
    if "--new-phone-key" in sys.argv:
        set_env("TEMPO_PHONE_KEY", secrets.token_urlsafe(24))
        print("New phone key saved in .env (old phone links stop working).")
    if "--new-phone-key" in sys.argv or "--link" in sys.argv:
        key = read_env().get("TEMPO_PHONE_KEY")
        if not key:
            print("No phone key yet. Run: python3 token_server.py --new-phone-key")
            return 1
        link = f"{PUBLIC_URL}/voice/#k={key}"
        import subprocess
        subprocess.run(["pbcopy"], input=link.encode(), check=True)  # never printed: terminals get projected
        print("Phone link copied to this Mac's clipboard. Paste it into Safari on your iPhone (Universal "
              "Clipboard), or AirDrop it to yourself. It's a secret: only send it to your own phone.")
        return 0
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    log(f"tempo voice page on http://127.0.0.1:{PORT}/voice/  (agent set: {bool(read_env().get('ELEVENLABS_AGENT_ID'))})")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
