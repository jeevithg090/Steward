"""The model behind the Navigator: Gemini by default (the team's agent model), local Ollama as the open fallback.

Only ever asked for JSON that matches a schema we wrote, and only for judgement calls: what kind of request this
is, which payee phrase was said, which screen we're on when the skill's anchors don't match. It never supplies
an amount, never picks a payee that isn't in the book, and never decides to press Confirm. Every answer is
validated by the caller; a bad or missing answer means "ask the person", not "guess".

Config (env, or tempo-hub/voice/.env): GEMINI_API_KEY, GEMINI_MODEL (default gemini-2.5-flash),
GEMINI_BASE_URL (the OpenAI-compatible endpoint), TEMPO_NAVIGATOR_MODEL (Ollama fallback, default qwen2.5:7b),
TEMPO_OLLAMA_URL, TEMPO_NAVIGATOR_BRAIN = gemini | ollama | off (default: gemini if a key is set, else ollama).
Screens marked private in a skill (the PIN screen) are never sent to a cloud model.
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional

ENV_FILE = Path(__file__).resolve().parents[1] / "voice" / ".env"
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai"


def _env(name: str, default: str = "") -> str:
    if os.environ.get(name):
        return os.environ[name]
    try:
        for line in ENV_FILE.read_text().splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return default


class Brain:
    def __init__(self, provider: Optional[str] = None, timeout: float = 20.0):
        key = _env("GEMINI_API_KEY")
        want = (provider or _env("TEMPO_NAVIGATOR_BRAIN") or ("gemini" if key else "ollama")).lower()
        self.provider = want if want in ("gemini", "ollama", "off") else "ollama"
        if self.provider == "gemini" and not key:
            self.provider = "ollama"
        self._key = key
        self.gemini_model = _env("GEMINI_MODEL", "gemini-2.5-flash")
        self.gemini_base = _env("GEMINI_BASE_URL", GEMINI_BASE).rstrip("/")
        self.ollama_model = _env("TEMPO_NAVIGATOR_MODEL", "qwen2.5:7b")
        self.ollama_url = _env("TEMPO_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
        self.timeout = timeout
        self.calls = 0
        self.last_error = ""
        self.last_ms = 0

    @property
    def cloud(self) -> bool:
        return self.provider == "gemini"

    def describe(self) -> str:
        return {"gemini": f"Gemini ({self.gemini_model})", "ollama": f"local Ollama ({self.ollama_model})", "off": "off"}[self.provider]

    def complete_json(self, system: str, user: str, schema: Dict[str, Any], private: bool = False) -> Optional[dict]:
        """One JSON answer matching `schema`, or None. private=True never leaves this computer."""
        if self.provider == "off":
            return None
        t0 = time.time()
        try:
            if self.provider == "gemini" and not private:
                out = self._gemini(system, user, schema)
            else:
                out = self._ollama(system, user, schema)
        except Exception as e:  # network, quota, bad JSON: the caller asks the person instead
            self.last_error = f"{type(e).__name__}: {str(e)[:120]}"
            out = None
        self.calls += 1
        self.last_ms = int((time.time() - t0) * 1000)
        return out if isinstance(out, dict) else None

    # ---- providers ----
    def _post(self, url: str, body: dict, headers: dict) -> dict:
        req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", **headers})
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            return json.loads(r.read().decode())

    def _gemini(self, system: str, user: str, schema: dict) -> Optional[dict]:
        url = f"{self.gemini_base}/chat/completions"
        headers = {"Authorization": f"Bearer {self._key}"}
        msgs = [{"role": "system", "content": system + "\nAnswer with JSON only, matching this schema:\n" + json.dumps(schema)},
                {"role": "user", "content": user}]
        body = {"model": self.gemini_model, "messages": msgs, "temperature": 0,
                "response_format": {"type": "json_schema", "json_schema": {"name": "answer", "schema": schema}}}
        try:
            data = self._post(url, body, headers)
        except urllib.error.HTTPError as e:
            if e.code != 400:
                raise
            body["response_format"] = {"type": "json_object"}  # older compat layer: schema in the prompt only
            data = self._post(url, body, headers)
        content = data["choices"][0]["message"]["content"]
        return _loads(content)

    def _ollama(self, system: str, user: str, schema: dict) -> Optional[dict]:
        body = {"model": self.ollama_model, "stream": False, "format": schema, "keep_alive": -1,
                "options": {"temperature": 0, "num_ctx": 8192},
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
        data = self._post(f"{self.ollama_url}/api/chat", body, {})
        return _loads(data["message"]["content"])


def _loads(content: str) -> Optional[dict]:
    content = (content or "").strip()
    if content.startswith("```"):
        content = content.strip("`")
        content = content[4:] if content.lower().startswith("json") else content
    try:
        out = json.loads(content)
    except ValueError:
        start, end = content.find("{"), content.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            out = json.loads(content[start:end + 1])
        except ValueError:
            return None
    return out if isinstance(out, dict) else None


def validate(obj: Any, schema: Dict[str, Any]) -> bool:
    """A small JSON-schema check: type, required, enum, properties (recursively). Enough to trust the shape."""
    t = schema.get("type")
    if t == "object":
        if not isinstance(obj, dict):
            return False
        for k in schema.get("required", []):
            if k not in obj:
                return False
        return all(validate(obj[k], sub) for k, sub in schema.get("properties", {}).items() if k in obj)
    if t == "array":
        return isinstance(obj, list) and all(validate(x, schema.get("items", {})) for x in obj)
    if "enum" in schema and obj not in schema["enum"] and obj is not None:
        return False
    if t == "string":
        return isinstance(obj, str) or (obj is None and schema.get("nullable", True))
    if t == "number":
        return isinstance(obj, (int, float)) and not isinstance(obj, bool)
    if t == "integer":
        return isinstance(obj, int) and not isinstance(obj, bool)
    if t == "boolean":
        return isinstance(obj, bool)
    if isinstance(t, list):
        return any(validate(obj, {**schema, "type": x}) for x in t) or (obj is None and "null" in t)
    return True
