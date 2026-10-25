"""The Communications Bridge ("Write for me"): the person speaks a message for someone, Kairos drafts it in a tone
and language, the person checks it on the card and approves, and the phone opens WhatsApp / Messages / Mail
prefilled for the person to tap Send.

Safety, by construction:
  * No model can send. The composer has no tools and no vault access; nothing runs after approve.
  * The server never sees phone numbers or emails: only a recipient_ref and an alias from the phone.
  * Approve locks a hash of (draft, version, recipient_ref, channel, exact text) and returns a single-use nonce
    that expires in 120 s. Any edit makes a new version; an old version or a changed text can't be approved.
    Revise, approve, outcome and cancel change a draft one at a time, each only from the state it expects.
  * Links, numbers, emails, IBANs and sort codes the person never said block the draft (bridge_checks).
  * Drafts are encrypted at rest (AES-GCM), bound to the device that made them and purged after 24 h; the
    stored text hash is keyed; audit events hold a per-person keyed HMAC of the text, never the text; logs never
    contain message text. "Forget everything" deletes them.
  * Daily caps per person, counted before any paid call: 60 drafts (every attempt, clips that weren't
    understood included), 120 revisions, 60 read-backs, 30 hand-offs, 5 new recipients. KAIROS_KILL_SEND stops
    approvals at once.
  * Provider calls run in worker threads: a slow draft never stalls the hub's other requests (voice included).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Literal

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool
from starlette.formparsers import MultiPartParser

from . import db

DRAFT_HOURS = 24
NONCE_SECONDS = 120
MAX_AUDIO_BYTES = 2 * 1024 * 1024
CAPS = {"drafts": int(os.environ.get("KAIROS_DRAFTS_PER_DAY", "60")),
        "revisions": int(os.environ.get("KAIROS_REVISIONS_PER_DAY", "120")),
        "readbacks": int(os.environ.get("KAIROS_READBACKS_PER_DAY", "60")),
        "sends": int(os.environ.get("KAIROS_SENDS_PER_DAY", "30")),
        "new_recipients": int(os.environ.get("KAIROS_NEW_RECIPIENTS_PER_DAY", "5"))}
CAP_WORDS = {"drafts": "messages", "revisions": "changes to messages", "readbacks": "read-alouds",
             "sends": "messages sent", "new_recipients": "new people"}
CHANNELS = ("whatsapp", "sms", "imessage", "email", "telegram", "signal")
TONES = ("warm", "polite", "formal", "brief", "keep-my-words")
CHIPS = {"warmer": "warm", "more_formal": "formal", "shorter": "brief", "keep_my_words": "keep-my-words",
         "polite": "polite"}
LANG_TAG = r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$"

# Starlette writes a multipart file over 1 MB to a temp file; a Write for me clip (BodyCap: at most ~2 MB) stays in
# memory instead, so the audio never touches disk.
MultiPartParser.spool_max_size = MAX_AUDIO_BYTES + 128 * 1024

SCHEMA = """
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  recipient_ref TEXT NOT NULL,
  channel TEXT NOT NULL,
  tone TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  speech_lang TEXT,
  meta_enc TEXT,            -- alias, relation, sign-off (encrypted)
  heard_enc TEXT,           -- the transcript (encrypted)
  text_enc TEXT,            -- the current draft (encrypted)
  back_enc TEXT,            -- the back-translation (encrypted)
  checks TEXT NOT NULL,     -- JSON blocked / flags / risk / needs_tap, encrypted (a flagged value can be a spoken PIN)
  changes TEXT NOT NULL,    -- JSON lists: changes_made, missing (encrypted: the composer's notes echo the message)
  text_hash TEXT NOT NULL,  -- keyed (hmac-sha256): a plain hash of a short message could be guessed
  state TEXT NOT NULL,      -- draft | approved | handed_off | cancelled | failed
  lock_hash TEXT,
  nonce_hash TEXT,
  nonce_expires REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS drafts_person ON drafts(person_id, expires_at);
CREATE TABLE IF NOT EXISTS consents (
  person_id TEXT NOT NULL,
  category TEXT NOT NULL,
  provider TEXT NOT NULL,
  granted INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (person_id, category, provider)
);
CREATE TABLE IF NOT EXISTS bridge_recipients (
  person_id TEXT NOT NULL,
  ref_hash TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  PRIMARY KEY (person_id, ref_hash)
);
"""
_ready: set[str] = set()


def ensure_tables() -> None:
    key = str(db.DB_PATH)
    if key not in _ready:
        db.conn().executescript(SCHEMA)
        db.conn().commit()
        _ready.add(key)


class Refusal(Exception):
    """A Bridge 4xx/5xx the app can say out loud: {"error": code, "message": sentence, "detail": code}. The app
    reads 'message' (a sentence) when 'error' is a bare code; 'detail' keeps FastAPI's usual field."""

    def __init__(self, status: int, code: str, message: str, **extra: Any):
        super().__init__(code)
        self.status, self.body = status, {"error": code, "message": message, "detail": code, **extra}


def _stale() -> Refusal:
    return Refusal(409, "stale_or_mismatch", "This message changed since you saw it. Check the newest version and "
                                             "tap Send again.")


# ---------- keys: drafts are encrypted, audit text is a keyed HMAC ----------

_key_lock = threading.Lock()


def _key() -> bytes:
    """32 bytes from KAIROS_DRAFT_KEY (base64 of exactly 32 bytes) or data/bridge.key (made on first use, mode
    600). A wrong-sized key is refused rather than padded."""
    env = os.environ.get("KAIROS_DRAFT_KEY")
    if env:
        try:
            raw = base64.b64decode(env, validate=True)
        except ValueError:
            raw = b""
        if len(raw) != 32:
            raise RuntimeError("KAIROS_DRAFT_KEY must be base64 of 32 random bytes (openssl rand -base64 32).")
        return raw
    path = db.DB_PATH.parent / "bridge.key"
    with _key_lock:
        if not path.exists():
            path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            try:
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            except FileExistsError:  # another process made it first: use theirs
                pass
            else:
                with os.fdopen(fd, "wb") as f:
                    f.write(secrets.token_bytes(32))
                    f.flush()
                    os.fsync(f.fileno())
        raw = path.read_bytes()
    if len(raw) < 32:
        raise RuntimeError(f"{path} is damaged (under 32 bytes). Move it aside to start again; open drafts are lost.")
    return raw[:32]


def _seal(text: str | None) -> str | None:
    if text is None:
        return None
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    nonce = secrets.token_bytes(12)
    return base64.b64encode(nonce + AESGCM(_key()).encrypt(nonce, text.encode(), b"kairos-draft")).decode()


def _open(blob: str | None) -> str | None:
    if not blob:
        return None
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    raw = base64.b64decode(blob)
    return AESGCM(_key()).decrypt(raw[:12], raw[12:], b"kairos-draft").decode()


def _person_key(person_id: str) -> bytes:
    return hmac.new(_key(), f"person:{person_id}".encode(), hashlib.sha256).digest()


def text_hmac(person_id: str, text: str) -> str:
    """Per-person keyed HMAC of a message: audits can match a text without storing it (a plain hash of 'ok'
    could be guessed)."""
    return "hmac:" + hmac.new(_person_key(person_id), text.encode(), hashlib.sha256).hexdigest()[:32]


def text_hash(person_id: str, text: str) -> str:
    """The card's text hash (approve sends it back unchanged): keyed, so the stored value can't be brute-forced
    back into a short message the way a bare sha256 could."""
    return "hmac-sha256:" + hmac.new(_person_key(person_id), b"card:" + text.encode(), hashlib.sha256).hexdigest()


def _lock(draft_id: str, version: int, recipient_ref: str, channel: str, text: str) -> str:
    return hashlib.sha256(json.dumps([draft_id, version, recipient_ref, channel, text]).encode()).hexdigest()


# ---------- helpers ----------

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds").replace("+00:00", "Z")


def _ms(t0: float) -> int:
    return int((time.monotonic() - t0) * 1000)


def purge() -> int:
    """Delete drafts past their 24 h, and the content of cancelled ones. Returns how many rows went."""
    ensure_tables()
    c = db.conn()
    n = c.execute("DELETE FROM drafts WHERE expires_at < ? OR state='cancelled'", (_iso(_now()),)).rowcount
    c.commit()
    return n


def _purge_loop() -> None:
    while True:
        time.sleep(600)
        try:
            purge()
        except Exception:  # the worker must never die
            pass


def _row(dev: dict, draft_id: str):
    """The draft, only for the device that made it (another device of the person, or a leaked token used for
    something else, can't read or approve it). A draft the current key can't open is deleted: 404."""
    from cryptography.exceptions import InvalidTag
    ensure_tables()
    c = db.conn()
    row = c.execute("SELECT * FROM drafts WHERE id=? AND person_id=? AND device_id=?",
                    (draft_id, dev["person_id"], dev["id"])).fetchone()
    if not row or row["expires_at"] < _iso(_now()):
        raise Refusal(404, "no_such_draft", "That message isn't here any more (drafts last 24 hours). Please say it again.")
    try:
        _open(row["text_enc"])
    except (InvalidTag, ValueError):  # the server's draft key changed (or the row is damaged)
        c.execute("DELETE FROM drafts WHERE id=?", (draft_id,))
        c.commit()
        raise Refusal(404, "no_such_draft", "That message can't be opened any more. Please say it again.") from None
    return row


def _audit(dev: dict, kind: str, payload: dict) -> None:
    db.insert_events(dev["person_id"], dev["id"], [{"kind": kind, "class": "vault", "payload": payload}],
                     source="hub", trust_level="hub")


def _limit(kind: str) -> Refusal:
    return Refusal(429, "daily_limit", f"You've reached today's limit for Write for me ({CAPS[kind]} "
                                       f"{CAP_WORDS[kind]}). It starts again at midnight.", limit=kind)


def _cap(person_id: str, kind: str) -> None:
    """Refuse when today's count has reached the cap (counting happens after the action succeeds)."""
    if db.usage_today(person_id, kind) >= CAPS[kind]:
        raise _limit(kind)


def _take(person_id: str, kind: str) -> None:
    """Count one now, before the paid provider call it pays for; refuse if that would pass today's cap."""
    if not db.usage_take(person_id, kind, CAPS[kind]):
        raise _limit(kind)


def _lang(tag: str | None) -> str:
    return (tag or "").split("-")[0].lower()


def _checks(row) -> dict:
    """The stored checks (encrypted: a flagged value can be a spoken PIN)."""
    return json.loads(_open(row["checks"]) or "{}")


def _changes(row) -> dict:
    raw = row["changes"] or "{}"
    return json.loads(raw if raw.startswith("{") else (_open(raw) or "{}"))  # older rows: plain JSON


def _card(row, extra: dict | None = None) -> dict:
    meta = json.loads(_open(row["meta_enc"]) or "{}")
    changes = _changes(row)
    return {"draft_id": row["id"], "version": row["version"], "state": row["state"],
            "recipient": {"ref": row["recipient_ref"], "alias": meta.get("alias")}, "channel": row["channel"],
            "tone": row["tone"], "target_lang": row["target_lang"],
            "heard": {"text": _open(row["heard_enc"]), "lang": row["speech_lang"]},
            "text": _open(row["text_enc"]), "back_translation": _open(row["back_enc"]),
            "checks": _checks(row), "changes_made": changes.get("changes_made", []),
            "missing": changes.get("missing", []), "text_hash": row["text_hash"], "expires_at": row["expires_at"],
            **(extra or {})}


# ---------- the pipeline: transcript -> draft -> checks -> back-translation ----------

def _compose(transcript: str, meta: dict, tone: str, target_lang: str, timings: dict) -> dict:
    """The composer's draft. A refusal (explicit, or prose instead of the JSON it was asked for) is never turned
    into the raw words; any other failure (timeout, network, provider error, no model configured) offers the
    person's own words back, flagged compose_failed, for them to check and send as said."""
    from . import providers
    t0 = time.monotonic()
    try:
        out = providers.compose(transcript, {"alias": meta.get("alias"), "relation": meta.get("relation"),
                                             "lang": target_lang}, tone, target_lang, meta.get("sign_off"), timeout=8.0)
    except providers.ProviderError as exc:
        if "no json in reply" in str(exc).lower():  # the model answered in prose: a refusal, not an outage
            out = {"text": "", "changes_made": [], "missing": [], "risk": ["refused"], "provider": None}
        else:
            out = {"text": transcript, "changes_made": [], "missing": [], "risk": [], "provider": None,
                   "fallback": "compose_failed"}
    timings["compose"] = _ms(t0)
    return out


def _check_and_translate(transcript: str, out: dict, speech_lang: str | None, target_lang: str,
                         timings: dict) -> tuple[str, dict, str | None, str | None]:
    """(text, checks, back-translation, back-translation provider) for a composed draft."""
    from . import bridge_checks, providers
    text = (out.get("text") or "").strip()
    checks = bridge_checks.check_draft(transcript, text)
    for r in out.get("risk") or []:
        if r not in checks["risk"] and r != "refused":
            checks["risk"].append(r)
    back = back_provider = None
    if out.get("fallback"):  # the person's own words, in their own language: nothing to translate back
        checks["flags"].append({"kind": "compose_failed", "value": "send it as you said it?", "in_transcript": True})
    elif _lang(target_lang) and _lang(target_lang) != (_lang(speech_lang) or "en"):
        t0 = time.monotonic()
        try:  # a separate call that sees only the draft, never the transcript
            bt = providers.back_translate(text, target_lang, speech_lang or "en", timeout=8.0)
            back, back_provider = bt["text"], bt.get("provider")
        except providers.ProviderError:
            checks["flags"].append({"kind": "no_back_translation", "value": "", "in_transcript": False})
        timings["back_translate"] = _ms(t0)
    checks["needs_tap"] = bool(checks["needs_tap"] or checks["risk"] or checks["flags"])
    return text, checks, back, back_provider


class Recipient(BaseModel):
    model_config = ConfigDict(extra="ignore")
    ref: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.:-]+$")
    alias: str = Field(default="", max_length=60)
    relation: str = Field(default="", max_length=40)
    lang: str = Field(default="", max_length=20)


class DraftMeta(BaseModel):
    model_config = ConfigDict(extra="ignore")
    recipient: Recipient
    channel: Literal["whatsapp", "sms", "imessage", "email", "telegram", "signal"] = "whatsapp"
    tone: Literal["warm", "polite", "formal", "brief", "keep-my-words"] = "warm"
    target_lang: str = Field(default="en-GB", max_length=20, pattern=LANG_TAG)
    speech_lang: str | None = Field(default=None, max_length=20, pattern=LANG_TAG)
    transcript: str | None = Field(default=None, max_length=4000)
    user: dict = Field(default_factory=dict)


class ReviseIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int
    chip: Literal["warmer", "more_formal", "shorter", "keep_my_words", "polite"] | None = None
    text: str | None = Field(default=None, max_length=4000)  # the person's own edit


class ApproveIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int
    text_hash: str = Field(max_length=100)
    recipient_ref: str = Field(max_length=64)
    channel: str = Field(max_length=20)
    method: Literal["tap", "faceid"] = "tap"


class OutcomeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    nonce: str = Field(max_length=80)
    outcome: Literal["handed_off", "cancelled", "failed"]


class ConsentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    category: Literal["health", "location", "notifications", "desktop", "messages", "voice_audio", "store_text"]
    provider: str = Field(max_length=40, pattern=r"^[a-z0-9_.-]+$")
    granted: bool


def _make_draft(dev: dict, meta: DraftMeta, audio: bytes | None, filename: str, mime: str, t0: float) -> Any:
    """The draft pipeline, run in a worker thread: STT -> compose -> checks -> back-translation -> store."""
    from . import providers
    timings: dict[str, int] = {}
    pid = dev["person_id"]
    _take(pid, "drafts")  # every attempt costs STT and LLM time, understood or not
    transcript, speech_lang = (meta.transcript or "").strip(), meta.speech_lang
    providers_used: dict[str, str | None] = {}
    if audio:
        t1 = time.monotonic()
        try:
            heard = providers.transcribe(audio, filename=filename, mime=mime, lang=speech_lang,
                                         keyterms=[meta.recipient.alias] if meta.recipient.alias else [], timeout=8.0)
        except providers.ProviderError:
            raise Refusal(502, "stt_failed", "I couldn't hear that clip just now. Please try again, or type it.",
                          timings={"stt": _ms(t1)}) from None
        timings["stt"] = _ms(t1)
        providers_used["stt"] = heard.get("provider")
        transcript, speech_lang = (heard.get("text") or "").strip(), heard.get("lang") or speech_lang
    if len(transcript) < 2:
        ask = "I didn't catch that. Could you say it again?"
        return JSONResponse({"error": "unclear", "ask_user": ask, "message": ask, "timings": {**timings, "total": _ms(t0)}},
                            status_code=422)
    info = {"alias": meta.recipient.alias, "relation": meta.recipient.relation,
            "sign_off": str(meta.user.get("sign_off") or "")[:40] or None}
    out = _compose(transcript, info, meta.tone, meta.target_lang, timings)
    if "refused" in (out.get("risk") or []) or not (out.get("text") or "").strip():
        ask = "I can't write that message. Want to say it differently?"
        return JSONResponse({"error": "refused", "ask_user": ask, "message": ask, "timings": {**timings, "total": _ms(t0)}},
                            status_code=422)
    text, checks, back, back_provider = _check_and_translate(transcript, out, speech_lang, meta.target_lang, timings)
    providers_used.update(compose=out.get("provider"), back_translate=back_provider)
    did, now = "d_" + secrets.token_urlsafe(9), _now()
    row = (did, pid, dev["id"], 1, meta.recipient.ref, meta.channel, meta.tone, meta.target_lang,
           speech_lang, _seal(json.dumps(info)), _seal(transcript), _seal(text), _seal(back), _seal(json.dumps(checks)),
           _seal(json.dumps({"changes_made": out.get("changes_made") or [], "missing": out.get("missing") or []})),
           text_hash(pid, text), "draft", _iso(now), _iso(now), _iso(now + timedelta(hours=DRAFT_HOURS)))
    c = db.conn()
    c.execute("INSERT INTO drafts(id, person_id, device_id, version, recipient_ref, channel, tone, target_lang, speech_lang,"
              " meta_enc, heard_enc, text_enc, back_enc, checks, changes, text_hash, state, created_at, updated_at, expires_at)"
              " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", row)
    c.commit()
    _audit(dev, "bridge.drafted", {"draft_id": did, "version": 1, "channel": meta.channel,
                                   "recipient_ref": meta.recipient.ref, "speech_lang": speech_lang,
                                   "target_lang": meta.target_lang, "text_hmac": text_hmac(pid, text),
                                   "blocked": len(checks["blocked"]), "needs_tap": checks["needs_tap"],
                                   "providers": {k: v for k, v in providers_used.items() if v}})
    timings["total"] = _ms(t0)
    return _card(_row(dev, did), {"timings": timings})


def mount(app: FastAPI, current_device: Callable, killed: Callable[[str], bool]) -> None:
    """Add the Bridge routes. The app's own device token only: never an ask-only agent or a hands device."""

    @app.exception_handler(Refusal)
    async def _refusal(_: Request, exc: Refusal):
        return JSONResponse(exc.body, status_code=exc.status)

    def app_device(dev: dict = Depends(current_device)) -> dict:
        ensure_tables()
        caps = dev.get("capabilities")
        caps = json.loads(caps) if isinstance(caps, str) else (caps or [])
        if dev.get("ask_only") or "hands" in caps or "guardian" in caps:
            raise HTTPException(403, "Write for me works from the Kairos app's own device token.")
        return dev

    def bridge_device(dev: dict = Depends(app_device)) -> dict:
        try:
            _key()
        except RuntimeError as exc:  # a misconfigured draft key: said plainly (details only in the hub's log)
            print(f"[kairos] Write for me is off: {exc}", flush=True)
            raise Refusal(503, "draft_key", "Write for me isn't available on your Mac right now.") from None
        return dev

    ensure_tables()
    threading.Thread(target=_purge_loop, daemon=True).start()

    @app.post("/api/bridge/draft")
    async def draft(request: Request, dev: dict = Depends(bridge_device)):
        """A clip (multipart audio + meta JSON) or a transcript (JSON meta with 'transcript') -> a draft card."""
        t0 = time.monotonic()
        ctype = request.headers.get("content-type", "")
        audio: bytes | None = None
        filename, mime = "clip.m4a", "audio/mp4"
        if ctype.startswith("multipart/"):
            form = await request.form()
            try:
                meta = DraftMeta.model_validate_json(str(form.get("meta") or "{}"))
            except ValueError:
                raise HTTPException(422, "meta must be JSON with recipient {ref, alias}, channel, tone, target_lang.") from None
            up = form.get("audio")
            if up is not None and hasattr(up, "read"):
                audio = await up.read()
                filename = getattr(up, "filename", None) or filename
                mime = getattr(up, "content_type", None) or mime
                if len(audio) > MAX_AUDIO_BYTES:
                    raise Refusal(413, "too_large", "That recording was too long. Please keep it under a minute.")
        else:
            try:
                meta = DraftMeta.model_validate_json(await request.body())
            except ValueError:
                raise HTTPException(422, "Send JSON meta (recipient, channel, tone, target_lang, transcript).") from None
        # STT, the composer and the back-translation block for seconds: off the event loop, so /api/ask and the
        # rest of the hub keep answering meanwhile.
        return await run_in_threadpool(_make_draft, dev, meta, audio, filename, mime, t0)

    @app.get("/api/bridge/drafts/{draft_id}")
    def get_draft(draft_id: str, dev: dict = Depends(bridge_device)):
        return _card(_row(dev, draft_id))

    @app.post("/api/bridge/drafts/{draft_id}/revise")
    def revise(draft_id: str, body: ReviseIn, dev: dict = Depends(bridge_device)):
        """A chip (warmer, more formal, shorter, keep my words) or the person's own edit -> a new version. The old
        version can no longer be approved."""
        t0 = time.monotonic()
        row = _row(dev, draft_id)
        if row["state"] != "draft" or body.version != row["version"]:
            raise _stale()
        if not (body.chip or (body.text and body.text.strip())):
            raise HTTPException(422, "Pick a chip or send your edited text.")
        _take(dev["person_id"], "revisions")
        timings: dict[str, int] = {}
        transcript, info = _open(row["heard_enc"]) or "", json.loads(_open(row["meta_enc"]) or "{}")
        tone = CHIPS[body.chip] if body.chip else row["tone"]
        if body.text and body.text.strip():
            out = {"text": body.text.strip(), "changes_made": ["edited by you"], "missing": [], "risk": []}
        else:
            out = _compose(transcript, info, tone, row["target_lang"], timings)
        if not (out.get("text") or "").strip() or "refused" in (out.get("risk") or []):
            raise Refusal(422, "refused", "I can't write that message. Want to say it differently?")
        text, checks, back, back_provider = _check_and_translate(transcript, out, row["speech_lang"], row["target_lang"], timings)
        with _approve_lock:  # the composer ran unlocked; the write happens only if nothing moved meanwhile
            c = db.conn()
            n = c.execute("UPDATE drafts SET version=version+1, tone=?, text_enc=?, back_enc=?, checks=?, changes=?, "
                          "text_hash=?, lock_hash=NULL, nonce_hash=NULL, nonce_expires=NULL, updated_at=? "
                          "WHERE id=? AND device_id=? AND version=? AND state='draft'",
                          (tone, _seal(text), _seal(back), _seal(json.dumps(checks)),
                           _seal(json.dumps({"changes_made": out.get("changes_made") or [], "missing": out.get("missing") or []})),
                           text_hash(dev["person_id"], text), _iso(_now()), draft_id, dev["id"], row["version"])).rowcount
            c.commit()
            if n != 1:  # approved, cancelled or revised by another tap while the composer ran
                raise _stale()
        _audit(dev, "bridge.revised", {"draft_id": draft_id, "version": row["version"] + 1, "tone": tone,
                                       "edited": bool(body.text and body.text.strip()),
                                       "text_hmac": text_hmac(dev["person_id"], text), "needs_tap": checks["needs_tap"],
                                       "providers": {k: v for k, v in {"compose": out.get("provider"),
                                                                       "back_translate": back_provider}.items() if v}})
        timings["total"] = _ms(t0)
        return _card(_row(dev, draft_id), {"timings": timings})

    @app.get("/api/bridge/drafts/{draft_id}/readback")
    def readback(draft_id: str, dev: dict = Depends(bridge_device)):
        """'Say it again': an MP3 of the exact current text (the device token goes in the header, never the URL)."""
        from . import providers
        t0 = time.monotonic()
        row = _row(dev, draft_id)
        _take(dev["person_id"], "readbacks")
        try:
            audio = providers.speak(_open(row["text_enc"]) or "", lang=row["target_lang"], timeout=8.0)["audio"]
        except providers.ProviderError:
            raise Refusal(502, "tts_failed", "I couldn't read it aloud just now. The message on the card is unchanged.") from None
        return Response(audio, media_type="audio/mpeg",
                        headers={"Cache-Control": "no-store", "Server-Timing": f"total;dur={_ms(t0)}"})

    @app.post("/api/bridge/drafts/{draft_id}/approve")
    def approve(draft_id: str, body: ApproveIn, dev: dict = Depends(bridge_device)):
        """The person's tap on 'Send on WhatsApp'. Locks the exact text to this version, recipient and channel and
        returns a single-use nonce (120 s) plus the stored text for the hand-off."""
        t0 = time.monotonic()
        if killed("KAIROS_KILL_SEND"):
            raise Refusal(503, "sending_paused", "Sending is paused on your Mac right now, so nothing was sent.")
        with _approve_lock:
            row = _row(dev, draft_id)
            text = _open(row["text_enc"]) or ""
            checks = _checks(row)
            if (row["state"] != "draft" or body.version != row["version"]
                    or not hmac.compare_digest(body.text_hash.encode(), row["text_hash"].encode())
                    or text_hash(dev["person_id"], text) != row["text_hash"] or body.recipient_ref != row["recipient_ref"]
                    or body.channel != row["channel"]):
                raise _stale()
            if checks.get("blocked"):
                raise Refusal(409, "blocked", "This message has a link, number or address you never said, so it "
                                              "can't be sent. Say it again or edit it.")
            _cap(dev["person_id"], "sends")
            ref_hash = hashlib.sha256(f"{dev['person_id']}|{row['recipient_ref']}".encode()).hexdigest()
            c = db.conn()
            new = c.execute("SELECT 1 FROM bridge_recipients WHERE person_id=? AND ref_hash=?",
                            (dev["person_id"], ref_hash)).fetchone() is None
            if new:
                _cap(dev["person_id"], "new_recipients")
            nonce = "n_" + secrets.token_urlsafe(18)
            n = c.execute("UPDATE drafts SET state='approved', lock_hash=?, nonce_hash=?, nonce_expires=?, updated_at=? "
                          "WHERE id=? AND device_id=? AND version=? AND state='draft'",
                          (_lock(draft_id, row["version"], row["recipient_ref"], row["channel"], text),
                           db.hash_token(nonce), time.time() + NONCE_SECONDS, _iso(_now()), draft_id, dev["id"],
                           row["version"])).rowcount
            if n != 1:
                c.rollback()
                raise _stale()
            if new:
                c.execute("INSERT OR IGNORE INTO bridge_recipients(person_id, ref_hash, first_seen) VALUES (?,?,?)",
                          (dev["person_id"], ref_hash, _iso(_now())))
            c.commit()  # before any other db call: db.conn() rolls back an open transaction
            if new:
                db.usage_add(dev["person_id"], "new_recipients")
            db.usage_add(dev["person_id"], "sends")
        _audit(dev, "bridge.approved", {"draft_id": draft_id, "version": row["version"], "channel": row["channel"],
                                        "recipient_ref": row["recipient_ref"], "method": body.method,
                                        "text_hmac": text_hmac(dev["person_id"], text), "new_recipient": new})
        return {"nonce": nonce, "expires_in": NONCE_SECONDS, "delivery": "handoff", "text": text,
                "channel": row["channel"], "recipient_ref": row["recipient_ref"], "timings": {"total": _ms(t0)}}

    @app.post("/api/bridge/drafts/{draft_id}/outcome")
    def outcome(draft_id: str, body: OutcomeIn, dev: dict = Depends(bridge_device)):
        """After the hand-off: the app reports handed_off (wa.me can't say 'sent'), cancelled or failed. The nonce
        is single-use and must still be live, and the locked text must be unchanged."""
        t0 = time.monotonic()
        with _approve_lock:
            row = _row(dev, draft_id)
            text = _open(row["text_enc"]) or ""
            nonce_hash = db.hash_token(body.nonce)
            ok = (row["state"] == "approved" and row["nonce_hash"] and hmac.compare_digest(row["nonce_hash"], nonce_hash)
                  and (row["nonce_expires"] or 0) >= time.time()
                  and row["lock_hash"] == _lock(draft_id, row["version"], row["recipient_ref"], row["channel"], text))
            if not ok:
                raise Refusal(409, "nonce_used_expired_or_mismatch",
                              "That send was already recorded or has expired.")
            state = {"handed_off": "handed_off", "cancelled": "cancelled", "failed": "failed"}[body.outcome]
            c = db.conn()
            n = c.execute("UPDATE drafts SET state=?, nonce_hash=NULL, nonce_expires=NULL, updated_at=? "
                          "WHERE id=? AND device_id=? AND state='approved' AND nonce_hash=?",
                          (state, _iso(_now()), draft_id, dev["id"], nonce_hash)).rowcount
            c.commit()
            if n != 1:
                raise Refusal(409, "nonce_used_expired_or_mismatch", "That send was already recorded or has expired.")
        _audit(dev, f"bridge.{state}", {"draft_id": draft_id, "version": row["version"], "channel": row["channel"],
                                        "recipient_ref": row["recipient_ref"]})
        if state == "cancelled":
            purge()
        return {"state": state, "timings": {"total": _ms(t0)}}

    @app.post("/api/bridge/drafts/{draft_id}/cancel")
    def cancel(draft_id: str, dev: dict = Depends(bridge_device)):
        t0 = time.monotonic()
        with _approve_lock:
            row = _row(dev, draft_id)
            c = db.conn()
            c.execute("DELETE FROM drafts WHERE id=? AND device_id=?", (row["id"], dev["id"]))
            c.commit()
        db._checkpoint(c)
        _audit(dev, "bridge.cancelled", {"draft_id": draft_id, "version": row["version"]})
        return {"state": "cancelled", "timings": {"total": _ms(t0)}}

    @app.get("/api/consents")
    def get_consents(dev: dict = Depends(app_device)):
        """What the person chose, per category and provider. Recorded only, for now: whether private data may go
        to a hosted model is still decided by TEMPO_LLM_ALLOW_VAULT and the model's address (fails closed)."""
        ensure_tables()
        rows = db.conn().execute("SELECT category, provider, granted, updated_at FROM consents WHERE person_id=?",
                                 (dev["person_id"],)).fetchall()
        return {"consents": [dict(r) | {"granted": bool(r["granted"])} for r in rows]}

    @app.put("/api/consents")
    def put_consent(body: ConsentIn, dev: dict = Depends(app_device)):
        """Per-category, per-provider consent (UK GDPR Art 9 for health/location/notifications). Recorded only;
        see get_consents."""
        ensure_tables()
        c = db.conn()
        c.execute("INSERT INTO consents(person_id, category, provider, granted, updated_at) VALUES (?,?,?,?,?) "
                  "ON CONFLICT(person_id, category, provider) DO UPDATE SET granted=excluded.granted, updated_at=excluded.updated_at",
                  (dev["person_id"], body.category, body.provider, int(body.granted), _iso(_now())))
        c.commit()
        _audit(dev, "bridge.consent", {"category": body.category, "provider": body.provider, "granted": body.granted})
        return {"category": body.category, "provider": body.provider, "granted": body.granted}


_approve_lock = threading.Lock()
