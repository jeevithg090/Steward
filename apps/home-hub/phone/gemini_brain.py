#!/usr/bin/env python3
"""Gemini as the brain for the phone agent (phone_agent.py) and the conductor (hands/conductor.py). Stdlib only.

Native REST: POST v1beta/models/<model>:generateContent with the key in the x-goog-api-key header (never in the URL,
a log or an error message). Tool use goes through functionDeclarations / functionCall / functionResponse parts, and
the model's content is put back into the history exactly as it came, so Gemini 3's thought signatures round-trip.
No temperature is sent (Gemini 3 guidance); thinking is "minimal" for Flash models, which is what makes a decision
take about a second instead of the local model's several.

Settings (the process env first, then tempo-hub/agents/.env, then tempo-hub/voice/.env):
  GEMINI_API_KEY               the key (agents/set_gemini_key.sh writes it). Read here only; never printed.
  TEMPO_PHONE_BRAIN            gemini | ollama. Default: gemini when a key is found, else ollama.
  GEMINI_PHONE_MODEL           default gemini-3.5-flash-lite
  TEMPO_PHONE_GEMINI_TIMEOUT   seconds per call, default 10
Every failure raises GeminiError; the callers then hand the decision to the local model (Ollama) instead.
Works on macOS's /usr/bin/python3 3.9 (the voice token server runs on it).
"""
from __future__ import annotations

import json
import os
import socket
import time
import urllib.error
import urllib.request
from collections import namedtuple
from pathlib import Path

HUB_DIR = Path(__file__).resolve().parents[1]
AGENTS_ENV = HUB_DIR / "agents" / ".env"
VOICE_ENV = HUB_DIR / "voice" / ".env"
API = "https://generativelanguage.googleapis.com/v1beta/models"
DEFAULT_MODEL = "gemini-3.5-flash-lite"

Call = namedtuple("Call", "name args id")          # one functionCall the model asked for
Turn = namedtuple("Turn", "content text calls")    # content: the model's content, unchanged, for the history


class GeminiError(RuntimeError):
    """Gemini gave no usable answer. The message never holds the key. retry: worth one more try (malformed call)."""

    def __init__(self, message: str, retry: bool = False):
        super().__init__(message)
        self.retry = retry


# ---------- settings ----------

def _env_files() -> list:
    # The test suite points both at an absent file, so a key on this Mac never turns a test into a real call.
    return [("agents/.env", Path(os.environ.get("KAIROS_AGENTS_ENV_FILE") or AGENTS_ENV)),
            ("voice/.env", Path(os.environ.get("KAIROS_ENV_FILE") or VOICE_ENV))]


def _parse_env(path: Path) -> dict:
    out = {}
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return out
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("export "):
            line = line[7:].lstrip()
        k, sep, v = line.partition("=")
        if not sep or not k.strip() or k.startswith("#"):
            continue
        v = v.strip()
        end = v.find(v[0], 1) if v[:1] in ("'", '"') else -1
        v = v[1:end] if end > 0 else v.split(" #", 1)[0].strip()
        out[k.strip()] = v
    return out


def _lookup(name: str):
    """(value, where it came from) for a setting; ("", "") if unset."""
    if os.environ.get(name):
        return os.environ[name], "environment"
    for label, path in _env_files():
        v = _parse_env(path).get(name)
        if v:
            return v, label
    return "", ""


def setting(name: str, default: str = "") -> str:
    return _lookup(name)[0] or default


def api_key() -> str:
    return setting("GEMINI_API_KEY") or setting("GOOGLE_API_KEY")


def key_source() -> str:
    """Where the key was found ("environment", "agents/.env", "voice/.env") or "" - never the key itself."""
    return _lookup("GEMINI_API_KEY")[1] or _lookup("GOOGLE_API_KEY")[1]


def choose(*names: str) -> str:
    """"gemini" or "ollama". The first of `names` that is set wins (e.g. TEMPO_CONDUCTOR_BRAIN, TEMPO_PHONE_BRAIN);
    unset means Gemini when a key is found. Gemini without a key is the local model."""
    want = ""
    for n in names or ("TEMPO_PHONE_BRAIN",):
        want = setting(n).strip().lower()
        if want:
            break
    if want in ("ollama", "local", "off"):
        return "ollama"
    return "gemini" if api_key() else "ollama"


def thinking_for(model: str):
    """Gemini 3 Flash / Flash-Lite take "minimal" (fastest); other Gemini 3 models start at "low"; 2.5 Flash a zero
    budget. A model that refuses the setting is asked again without it."""
    m = model.lower()
    if m.startswith("gemini-3"):
        return {"thinkingLevel": "minimal" if "flash" in m else "low"}
    if m.startswith("gemini-2.5-flash"):
        return {"thinkingBudget": 0}
    return None


# ---------- request / response shapes ----------

def declarations(openai_tools: list) -> list:
    """OpenAI/Ollama-style tools -> Gemini functionDeclarations. The parameter schemas are already the OpenAPI
    subset Gemini takes (type, properties, required, enum, description). Tools without parameters send none,
    since an object schema with no properties is refused by some Gemini versions."""
    out = []
    for t in openai_tools:
        fn = t.get("function", t)
        d = {"name": fn["name"], "description": fn.get("description", "")}
        params = fn.get("parameters") or {}
        if params.get("properties"):
            d["parameters"] = params
        out.append(d)
    return out


def user_text(text: str) -> dict:
    return {"role": "user", "parts": [{"text": text}]}


def function_responses(items: list) -> dict:
    """[(Call, result text), ...] -> one user turn with a functionResponse part per call, in order, ids echoed."""
    parts = []
    for call, result in items:
        fr = {"name": call.name, "response": {"result": result}}
        if call.id:
            fr["id"] = call.id
        parts.append({"functionResponse": fr})
    return {"role": "user", "parts": parts}


def parse_turn(reply: dict) -> Turn:
    """candidates[0].content -> Turn(content unchanged, text without thought summaries, function calls)."""
    cands = reply.get("candidates") or []
    if not cands:
        reason = (reply.get("promptFeedback") or {}).get("blockReason")
        raise GeminiError(f"blocked ({reason})" if reason else "no answer", retry=not reason)
    cand = cands[0] or {}
    content = cand.get("content")
    parts = (content or {}).get("parts") if isinstance(content, dict) else None
    if not parts:
        reason = cand.get("finishReason") or ""
        raise GeminiError(f"no usable answer ({reason or 'empty'})",
                          retry=reason in ("", "STOP", "MALFORMED_FUNCTION_CALL", "OTHER"))
    if "role" not in content:
        content["role"] = "model"
    text, calls = "", []
    for p in parts:
        fc = p.get("functionCall") if isinstance(p, dict) else None
        if fc and fc.get("name"):
            args = fc.get("args")
            calls.append(Call(str(fc["name"]), args if isinstance(args, dict) else {}, fc.get("id")))
        elif isinstance(p, dict) and isinstance(p.get("text"), str) and not p.get("thought"):
            text += p["text"]
    if not calls and not text.strip():
        raise GeminiError("an empty answer", retry=True)
    return Turn(content, text.strip(), calls)


def loads_json(text: str) -> dict:
    text = (text or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text[4:] if text.lower().startswith("json") else text
    try:
        out = json.loads(text)
    except ValueError:
        start, end = text.find("{"), text.rfind("}")
        try:
            out = json.loads(text[start:end + 1]) if 0 <= start < end else None
        except ValueError:
            out = None
    if not isinstance(out, dict):
        raise GeminiError("the answer wasn't a JSON object")
    return out


# ---------- the one network call (tests replace it) ----------

def http_post(url: str, body: dict, headers: dict, timeout: float) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), method="POST",
                                 headers={"Content-Type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


class Gemini:
    def __init__(self, model: str = None, key: str = None, timeout: float = None):
        self.model = model or setting("GEMINI_PHONE_MODEL", DEFAULT_MODEL)
        self._key = key if key is not None else api_key()
        if not self._key:
            raise GeminiError("no Gemini key is set")
        try:
            self.timeout = float(timeout or setting("TEMPO_PHONE_GEMINI_TIMEOUT", "10"))
        except ValueError:
            self.timeout = 10.0
        self.thinking = thinking_for(self.model)
        self.calls = 0
        self.last_ms = 0

    def __repr__(self) -> str:  # never show the key
        return f"Gemini({self.model})"

    @property
    def label(self) -> str:
        return f"Gemini ({self.model})"

    def _scrub(self, s: str) -> str:
        return s.replace(self._key, "[key]") if self._key else s

    def _post(self, body: dict) -> dict:
        url = f"{API}/{self.model}:generateContent"
        headers = {"x-goog-api-key": self._key}
        t0 = time.time()
        for attempt in range(3):
            cfg = dict(body.get("generationConfig") or {})
            if self.thinking:
                cfg["thinkingConfig"] = self.thinking
            send = {**body, "generationConfig": cfg}
            try:
                out = http_post(url, send, headers, self.timeout)
                self.calls += 1
                self.last_ms = int((time.time() - t0) * 1000)
                if not isinstance(out, dict):
                    raise GeminiError("odd reply")
                return out
            except urllib.error.HTTPError as e:
                try:
                    detail = e.read().decode("utf-8", "replace")[:300]
                except Exception:
                    detail = ""
                if e.code == 400 and self.thinking and "thinking" in detail.lower():
                    self.thinking = None  # this model doesn't take that setting: ask again without it
                    continue
                if e.code in (500, 502, 503, 504) and attempt == 0:
                    time.sleep(0.4)
                    continue
                raise GeminiError(self._scrub(f"HTTP {e.code}: {' '.join(detail.split())[:160]}")) from None
            except (urllib.error.URLError, socket.timeout, OSError, ValueError) as e:
                raise GeminiError(self._scrub(f"{type(e).__name__}: {str(e)[:120]}")) from None
        raise GeminiError("Gemini kept failing")

    def step(self, system: str, contents: list, decls: list, require_tool: bool = True,
             max_tokens: int = 1024) -> Turn:
        """One agent decision: system + history (Gemini contents) + tools in, Turn out. The caller appends
        turn.content to `contents` unchanged, then the function responses."""
        body = {"systemInstruction": {"parts": [{"text": system}]}, "contents": contents,
                "generationConfig": {"maxOutputTokens": max_tokens}}
        if decls:
            body["tools"] = [{"functionDeclarations": decls}]
            body["toolConfig"] = {"functionCallingConfig": {"mode": "ANY" if require_tool else "AUTO"}}
        err = None
        for _ in range(2):  # one more try for a malformed or empty answer; anything else goes to the caller
            try:
                return parse_turn(self._post(body))
            except GeminiError as e:
                if not e.retry:
                    raise
                err = e
        raise err

    def json(self, system: str, user: str, max_tokens: int = 1024) -> dict:
        """One JSON object (responseMimeType application/json) for a one-shot question like the conductor's plan."""
        body = {"systemInstruction": {"parts": [{"text": system}]}, "contents": [user_text(user)],
                "generationConfig": {"responseMimeType": "application/json", "maxOutputTokens": max_tokens}}
        return loads_json(parse_turn(self._post(body)).text)
