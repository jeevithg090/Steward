"""SQLite storage for the Tempo hub: people, devices and one append-only event log.

Every stored event gets a hub-assigned, ever-increasing `hub_seq`, so any client can
ask "give me everything after #N" (the CloudKit change-token idea). Event field names
follow envelope v1 in research/Tempo-Sync-Methods.md §6.3 (signatures come later).

Rules applied to every insert (insert_events):
  * kind is lower-cased; class is derived from the kind (raw personal signals are 'vault', a client
    may raise mission to vault but never lower it);
  * trust: only health./location./node./desktop./device. kinds keep device/integration trust, all
    other device/app text is 'untrusted-external' (data, never instructions);
  * 'simulated' is a payload flag (payload._simulated) plus a ':simulated' source suffix, never a trust level;
  * NaN/Infinity become null; client ids are namespaced by device; forgotten records stay forgotten.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import secrets
import sqlite3
import threading
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

from .adapters import (event_time_fields, fold_name, home_tz, is_repeated_hour, local_label,  # noqa: F401
                       offset_str, zone)

DB_PATH = Path(os.environ.get("TEMPO_DB", Path(__file__).resolve().parent.parent / "data" / "tempo.db"))

_local = threading.local()

SCHEMA = """
CREATE TABLE IF NOT EXISTS persons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  join_token TEXT UNIQUE NOT NULL,
  ingest_key TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES persons(id),
  name TEXT NOT NULL,
  platform TEXT,
  kind TEXT,
  capabilities TEXT DEFAULT '[]',
  token TEXT UNIQUE NOT NULL,
  joined_via TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  last_seq INTEGER DEFAULT 0,
  removed INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS events (
  hub_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT UNIQUE NOT NULL,
  person_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  seq INTEGER,
  hlc TEXT,
  kind TEXT NOT NULL,
  event_time_utc TEXT NOT NULL,
  event_offset TEXT,
  event_tz TEXT,
  recorded_at TEXT NOT NULL,
  class TEXT DEFAULT 'vault',
  trust_level TEXT DEFAULT 'device',
  source TEXT,
  payload TEXT NOT NULL,
  text TEXT,
  event_fold TEXT,
  alg TEXT,
  sig TEXT,
  deps TEXT,
  base TEXT
);
CREATE INDEX IF NOT EXISTS ev_person_time ON events(person_id, event_time_utc);
CREATE INDEX IF NOT EXISTS ev_kind ON events(person_id, kind);
CREATE INDEX IF NOT EXISTS ev_kind_time ON events(person_id, kind, event_time_utc);
CREATE INDEX IF NOT EXISTS ev_device ON events(device_id);
-- Forget is durable: a forgotten record (by id) or selector (kind prefix / device, up to before_utc)
-- is dropped when it is sent again. Ids are stored hashed, so a tombstone never keeps what was forgotten.
CREATE TABLE IF NOT EXISTS tombstones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id TEXT NOT NULL,
  event_id_hash TEXT,
  kind_prefix TEXT,
  device_id TEXT,
  before_utc TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tomb_event ON tombstones(person_id, event_id_hash);
-- Kairos voice sessions: a 15-minute handle the voice agent sends back as X-Kairos-Session, so the hub knows
-- whose call it is from the session, never from what a model says. Stored hashed, like device tokens.
CREATE TABLE IF NOT EXISTS kairos_sessions (
  hash TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
-- Per-person daily counters for spend and abuse caps (voice minutes, drafts, sends, new recipients).
CREATE TABLE IF NOT EXISTS usage (
  person_id TEXT NOT NULL,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (person_id, day, kind)
);
"""

FTS = """
CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(text, content='events', content_rowid='hub_seq');
CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
  INSERT INTO events_fts(rowid, text) VALUES (new.hub_seq, coalesce(new.text, ''));
END;
CREATE TRIGGER IF NOT EXISTS events_ad AFTER DELETE ON events BEGIN
  INSERT INTO events_fts(events_fts, rowid, text) VALUES ('delete', old.hub_seq, coalesce(old.text, ''));
END;
"""


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def conn() -> sqlite3.Connection:
    """This thread's connection. A transaction left open by a failed request is rolled back here, so
    one bad write can never hold the write lock for everyone. Use one handle per write
    (c = conn(); c.execute(...); c.commit()) and don't call other db functions before committing."""
    c = getattr(_local, "conn", None)
    if c is None or getattr(_local, "path", None) != str(DB_PATH):
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        c = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA foreign_keys=ON")
        c.execute("PRAGMA secure_delete=ON")  # deleted rows are overwritten on disk, not just unlinked
        _local.conn, _local.path = c, str(DB_PATH)
    if c.in_transaction:
        c.rollback()
    return c


# Envelope v1 fields kept now (nullable, unchecked) so adding signatures later needs no migration.
# client_id keeps the id a device chose; the stored id is namespaced by device.
ENVELOPE_COLUMNS = ("event_fold", "alg", "sig", "deps", "base", "consent_scope", "v", "body_raw", "client_id")
UNTRUSTED_KINDS = ("notification.", "sms.", "email.", "message.")  # kept for old imports; see TRUSTED_KIND_PREFIXES

# Kinds that only the hub (or an agent through MCP) writes. The API rejects them from devices and ingest
# (is_reserved_kind), so a device can't forge a consent, an approval, a forget receipt, a device event, or
# an agent's suggestion ("Claim £999?") that would show up in the person's approvals.
RESERVED_PREFIXES = ("device.", "forget.", "approval.", "hub.", "consent.", "mission.", "agent.", "hands.", "guardian.", "bridge.")
# Device/app events keep their trust only for these kinds; everything else is untrusted-external.
TRUSTED_KIND_PREFIXES = ("health.", "location.", "node.", "desktop.", "device.")
# Trust levels set by the hub itself, never by what a device sends.
HUB_TRUST = ("hub", "agent", "gateway-attested")
# Raw personal signals: class 'vault' whatever the client says (a superset of memory.MESSAGE_ROOTS).
VAULT_ROOTS = ("health", "location", "desktop", "notification", "notifications", "sms", "email", "message",
               "messages", "whatsapp", "signalapp", "chat", "telegram", "imessage", "call", "node", "generic")
# The only roots that may be class 'mission' (shareable with agents and remote models). Every other kind,
# including ones nobody has thought of yet, fails closed to vault. 'signal' is the spec's L1 signal.*
# (signal.rail_delay), not the Signal messenger, whose kinds are signalapp.* / signal.message*.
MISSION_ROOTS = ("signal", "mission", "agent", "approval", "hub", "device", "forget", "consent")


def _root(kind: str) -> str:
    return kind.split(".", 1)[0]


def _sql_in(values: Iterable[str]) -> str:
    return ",".join("'" + v.replace("'", "''") + "'" for v in values)


_ROOT_SQL = "(CASE WHEN instr(kind, '.') > 0 THEN substr(kind, 1, instr(kind, '.') - 1) ELSE kind END)"


def init(db_path: str | os.PathLike | None = None) -> None:
    global DB_PATH
    if db_path is not None:
        DB_PATH = Path(db_path)
        _local.__dict__.clear()
    c = conn()
    c.executescript(SCHEMA)
    have = {r["name"] for r in c.execute("PRAGMA table_info(events)")}
    for col in ENVELOPE_COLUMNS:
        if col not in have:
            c.execute(f"ALTER TABLE events ADD COLUMN {col} TEXT")
    c.execute("CREATE INDEX IF NOT EXISTS ev_client ON events(person_id, client_id)")
    if "seq_gaps" not in {r["name"] for r in c.execute("PRAGMA table_info(devices)")}:
        c.execute("ALTER TABLE devices ADD COLUMN seq_gaps INTEGER DEFAULT 0")
    c.commit()
    try:
        c.executescript(FTS)
    except sqlite3.OperationalError:
        pass  # SQLite built without FTS5: search falls back to LIKE
    try:  # FTS5 drops deleted entries from its index at once (SQLite 3.44+)
        c.execute("INSERT INTO events_fts(events_fts, rank) VALUES('secure-delete', 1)")
    except sqlite3.OperationalError:
        pass
    c.commit()
    try:
        hashed = _backfill(c)
        c.commit()
        if hashed:  # the UPDATE went to the WAL: copy it over the old pages now and drop the old frames
            for _ in range(10):
                if not c.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()[0]:
                    break
                import time as _t
                _t.sleep(0.2)  # another process (e.g. the MCP server) is reading: try again shortly
            else:
                print("[tempo] couldn't checkpoint after hashing device tokens; stop other hub processes and "
                      "restart, so the old plaintext pages in data/tempo.db are overwritten")
    except sqlite3.Error as exc:  # never stop the hub from starting; new inserts follow the rules anyway
        c.rollback()
        print(f"[tempo] backfill of old rows skipped: {exc}")


def _backfill(c: sqlite3.Connection) -> int:
    """Bring rows written by older code up to today's rules. Idempotent and cheap when nothing changes.
    Returns how many plaintext device tokens it hashed (init then checkpoints, so none stay on disk)."""
    hashed = hash_stored_tokens(c)
    # signal.* is shareable only when the hub or an agent wrote it (a device's 'signal.notification' is the
    # Signal messenger, or a forgery); and rail signals are now one per train per day (keyed 'railday:'),
    # so the older one-per-notification ones go (memory.derive_signals re-derives them at startup).
    c.execute(f"UPDATE events SET class='vault' WHERE coalesce(class, '') <> 'vault' AND {_ROOT_SQL}='signal' "
              f"AND trust_level NOT IN ({_sql_in(HUB_TRUST)})")
    c.execute("DELETE FROM events WHERE kind='signal.rail_delay' AND client_id LIKE 'rail:%'")
    c.execute("UPDATE events SET kind=lower(trim(kind)) WHERE kind <> lower(trim(kind))")
    # NaN / Infinity stored by older code broke every /api/events page that contained them.
    for r in c.execute("SELECT hub_seq, payload FROM events "
                       "WHERE instr(payload, 'NaN') > 0 OR instr(payload, 'Infinity') > 0").fetchall():
        fixed = _dumps(_loads(r["payload"]))
        if fixed != r["payload"]:
            c.execute("UPDATE events SET payload=? WHERE hub_seq=?", (fixed, r["hub_seq"]))
    # 'simulated' used to be a trust level; it is now a payload flag and a source suffix.
    for r in c.execute("SELECT hub_seq, payload, source FROM events WHERE trust_level='simulated'").fetchall():
        p = _loads(r["payload"])
        p["_simulated"] = True
        c.execute("UPDATE events SET trust_level='integration', payload=?, source=? WHERE hub_seq=?",
                  (_dumps(p), _simulated_source(r["source"]), r["hub_seq"]))
    trusted = " OR ".join(f"kind LIKE '{p}%'" for p in TRUSTED_KIND_PREFIXES)
    c.execute(f"UPDATE events SET trust_level='untrusted-external' "
              f"WHERE trust_level IN ('device', 'integration') AND NOT ({trusted})")
    c.execute("UPDATE events SET trust_level='untrusted-external' "
              "WHERE trust_level IN ('device', 'integration') AND kind LIKE 'desktop.%' AND "
              "coalesce(CASE WHEN json_valid(payload) THEN json_extract(payload, '$.title') END, '') <> ''")
    c.execute(f"UPDATE events SET class='vault' WHERE coalesce(class, '') <> 'vault' "
              f"AND ({_ROOT_SQL} NOT IN ({_sql_in(MISSION_ROOTS)}) OR kind LIKE 'signal.message%')")
    # Client/adapter ids used to be global; namespace them by device (content-hash ids e_... already are).
    c.execute("UPDATE OR IGNORE events SET client_id=id, id=device_id || ':' || id "
              "WHERE client_id IS NULL AND substr(id, 1, 2) <> 'e_' "
              "AND substr(id, 1, length(device_id) + 1) <> device_id || ':'")
    return hashed


def has_fts() -> bool:
    row = conn().execute("SELECT name FROM sqlite_master WHERE name='events_fts'").fetchone()
    return row is not None


def _token(n: int = 18) -> str:
    return secrets.token_urlsafe(n)


def backup_to(path: str | os.PathLike | None = None) -> Path:
    """Copy the whole database (SQLite online backup) to `path`, default data/backup-<UTC time>.db next
    to the live DB, readable only by this user. Call it before a delete-all so a mistake can be undone."""
    dest_path = Path(path) if path else DB_PATH.parent / f"backup-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.db"
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    dest = sqlite3.connect(str(dest_path))
    try:
        conn().backup(dest)
    finally:
        dest.close()
    os.chmod(dest_path, 0o600)
    return dest_path


# ---------- people ----------

def owner() -> sqlite3.Row:
    """The household owner. The prototype has one person; more people come later."""
    c = conn()
    row = c.execute("SELECT * FROM persons ORDER BY created_at LIMIT 1").fetchone()
    if row:
        return row
    pid = "p_" + _token(6)
    c.execute(
        "INSERT INTO persons(id, name, join_token, ingest_key, created_at) VALUES (?,?,?,?,?)",
        (pid, os.environ.get("TEMPO_OWNER_NAME", "Me"), _token(), _token(), now_utc()),
    )
    c.commit()
    return c.execute("SELECT * FROM persons WHERE id=?", (pid,)).fetchone()


def rotate_keys(person_id: str, join_token: bool = True, ingest_key: bool = True) -> sqlite3.Row | None:
    """New personal-link token and/or ingest key (old links and app URLs stop working)."""
    c = conn()
    for col, on in (("join_token", join_token), ("ingest_key", ingest_key)):
        if on:
            c.execute(f"UPDATE persons SET {col}=? WHERE id=?", (_token(), person_id))
    c.commit()
    return c.execute("SELECT * FROM persons WHERE id=?", (person_id,)).fetchone()


def person_by_join_token(token: str) -> sqlite3.Row | None:
    return conn().execute("SELECT * FROM persons WHERE join_token=?", (token,)).fetchone()


def person_by_ingest_key(key: str) -> sqlite3.Row | None:
    return conn().execute("SELECT * FROM persons WHERE ingest_key=?", (key,)).fetchone()


# ---------- devices ----------

TOKEN_HASH = "sha256:"


def hash_token(token: str) -> str:
    """Device tokens are stored only as this hash, so the database, its backups and a copied data/ folder
    never hold a usable token. The token itself exists once: in add_device's return value."""
    return TOKEN_HASH + hashlib.sha256(str(token).encode()).hexdigest()


def add_device(person_id: str, name: str, platform: str | None, kind: str | None,
               capabilities: Iterable[str] = (), joined_via: str = "link",
               user_agent: str | None = None) -> dict:
    """The new device as a dict; its 'token' is the real token (only the hash is stored), so hand it over now."""
    c = conn()
    did = "d_" + _token(6)
    token = _token(24)
    c.execute(
        "INSERT INTO devices(id, person_id, name, platform, kind, capabilities, token, joined_via,"
        " user_agent, created_at, last_seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (did, person_id, clean_str(name[:80]), platform and clean_str(platform), kind and clean_str(kind),
         json.dumps(list(capabilities)), hash_token(token), joined_via, clean_str((user_agent or "")[:300]), now_utc(), now_utc()),
    )
    c.commit()
    return {**dict(c.execute("SELECT * FROM devices WHERE id=?", (did,)).fetchone()), "token": token}


def integration_device(person_id: str, source: str, name: str) -> sqlite3.Row | None:
    """Apps that push to us (Health Connect webhook, Health Auto Export, OwnTracks...) each appear as
    one device, created automatically on their first delivery.

    Returns None when the person removed this app: removal sticks, so the API must not store anything
    and should answer 403 ("This app was removed from Tempo; re-add it there to connect it again").
    restore_integration() is the re-add."""
    rows = conn().execute(
        "SELECT * FROM devices WHERE person_id=? AND kind='integration' AND platform=? "
        "ORDER BY removed, created_at DESC", (person_id, source),
    ).fetchall()
    if rows and not rows[0]["removed"]:
        return rows[0]
    if rows:
        return None
    return add_device(person_id, name, source, "integration", joined_via="integration")


def restore_integration(person_id: str, source: str) -> sqlite3.Row | None:
    """Re-add a removed app (its latest device row), so its next delivery is accepted again."""
    c = conn()
    row = c.execute("SELECT id FROM devices WHERE person_id=? AND kind='integration' AND platform=? "
                    "ORDER BY removed, created_at DESC LIMIT 1", (person_id, source)).fetchone()
    if not row:
        return None
    c.execute("UPDATE devices SET removed=0 WHERE id=?", (row["id"],))
    c.commit()
    return c.execute("SELECT * FROM devices WHERE id=?", (row["id"],)).fetchone()


def device_by_token(token: str) -> sqlite3.Row | None:
    return conn().execute("SELECT * FROM devices WHERE token=? AND removed=0", (hash_token(token),)).fetchone()


def token_was_removed(token: str) -> bool:
    return conn().execute("SELECT 1 FROM devices WHERE token=? AND removed=1 LIMIT 1",
                          (hash_token(token),)).fetchone() is not None


SESSION_SECONDS = 15 * 60


def new_kairos_session(person_id: str, device_id: str, seconds: int = SESSION_SECONDS) -> tuple[str, str]:
    """(session, expires_at): a fresh voice-call session handle; only its hash is stored."""
    session = "ks_" + _token(24)
    now = datetime.now(timezone.utc)
    expires = (now + timedelta(seconds=seconds)).isoformat(timespec="seconds").replace("+00:00", "Z")
    c = conn()
    c.execute("DELETE FROM kairos_sessions WHERE expires_at < ?", (now_utc(),))
    c.execute("INSERT INTO kairos_sessions(hash, person_id, device_id, created_at, expires_at) VALUES (?,?,?,?,?)",
              (hash_token(session), person_id, device_id, now_utc(), expires))
    c.commit()
    return session, expires


def kairos_session(session: str) -> sqlite3.Row | None:
    """The live session row for a handle, or None (unknown or expired)."""
    return conn().execute("SELECT * FROM kairos_sessions WHERE hash=? AND expires_at >= ?",
                          (hash_token(session), now_utc())).fetchone()


def usage_add(person_id: str, kind: str, n: int = 1, day: str | None = None) -> int:
    """Add n to today's (UTC) counter for kind, or to `day`'s (a refund goes back to the day it was charged), and
    return the new total. Never below 0."""
    day = day or now_utc()[:10]
    c = conn()
    if n < 0:  # a refund: only ever lowers an existing count, and never below 0
        c.execute("UPDATE usage SET n = max(0, n + ?) WHERE person_id=? AND day=? AND kind=?", (n, person_id, day, kind))
    else:
        c.execute("INSERT INTO usage(person_id, day, kind, n) VALUES (?,?,?,?) "
                  "ON CONFLICT(person_id, day, kind) DO UPDATE SET n = n + excluded.n", (person_id, day, kind, n))
    c.commit()
    row = c.execute("SELECT n FROM usage WHERE person_id=? AND day=? AND kind=?", (person_id, day, kind)).fetchone()
    return int(row[0]) if row else 0


_usage_lock = threading.Lock()


def usage_take(person_id: str, kind: str, cap: int, n: int = 1) -> str | None:
    """Count n more of kind today if that stays within cap and return the day charged (for a refund); None (nothing
    counted) if it wouldn't. Check and add happen under one lock, so a burst of parallel requests can't all pass a
    cap they jointly exceed."""
    with _usage_lock:
        day = now_utc()[:10]
        row = conn().execute("SELECT n FROM usage WHERE person_id=? AND day=? AND kind=?", (person_id, day, kind)).fetchone()
        if (int(row[0]) if row else 0) + n > cap:
            return None
        usage_add(person_id, kind, n, day)
        return day


def usage_today(person_id: str, kind: str) -> int:
    row = conn().execute("SELECT n FROM usage WHERE person_id=? AND day=? AND kind=?",
                         (person_id, now_utc()[:10], kind)).fetchone()
    return int(row[0]) if row else 0


def hash_stored_tokens(c: sqlite3.Connection) -> int:
    """Replace any plaintext device tokens (older databases, backups) by their hash. Existing devices keep
    working: the token they present hashes to the same value. Idempotent."""
    rows = c.execute(f"SELECT id, token FROM devices WHERE token NOT LIKE '{TOKEN_HASH}%'").fetchall()
    c.executemany("UPDATE devices SET token=? WHERE id=?", [(hash_token(r["token"]), r["id"]) for r in rows])
    return len(rows)


def touch_device(device_id: str) -> None:
    c = conn()
    c.execute("UPDATE devices SET last_seen_at=? WHERE id=?", (now_utc(), device_id))
    c.commit()


def list_devices(person_id: str) -> list[dict]:
    rows = conn().execute(
        "SELECT d.*, (SELECT count(*) FROM events e WHERE e.device_id=d.id) AS event_count "
        "FROM devices d WHERE person_id=? AND removed=0 ORDER BY created_at", (person_id,)
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d.pop("token", None)
        d["capabilities"] = json.loads(d.get("capabilities") or "[]")
        out.append(d)
    return out


def remove_device(person_id: str, device_id: str) -> bool:
    c = conn()
    cur = c.execute("UPDATE devices SET removed=1 WHERE id=? AND person_id=?", (device_id, person_id))
    c.commit()
    return cur.rowcount > 0


# ---------- event normalisation ----------

def norm_kind(kind: Any) -> str:
    """'Notification.Signal ' -> 'notification.signal'; empty -> 'unknown'."""
    return (str(kind).strip().lower()[:80] if kind is not None else "") or "unknown"


def is_reserved_kind(kind: Any) -> bool:
    """True for hub-only kinds (device.*, forget.*, approval.*, hub.*), which clients may not send."""
    return _root(norm_kind(kind)) + "." in RESERVED_PREFIXES


def derive_class(kind: str, requested: Any = None, trust: str | None = None) -> str:
    """'vault' unless the kind's root is in MISSION_ROOTS; then the client's class, where 'mission' (or
    nothing) means mission and any other value fails closed to vault. signal.* counts as mission only when
    the hub or an agent wrote it (trust in HUB_TRUST): from a device or app it is the Signal messenger or a
    forged L1 signal, and stays private."""
    root = _root(kind)
    if root not in MISSION_ROOTS or str(kind).startswith("signal.message"):
        return "vault"
    if root == "signal" and trust is not None and trust not in HUB_TRUST:
        return "vault"
    r = str(requested or "").strip().lower()
    return "mission" if r in ("", "mission") else "vault"


def derive_trust(kind: str, trust: str, payload: dict) -> str:
    """Hub/agent trust stays. Device/app events keep their trust only for allow-listed kinds;
    anything else (notifications, messages, unknown kinds, window titles) is untrusted-external."""
    if trust in HUB_TRUST or trust == "untrusted-external":
        return trust
    if trust not in ("device", "integration") or not kind.startswith(TRUSTED_KIND_PREFIXES):
        return "untrusted-external"
    if kind.startswith("desktop.") and payload.get("title"):
        return "untrusted-external"  # window / tab titles are written by third parties
    return trust


def clean_str(s: str) -> str:
    """Valid UTF-8 text: a lone UTF-16 surrogate ('\\ud83d') can't be encoded and used to freeze sync with a 500."""
    try:
        s.encode("utf-8")
        return s
    except UnicodeEncodeError:
        return s.encode("utf-8", "replace").decode("utf-8")


def _finite(obj: Any, depth: int = 0) -> Any:
    """A JSON-safe copy: NaN/Infinity become None, keys become strings, very deep nesting becomes text."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, str):
        return clean_str(obj)
    if depth > 40:
        return clean_str(str(obj)[:1000])
    if isinstance(obj, dict):
        return {clean_str(k if isinstance(k, str) else str(k)): _finite(v, depth + 1) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_finite(v, depth + 1) for v in obj]
    return obj


def _dumps(obj: Any) -> str:
    try:
        return json.dumps(_finite(obj), default=str, allow_nan=False)
    except (TypeError, ValueError, RecursionError):
        return json.dumps({"_unreadable": str(obj)[:2000]})


def _loads(s: Any) -> Any:
    try:
        return _finite(json.loads(s)) if s else {}
    except (TypeError, ValueError, RecursionError):
        return {"_raw": str(s)[:2000]}


def _as_payload(p: Any) -> dict:
    p = _finite(p)
    return p if isinstance(p, dict) else ({} if p is None else {"value": p})


def _simulated_source(source: str | None) -> str:
    source = source or "unknown"
    return source if source.endswith(":simulated") else f"{source}:simulated"


def _str(v: Any, n: int = 500) -> str | None:
    if v is None:
        return None
    return (v if isinstance(v, str) else _dumps(v))[:n]


def _norm_time(ev: dict, device_trust: bool) -> tuple[str, str | None, str | None, str | None]:
    """(event_time_utc, event_offset, event_tz, event_fold). With a valid event_tz the offset always comes
    from that zone at that instant; otherwise the sender's offset, else TEMPO_HOME_TZ's for devices."""
    tz = ev.get("event_tz") or ev.get("tz")
    fold = fold_name(ev.get("fold") or ev.get("event_fold"))
    if ev.get("event_time_utc"):
        utc, off = str(ev["event_time_utc"]), offset_str(ev.get("event_offset"))
    elif ev.get("event_time") is not None:
        t = event_time_fields(ev["event_time"], tz, fold)
        utc, off, tz, fold = t["event_time_utc"], t["event_offset"], t["event_tz"] or tz, t["fold"]
    else:
        utc, off = now_utc(), offset_str(ev.get("event_offset"))
    z = zone(tz)
    tz = tz.strip() if z else None
    zz = z or (zone(home_tz()) if device_trust and off is None else None)
    if zz is not None:
        try:
            local = datetime.fromisoformat(utc.replace("Z", "+00:00")).astimezone(zz)
            # A known zone decides the offset at that instant: a sender saying Europe/London +00:00 in
            # October (BST, +01:00) is wrong, and the UTC instant already says which pass of a repeated hour.
            off = offset_str(local.utcoffset()) if z is not None else (off or offset_str(local.utcoffset()))
            if fold is None and is_repeated_hour(local):
                fold = "later" if local.fold else "earlier"
        except (ValueError, OverflowError, TypeError):
            pass
    return utc, off, tz, fold


def _normalise(ev: Any, device_id: str, source: str | None, trust_level: str, simulated: bool) -> dict:
    if not isinstance(ev, dict):
        raise ValueError("each event must be a JSON object")
    kind = norm_kind(ev.get("kind"))
    payload = _as_payload(ev.get("payload"))
    trust = trust_level
    if ev.get("trust_level") == "untrusted-external" or (ev.get("trust_level") and trust_level in HUB_TRUST):
        trust = str(ev["trust_level"])
    src = ev.get("source") or source
    if simulated:
        payload["_simulated"] = True
        src = _simulated_source(src)
    utc, off, tz, fold = _norm_time(ev, trust_level == "device")
    cid = ev.get("id")
    cid = str(cid)[:200] if cid not in (None, "") else None
    if cid and cid.startswith(device_id + ":"):
        cid = cid[len(device_id) + 1:]
    base = {"kind": kind, "event_time_utc": utc, "payload": payload}
    seq = ev.get("seq")
    body_raw = ev.get("body_raw") if ev.get("body_raw") is not None else (ev["body"] if isinstance(ev.get("body"), str) else None)
    return {
        "id": f"{device_id}:{cid}" if cid else _event_id(device_id, base),
        "client_id": cid, "kind": kind, "payload": payload, "payload_json": _dumps(payload),
        "event_time_utc": utc, "event_offset": off, "event_tz": tz, "event_fold": fold,
        "seq": seq if isinstance(seq, int) and not isinstance(seq, bool) and 0 <= seq <= MAX_SEQ else None,
        "hlc": _str(ev.get("hlc"), 100), "class": derive_class(kind, ev.get("class"), derive_trust(kind, trust, payload)),
        "trust_level": derive_trust(kind, trust, payload), "source": _str(src, 100),
        "text": _str(ev.get("text"), 2000) or describe({"kind": kind, "payload": payload}),
        "alg": _str(ev.get("alg"), 40), "sig": _str(ev.get("sig"), 2000),
        "deps": _dumps(ev["deps"]) if ev.get("deps") is not None else None, "base": _str(ev.get("base"), 200),
        "consent_scope": _str(ev.get("consent_scope"), 500), "v": _str(ev.get("v"), 20),
        "body_raw": _str(body_raw, 65536), "upsert": bool(ev.get("upsert")),
    }


def _event_id(device_id: str, ev: dict) -> str:
    basis = json.dumps([device_id, ev.get("kind"), ev.get("event_time_utc"), ev.get("payload")],
                       sort_keys=True, default=str)
    return "e_" + hashlib.sha256(basis.encode()).hexdigest()[:24]


# ---------- tombstones (durable forget) ----------

def _id_hash(person_id: str, eid: str) -> str:
    return hashlib.sha256(f"{person_id}:{eid}".encode()).hexdigest()[:32]


def _tomb_rules(c: sqlite3.Connection, person_id: str) -> list[sqlite3.Row]:
    return c.execute("SELECT kind_prefix, device_id, before_utc FROM tombstones "
                     "WHERE person_id=? AND event_id_hash IS NULL", (person_id,)).fetchall()


def _is_forgotten(c: sqlite3.Connection, person_id: str, device_id: str, ev: dict, rules: list) -> bool:
    if ev["trust_level"] == "hub":
        return False  # the hub's own records (device.joined, forget receipts) are never blocked
    for r in rules:
        if ((r["device_id"] is None or r["device_id"] == device_id)
                and (r["kind_prefix"] is None or ev["kind"].startswith(r["kind_prefix"]))
                and (r["before_utc"] is None or ev["event_time_utc"] <= r["before_utc"])):
            return True
    return c.execute("SELECT 1 FROM tombstones WHERE person_id=? AND event_id_hash=? LIMIT 1",
                     (person_id, _id_hash(person_id, ev["id"]))).fetchone() is not None


def _tombstone_ids(c: sqlite3.Connection, person_id: str, ids: Iterable[str], reason: str) -> None:
    c.executemany("INSERT INTO tombstones(person_id, event_id_hash, reason, created_at) VALUES (?,?,?,?)",
                  [(person_id, _id_hash(person_id, i), reason, now_utc()) for i in ids])


def _cascade(c: sqlite3.Connection, person_id: str, ids: list[str], reason: str,
             derived: list[str] | None) -> int:
    """Delete and tombstone events derived from deleted ones (payload.from_event), e.g. a mission.suggested
    built from a forgotten rail notification, which would otherwise keep answering for it. Follows chains.
    Appends their '#hub_seq' refs to `derived` so the receipt can name them."""
    n, seen, todo = 0, set(ids), list(ids)
    while todo:
        chunk, todo = todo[:400], todo[400:]
        rows = c.execute(
            "SELECT id, hub_seq FROM events WHERE person_id=? AND CASE WHEN json_valid(payload) THEN "
            f"json_extract(payload, '$.from_event') END IN ({','.join('?' * len(chunk))})", [person_id, *chunk]).fetchall()
        new = [r for r in rows if r["id"] not in seen]
        if not new:
            continue
        seen.update(r["id"] for r in new)
        # A derived signal.* is re-derived from whatever still supports it (memory.derive_signals), so it
        # gets no tombstone; anything else derived (an agent's suggestion) stays forgotten.
        kinds = {r["id"]: r["kind"] for r in c.execute(
            f"SELECT id, kind FROM events WHERE id IN ({','.join('?' * len(new))})", [r["id"] for r in new])}
        _tombstone_ids(c, person_id, [r["id"] for r in new if not str(kinds.get(r["id"], "")).startswith("signal.")], reason)
        for r in new:
            n += c.execute("DELETE FROM events WHERE id=? AND person_id=?", (r["id"], person_id)).rowcount
        if derived is not None:
            derived += [f"#{r['hub_seq']}" for r in new]
        todo += [r["id"] for r in new]
    return n


def _checkpoint(c: sqlite3.Connection) -> None:
    """Push deletions out of the WAL file so forgotten text doesn't linger there."""
    try:
        c.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchall()
    except sqlite3.Error:
        pass


# ---------- events ----------

class Stored(tuple):
    """(accepted, duplicates) from insert_events, plus .forgotten: how many of the duplicates were dropped
    because the person forgot them (so "nothing was stored" can be told apart from a plain retry)."""
    forgotten = 0


def insert_events(person_id: str, device_id: str, events: list[dict], source: str | None = None,
                  trust_level: str = "device", simulated: bool = False) -> Stored:
    """Store events as one transaction (all or nothing). Returns (accepted, duplicates): repeats of an
    id and records the person forgot are both counted as duplicates, so retries are safe and forgotten
    data never comes back. trust_level='simulated' is accepted as the old spelling of simulated=True.
    Raises ValueError for an event that isn't a dict (the API should answer 400)."""
    if trust_level == "simulated":
        trust_level, simulated = "integration", True
    c = conn()
    accepted = dupes = forgotten = 0
    seqs: list[int] = []
    try:
        rules = _tomb_rules(c, person_id)
        for raw in events:
            ev = _normalise(raw, device_id, source, trust_level, simulated)
            eid = ev["id"]
            if _is_forgotten(c, person_id, device_id, ev, rules):
                dupes += 1
                forgotten += 1
                continue
            if ev["upsert"]:
                # Records that change in place (today's step total, an edited Health Connect record):
                # replace the old row so clients see the new value after their hub_seq cursor.
                old = c.execute("SELECT payload FROM events WHERE id=? AND person_id=?", (eid, person_id)).fetchone()
                if old and old["payload"] != ev["payload_json"]:
                    c.execute("DELETE FROM events WHERE id=? AND person_id=?", (eid, person_id))
            cur = c.execute(
                "INSERT OR IGNORE INTO events(id, person_id, device_id, seq, hlc, kind, event_time_utc,"
                " event_offset, event_tz, recorded_at, class, trust_level, source, payload, text,"
                " event_fold, alg, sig, deps, base, consent_scope, v, body_raw, client_id)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (eid, person_id, device_id, ev["seq"], ev["hlc"], ev["kind"], ev["event_time_utc"],
                 ev["event_offset"], ev["event_tz"], now_utc(), ev["class"], ev["trust_level"],
                 ev["source"], ev["payload_json"], ev["text"], ev["event_fold"], ev["alg"], ev["sig"],
                 ev["deps"], ev["base"], ev["consent_scope"], ev["v"], ev["body_raw"], ev["client_id"]),
            )
            if cur.rowcount:
                accepted += 1
            else:
                dupes += 1
            if ev["seq"] is not None:
                seqs.append(ev["seq"])
        if seqs:
            c.execute("UPDATE devices SET last_seq=max(coalesce(last_seq,0), ?), seq_gaps=coalesce(seq_gaps,0)+? "
                      "WHERE id=?", (max(seqs), _seq_gaps(c, device_id, seqs), device_id))
        c.execute("UPDATE devices SET last_seen_at=? WHERE id=?", (now_utc(), device_id))
        c.commit()
    except Exception:
        c.rollback()
        raise
    out = Stored((accepted, dupes))
    out.forgotten = forgotten
    return out


MAX_SEQ = 2 ** 53  # per-device seq numbers beyond this (or negative) are ignored: SQLite stores 64-bit ints only
MAX_SEQ_JUMP = 1_000_000  # a bigger jump is a client that restarted its counter, not a million lost events


def _seq_gaps(c: sqlite3.Connection, device_id: str, seqs: list[int]) -> int:
    """How many seq numbers this batch skips past the device's last_seq (events the device dropped or lost).
    A device's first batch sets the baseline: a re-joined agent keeps counting from its saved seq."""
    row = c.execute("SELECT coalesce(last_seq, 0) AS s FROM devices WHERE id=?", (device_id,)).fetchone()
    prev, gaps = (row["s"] if row else 0), 0
    for s in sorted(set(seqs)):
        if prev and prev + 1 < s <= prev + MAX_SEQ_JUMP:
            gaps += s - prev - 1
        prev = max(prev, s)
    return gaps


RAIL_APPS = (r"\b(GWR|Great Western|Trainline|National Rail|Avanti|LNER|CrossCountry|Chiltern|Northern|"
             r"ScotRail|Southern|Thameslink|Southeastern|South Western|TransPennine|Elizabeth line|TfL|"
             r"Paddington|Euston|King's Cross)\b")


def describe(ev: dict) -> str:
    """A short human/searchable line for an event."""
    p = ev.get("payload")
    p = p if isinstance(p, dict) else ({} if p is None else {"value": p})
    kind = norm_kind(ev.get("kind"))
    if kind.startswith("health."):
        metric = p.get("metric") or kind.split(".", 1)[1]
        val = p.get("value")
        unit = p.get("unit") or ""
        return f"{metric} {val} {unit}".strip()
    if kind == "location.point":
        return f"location {p.get('lat')},{p.get('lon')} battery {p.get('battery')}"
    if kind == "location.transition":
        return f"location {p.get('event') or 'transition'} {p.get('region') or 'a region'}".strip()
    if kind == "desktop.activity":
        return f"using {p.get('app')} {p.get('title') or ''}".strip()
    if kind == "notification.signal":
        line = f"notification from {p.get('app')}: {p.get('title') or ''} {p.get('text') or ''}".strip()[:1500]
        tags = []
        if re.search(RAIL_APPS, f"{p.get('app')} {line}", re.I):
            tags.append("rail train")
        if re.search(r"\b(delay|delayed|cancel|cancelled|late)\b", line, re.I):
            tags.append("delay")
        return line + (f" [{' '.join(tags)}]" if tags else "")
    if kind == "hands.task":
        steps = p.get("steps") if isinstance(p.get("steps"), list) else []
        return (f"Tempo hands on the {p.get('device') or 'device'}: {p.get('task') or ''} -> {p.get('status') or ''}"
                f"{' (confirmed by you)' if p.get('user_confirmed') else ''}; {len(steps)} step(s): {'; '.join(map(str, steps[:10]))}"
                f"{'. Answer: ' + str(p.get('answer')) if p.get('answer') else ''}").strip()[:1500]
    if kind == "message.whatsapp":
        who = "me" if p.get("from_me") else (p.get("sender") or "someone")
        media = p.get("media") if isinstance(p.get("media"), dict) else {}
        extra = f" [{media.get('type') or 'media'}] {p.get('caption') or ''}" if media else ""
        return f"WhatsApp {p.get('chat_type') or ''} chat {p.get('chat') or ''}, {who}: {p.get('text') or ''}{extra}".strip()[:1500]
    if kind == "node.heartbeat":
        return f"heartbeat battery {p.get('battery')} online {p.get('online')}"
    return f"{kind} " + _dumps({k: v for k, v in p.items() if not str(k).startswith("_")})[:200]


def _row_to_event(r: sqlite3.Row) -> dict:
    """A stored row as a dict. Old rows can't break reads: NaN becomes null, a non-object payload {value}."""
    d = dict(r)
    d["payload"] = _as_payload(_loads(d["payload"]))
    if d.get("deps"):  # stored as JSON text; clients get the envelope's list back
        deps = _loads(d["deps"])
        d["deps"] = deps if isinstance(deps, list) else [deps]
    return d


def _limit(limit: Any, cap: int) -> int:
    try:
        return max(1, min(int(limit), cap))
    except (TypeError, ValueError, OverflowError):
        return cap


def _like(pattern: str) -> str:
    """A kind pattern for LIKE ... ESCAPE '\\': '*' and '%' are wildcards, '_' is literal."""
    out = []
    for ch in pattern:
        out.append("%" if ch in "*%" else "\\" + ch if ch in "_\\" else ch)
    return "".join(out)


def events_after(person_id: str, after: int = 0, limit: int = 500) -> list[dict]:
    rows = conn().execute(
        "SELECT * FROM events WHERE person_id=? AND hub_seq>? ORDER BY hub_seq LIMIT ?",
        (person_id, after, _limit(limit, 2000)),
    ).fetchall()
    return [_row_to_event(r) for r in rows]


def timeline(person_id: str, since_utc: str | None = None, kinds: list[str] | None = None,
             limit: int = 200, exclude: Iterable[str] | None = None, until_utc: str | None = None,
             vault: bool = True) -> list[dict]:
    """Newest first. kinds are LIKE patterns ('health.*'); exclude drops kind prefixes (e.g. ['node.',
    'device.'] so heartbeats don't crowd out facts); until_utc caps future-dated events; vault=False leaves
    class-vault events out in SQL, before the LIMIT, so private events never crowd shared ones out."""
    q = "SELECT * FROM events WHERE person_id=?"
    args: list[Any] = [person_id]
    if not vault:
        q += f" AND coalesce(class, '')<>'vault' AND {_ROOT_SQL} NOT IN ({_sql_in(VAULT_ROOTS)})"
    if since_utc:
        q += " AND event_time_utc>=?"
        args.append(since_utc)
    if until_utc:
        q += " AND event_time_utc<=?"
        args.append(until_utc)
    if kinds:
        q += " AND (" + " OR ".join("kind LIKE ?" for _ in kinds) + ")"
        args += [str(k).replace("*", "%") for k in kinds]
    for prefix in exclude or ():
        q += " AND kind NOT LIKE ? ESCAPE '\\'"
        args.append(_like(norm_kind(prefix)) + "%")
    q += " ORDER BY event_time_utc DESC, hub_seq DESC LIMIT ?"
    args.append(_limit(limit, 1000))
    return [_row_to_event(r) for r in conn().execute(q, args).fetchall()]


def latest_by_kind(person_id: str, kinds_like: str | Iterable[str], until_utc: str | None = None) -> list[dict]:
    """The newest event of each matching kind, newest first. kinds_like: exact kinds ('health.sleep'),
    patterns ('health.*' / 'health.%'), or prefixes ending in '.' ('location.'). One indexed lookup per
    kind, so a flood of heartbeats can never push sleep, steps or location out of the profile."""
    c = conn()
    kinds: list[str] = []
    for pat in [kinds_like] if isinstance(kinds_like, str) else list(kinds_like or []):
        pat = str(pat).strip().lower()
        if not pat:
            continue
        if pat.endswith(".") or "*" in pat or "%" in pat:
            like = _like(pat) + ("%" if pat.endswith(".") else "")
            kinds += [r["kind"] for r in c.execute(
                "SELECT DISTINCT kind FROM events WHERE person_id=? AND kind LIKE ? ESCAPE '\\'", (person_id, like))]
        else:
            kinds.append(pat)
    out = []
    for kind in dict.fromkeys(kinds):
        q, args = "SELECT * FROM events WHERE person_id=? AND kind=?", [person_id, kind]
        if until_utc:
            q += " AND event_time_utc<=?"
            args.append(until_utc)
        row = c.execute(q + " ORDER BY event_time_utc DESC, hub_seq DESC LIMIT 1", args).fetchone()
        if row:
            out.append(_row_to_event(row))
    return sorted(out, key=lambda e: (e["event_time_utc"], e["hub_seq"]), reverse=True)


def _number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


_INTERVAL_KEYS = ("end_time", "endTime", "end")


def _is_bucket(ev: dict) -> bool:
    """A count for a stretch of time, which adds up over a day: Health Auto Export's grouped (hourly) values,
    or a Health Connect record with an end time. Anything else is a running total, e.g. a Shortcut's
    'steps so far today' (1000, 3000, 6000), which must never be added up."""
    return ":hae:" in str(ev.get("id")) or any(k in ev["payload"] for k in _INTERVAL_KEYS)


def daily_max(person_id: str, kind: str | Iterable[str], days: int = 1, tz: str | None = None) -> list[dict]:
    """Per local day, newest first, for `days` days up to today: the day's total for `kind` (one kind or a
    list, e.g. ['health.steps', 'health.step_count']) from the source that saw the most. Per source, buckets
    and interval records are summed (each bucket once, its newest value) and running totals give their
    largest value; then the biggest source wins, so Apple Health and Health Connect counting the same walk
    are never added together. Health Auto Export already merges the person's Apple devices, so its source
    is the app, not the device string that varies between exports. Each day: {day, value, unit, kind, ref,
    hub_seq, id, device_id, source, by_source, events_counted}."""
    kinds = [norm_kind(kind)] if isinstance(kind, str) else [norm_kind(k) for k in kind]
    if not kinds:
        return []
    days = _limit(days, 366)
    home = zone(tz) or zone(home_tz()) or timezone.utc
    today = datetime.now(home).date()
    first = today - timedelta(days=days - 1)
    since = (datetime.combine(first, time.min, tzinfo=timezone.utc) - timedelta(days=1)).isoformat().replace("+00:00", "Z")
    rows = conn().execute(
        f"SELECT * FROM events WHERE person_id=? AND kind IN ({','.join('?' for _ in kinds)}) "
        "AND event_time_utc>=? ORDER BY event_time_utc DESC, hub_seq DESC", (person_id, *kinds, since)).fetchall()
    per_day: dict[str, dict] = {}
    for r in rows:  # newest first
        ev = _row_to_event(r)
        v = ev["payload"].get("value")
        if not _number(v):
            continue
        try:
            when = datetime.fromisoformat(ev["event_time_utc"].replace("Z", "+00:00"))
            day = when.astimezone(zone(ev.get("event_tz")) or home).date()
        except (ValueError, TypeError, OverflowError):
            continue
        if not first <= day <= today:
            continue
        d = per_day.setdefault(day.isoformat(), {"buckets": {}, "totals": {}, "newest": {}})
        if ":hae:" in str(ev["id"]):
            src = f"device:{ev['device_id']}"
        else:
            src = str(ev["payload"].get("origin") or ev.get("source") or ev["device_id"])
        if _is_bucket(ev):
            end = next((ev["payload"].get(k) for k in _INTERVAL_KEYS if ev["payload"].get(k)), None)
            d["buckets"].setdefault((src, ev["event_time_utc"], str(end)), v)  # newest value of each bucket
        else:
            d["totals"][src] = max(d["totals"].get(src, v), v)
        d["newest"].setdefault(src, ev)
    out = []
    for key, d in per_day.items():
        sums: dict[str, float] = {}
        counted: dict[str, int] = {}
        for (src, _, _), v in d["buckets"].items():
            sums[src] = sums.get(src, 0) + v
            counted[src] = counted.get(src, 0) + 1
        by_source: dict[str, float] = dict(d["totals"])
        for src, total in sums.items():
            by_source[src] = max(by_source.get(src, 0), total)
        top = max(by_source, key=lambda k: by_source[k])
        ev = d["newest"][top]
        value = by_source[top]
        out.append({"day": key, "value": int(value) if float(value).is_integer() else round(value, 2),
                    "unit": ev["payload"].get("unit"), "kind": ev["kind"], "ref": f"#{ev['hub_seq']}",
                    "hub_seq": ev["hub_seq"], "id": ev["id"], "device_id": ev["device_id"], "source": ev.get("source"),
                    "by_source": by_source, "events_counted": counted.get(top, 1)})
    return sorted(out, key=lambda d: d["day"], reverse=True)


def search(person_id: str, query: str, limit: int = 30, since_utc: str | None = None, until_utc: str | None = None,
           vault: bool | None = None, count: bool = False) -> Any:
    """Full-text search, newest first. The time window and vault=False (leave vault events out) / vault=True
    (only vault events) are applied in SQL before the LIMIT, so they can't crowd real matches out.
    count=True returns how many events match instead."""
    c = conn()
    limit = _limit(limit, 200)
    where, args = "", []
    if since_utc:
        where += " AND e.event_time_utc>=?"
        args.append(since_utc)
    if until_utc:
        where += " AND e.event_time_utc<=?"
        args.append(until_utc)
    if vault is not None:
        root = _ROOT_SQL.replace("kind", "e.kind")
        where += f" AND {'' if vault else 'NOT '}(coalesce(e.class, '')='vault' OR {root} IN ({_sql_in(VAULT_ROOTS)}))"
    what, tail = ("count(*) AS n", "") if count else ("e.*", " ORDER BY e.event_time_utc DESC LIMIT ?")
    if has_fts():
        terms = " OR ".join(f'"{t}"' for t in query.replace('"', " ").split() if t)
        if not terms:
            return 0 if count else []
        rows = c.execute(f"SELECT {what} FROM events_fts f JOIN events e ON e.hub_seq=f.rowid "
                         f"WHERE events_fts MATCH ? AND e.person_id=?{where}{tail}",
                         [terms, person_id, *args, *([] if count else [limit])]).fetchall()
    else:
        rows = c.execute(f"SELECT {what} FROM events e WHERE e.person_id=? AND e.text LIKE ?{where}{tail}",
                         [person_id, f"%{query}%", *args, *([] if count else [limit])]).fetchall()
    return int(rows[0]["n"]) if count else [_row_to_event(r) for r in rows]


def delete_ids(person_id: str, ids: list[str], device_id: str | None = None, reason: str = "deleted",
               derived: list[str] | None = None) -> int:
    """Delete events by stored id, by '#<hub_seq>' ref, or by the id a device/app gave (client_id; only
    that device's when device_id is set, e.g. Health Connect 'deleted' records). Each deleted record gets
    a tombstone so a re-send can't bring it back; events derived from them go too (see _cascade)."""
    c = conn()
    n = 0
    gone: list[str] = []
    try:
        for raw in ids:
            s = str(raw).strip()
            if not s:
                continue
            if re.fullmatch(r"#\d+", s):
                rows = c.execute("SELECT id FROM events WHERE person_id=? AND hub_seq=?", (person_id, int(s[1:]))).fetchall()
            else:
                rows = c.execute(
                    "SELECT id FROM events WHERE person_id=? AND (id=? OR id=? OR (client_id=? AND (? IS NULL OR device_id=?)))",
                    (person_id, s, f"{device_id}:{s}" if device_id else s, s, device_id, device_id)).fetchall()
            found = [r["id"] for r in rows]
            for eid in found:
                n += c.execute("DELETE FROM events WHERE id=? AND person_id=?", (eid, person_id)).rowcount
            gone += found
            if not found and device_id and not s.startswith("#"):
                found = [s if s.startswith(device_id + ":") else f"{device_id}:{s}"]  # deleted before it arrived
            _tombstone_ids(c, person_id, found, reason)
        n += _cascade(c, person_id, gone, reason, derived)
        c.commit()
    except Exception:
        c.rollback()
        raise
    _checkpoint(c)
    return n


def latest_hub_seq() -> int:
    row = conn().execute("SELECT max(hub_seq) AS m FROM events").fetchone()
    return int(row["m"] or 0)


def forget(person_id: str, device_id: str | None = None, kind_prefix: str | None = None,
           everything: bool = False, kinds: Iterable[str] | None = None, derived: list[str] | None = None) -> int:
    """Delete a device's events, exact kinds, a kind prefix, or (everything=True) all events, so they stay gone.
    A kind prefix leaves a rule: anything of that prefix sent again with an event time up to now is dropped.
    The other selectors tombstone the ids they deleted: re-sent copies are dropped, but new records (a fresh
    demo seed, another phone's history, an agent's offline queue) still arrive."""
    kind_prefix = kind_prefix.strip().lower() if kind_prefix else None
    kinds = sorted({str(k).strip().lower() for k in kinds or () if str(k).strip()})
    if not (device_id or kind_prefix or kinds or everything):
        raise ValueError("forget needs a device_id, kinds, a kind_prefix or everything=True")
    c = conn()
    where, args = "person_id=?", [person_id]
    if device_id:
        where += " AND device_id=?"
        args.append(device_id)
    if kind_prefix:
        where += " AND kind LIKE ? ESCAPE '\\'"
        args.append(kind_prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
    if kinds:
        where += f" AND kind IN ({','.join('?' * len(kinds))})"
        args += kinds
    if not everything:
        where += " AND kind NOT LIKE 'approval.%'"  # a decision the person made isn't undone by forgetting a device's data
    try:
        gone = [r["id"] for r in c.execute(f"SELECT id FROM events WHERE {where}", args)]
        if kind_prefix:
            c.execute("INSERT INTO tombstones(person_id, kind_prefix, device_id, before_utc, reason, created_at)"
                      " VALUES (?,?,?,?,?,?)", (person_id, kind_prefix, device_id, now_utc(), "forget", now_utc()))
        else:
            # Rows the hub derived itself (rail signals, the mock Conductor's suggestions) get no tombstone: a new
            # alert for the same train must still produce them after "Forget me".
            where_e = where.replace("person_id", "e.person_id").replace("device_id", "e.device_id").replace("kind ", "e.kind ")
            hub_made = {r["id"] for r in c.execute(
                f"SELECT e.id FROM events e JOIN devices d ON d.id=e.device_id WHERE {where_e} "
                "AND d.platform IN ('signals', 'conductor')", args)}
            _tombstone_ids(c, person_id, [g for g in gone if g not in hub_made], "forget")
        n = c.execute(f"DELETE FROM events WHERE {where}", args).rowcount  # the events_ad trigger keeps search in step
        if not everything:
            n += _cascade(c, person_id, gone, "forget", derived)
        else:  # Write for me drafts (their transcripts), who was messaged, and live call sessions go too
            for table in ("drafts", "bridge_recipients", "kairos_sessions"):
                if c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
                    c.execute(f"DELETE FROM {table} WHERE person_id=?", (person_id,))
        if device_id and not (kind_prefix or kinds) and c.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='drafts'").fetchone():
            c.execute("DELETE FROM drafts WHERE person_id=? AND device_id=?", (person_id, device_id))  # its drafts too
        c.commit()
    except Exception:
        c.rollback()
        raise
    _checkpoint(c)
    return n
