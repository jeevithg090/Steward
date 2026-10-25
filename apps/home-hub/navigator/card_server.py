"""A tiny local API so the Kairos app can show the payment card and approve it when the Navigator runs ON the phone.

When the Navigator runs inside an on-device sandbox (OpenMinis's Alpine Linux, or any shell on the phone), there is
no Mac in the loop: the approval has to come from an app on the same phone. This server binds to 127.0.0.1 only.
Kairos, in "Navigator on this phone" mode, polls GET /navigator/status, shows the card, asks for Face ID, and
POSTs /navigator/approve with the payment's one-time token.

    GET  /navigator/status                -> the latest payment's view (token only while awaiting approval)
    POST /navigator/approve  {id, token}  -> approved | refused | expired
    POST /navigator/decline  {id}
    POST /navigator/stop     {id}
    GET  /navigator/ledger                -> the timeline of the latest payment

Honest limit: anything on this phone that can reach loopback and read /status could approve. The native in-app
Navigator (Kairos holding the token itself) removes that; this is the bridge until then.
"""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional


class CardServer:
    def __init__(self, navigator, port: int = 8790, host: str = "127.0.0.1"):
        self.nav = navigator
        self.port = port
        self.host = host
        self.httpd: Optional[ThreadingHTTPServer] = None
        self.thread: Optional[threading.Thread] = None

    def start(self) -> "CardServer":
        nav = self.nav

        class Handler(BaseHTTPRequestHandler):
            server_version = "kairos-navigator"
            sys_version = ""

            def log_message(self, *a):  # quiet: never log bodies
                pass

            def _json(self, code: int, obj) -> None:
                body = json.dumps(obj, default=str).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)

            def _body(self) -> dict:
                try:
                    n = min(int(self.headers.get("Content-Length") or 0), 4096)
                    return json.loads(self.rfile.read(n) or b"{}")
                except ValueError:
                    return {}

            def do_GET(self):
                if self.path.startswith("/navigator/status"):
                    st = nav.status()
                    view = {k: st.get(k) for k in ("id", "task", "status", "steps", "answer", "payment")}
                    # the Kairos app expects the voice server's shape: needs_confirmation while a card is up
                    view["status"] = {"awaiting_approval": "needs_confirmation", "understanding": "running", "checking": "running",
                                      "navigating": "running", "executing": "running"}.get(view["status"], view["status"])
                    view["money"] = True
                    return self._json(200, view)
                if self.path.startswith("/navigator/ledger"):
                    return self._json(200, {"timeline": nav.timeline()})
                self._json(404, {"error": "not found"})

            def do_POST(self):
                body = self._body()
                pid = body.get("id") or body.get("approve") or nav.latest_id
                if self.path == "/navigator/approve":
                    return self._json(200, nav.approve(pid, body.get("token"), by="phone-card"))
                if self.path == "/navigator/decline":
                    return self._json(200, nav.decline(pid))
                if self.path == "/navigator/stop":
                    return self._json(200, nav.stop(pid))
                self._json(404, {"error": "not found"})

        self.httpd = ThreadingHTTPServer((self.host, self.port), Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        return self

    def stop(self) -> None:
        if self.httpd:
            self.httpd.shutdown()
