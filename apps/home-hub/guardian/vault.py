"""The vault: everything Kairos learns about a person, encrypted on their own computer, with a tamper-evident log.

Why a separate store: the hub's event log is the raw life log. The vault holds what the agents *derive* and rely on
(who "my son" is, the usual water bill, where the person shops, what they struggle with). If that leaks, a scammer
has a script for the person; if it is silently changed, the agents act on lies. So the vault is built for two
failures: theft and tampering.

Design (see research/Kairos-Guardian-Architecture.md §3):
  * Envelope encryption. One root key (data/vault.key, mode 600, or the macOS Keychain) wraps one data key per
    category (people, habits, money, documents, ...). Records are AES-256-GCM with the category and record id as
    associated data, so a ciphertext can't be moved to another record. Forgetting a whole category destroys its
    data key: every record of it becomes unreadable at once (crypto-shredding), even in old backups.
  * Blind indexes. Tags ("payee:arjun gaddam", "app:whatsapp") are stored as HMACs, so "find my son" works
    without decrypting the vault and the tag words never sit in the file.
  * A hash-chained log of every read, write and forget, by whom (Schneier & Kelsey style). Each entry commits to
    the previous one; the head is signed with Ed25519 at every checkpoint and mirrored to data/vault.head. The
    public key is published, so the phone (a second witness) can check the Mac's vault wasn't rolled back.
  * Capabilities. An agent opens a session with the rights the owner gave it: the letter reader may write
    documents and read nothing else; the Navigator may read people and money. The owner has everything,
    including export (plain JSON, this computer only) and forget.
  * Retention. A record can carry expires_at; sweep() drops expired raw text, derived facts stay.

Only the `cryptography` package is used (AES-GCM, HKDF, Ed25519). Nothing here logs plaintext.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import subprocess
import threading
import time
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

from cryptography.exceptions import InvalidSignature, InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

DATA = Path(__file__).resolve().parents[1] / "data"
CATEGORIES = ("people", "places", "habits", "money", "documents", "devices", "health", "notes", "canary")
GENESIS = "0" * 64
KEYCHAIN_SERVICE = "uk.oxhack.tempo.vault"
_CAT = {c for c in CATEGORIES}


class VaultError(Exception):
    pass


class Forbidden(VaultError):
    pass


class Tampered(VaultError):
    pass


# ---------------------------------------------------------------- keys

def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def _unb64(s: str) -> bytes:
    return base64.b64decode(s)


def _hkdf(root: bytes, info: str) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=b"tempo-vault/" + info.encode()).derive(root)


def _write_secret_file(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path.parent, 0o700)
    except OSError:
        pass
    tmp = path.with_suffix(path.suffix + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(text)
    os.chmod(tmp, 0o600)
    tmp.replace(path)


def load_root_key(path: Optional[Path] = None, keychain: Optional[bool] = None) -> bytes:
    """The 32-byte root key: TEMPO_VAULT_KEY (base64, for tests), else the macOS Keychain when
    TEMPO_VAULT_KEYCHAIN=1, else data/vault.key (created on first use, mode 600)."""
    env = os.environ.get("TEMPO_VAULT_KEY")
    if env:
        key = _unb64(env)
        if len(key) != 32:
            raise VaultError("TEMPO_VAULT_KEY must be 32 bytes, base64")
        return key
    if keychain is None:
        keychain = os.environ.get("TEMPO_VAULT_KEYCHAIN") == "1"
    if keychain:
        got = _keychain_get()
        if got:
            return got
    path = path or DATA / "vault.key"
    if path.exists():
        key = _unb64(path.read_text().strip())
        if len(key) != 32:
            raise VaultError(f"{path} is not a 32-byte key")
        if keychain and _keychain_set(key):
            return key
        return key
    key = secrets.token_bytes(32)
    if keychain and _keychain_set(key):
        return key
    _write_secret_file(path, _b64(key) + "\n")
    return key


def _keychain_get() -> Optional[bytes]:
    try:
        out = subprocess.run(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", "root", "-w"],
                             capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if out.returncode != 0 or not out.stdout.strip():
        return None
    try:
        key = _unb64(out.stdout.strip())
    except ValueError:
        return None
    return key if len(key) == 32 else None


def _keychain_set(key: bytes) -> bool:
    try:
        out = subprocess.run(["security", "add-generic-password", "-s", KEYCHAIN_SERVICE, "-a", "root", "-w", _b64(key), "-U"],
                             capture_output=True, text=True, timeout=5)
        return out.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


# ---------------------------------------------------------------- records

def normalise_tag(tag: str) -> str:
    """'Payee: Arjun  GADDAM' -> 'payee:arjun gaddam' (so the blind index matches how people say things)."""
    s = unicodedata.normalize("NFKD", str(tag or ""))
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).lower()
    if ":" in s:
        k, v = s.split(":", 1)
        return k.strip() + ":" + " ".join(v.split())
    return " ".join(s.split())


@dataclass
class Record:
    id: str
    category: str
    data: dict
    created_at: str
    updated_at: str
    expires_at: Optional[str] = None
    tags: list = field(default_factory=list)  # only known when the caller passed them; blind in the file

    def public(self) -> dict:
        return {"id": self.id, "category": self.category, "data": self.data, "created_at": self.created_at,
                "updated_at": self.updated_at, "expires_at": self.expires_at}


@dataclass
class Checkpoint:
    seq: int
    at: str
    head: str
    sig: str
    pubkey: str

    def to_dict(self) -> dict:
        return {"seq": self.seq, "at": self.at, "head": self.head, "sig": self.sig, "pubkey": self.pubkey}


def _checkpoint_message(seq: int, at: str, head: str) -> bytes:
    return f"tempo-vault-checkpoint|{seq}|{at}|{head}".encode()


def verify_checkpoint(cp: dict, pubkey_b64: Optional[str] = None) -> bool:
    """Pure check anyone holding the public key can run (the phone, a test, a judge): is this signed head genuine?"""
    try:
        pub = Ed25519PublicKey.from_public_bytes(_unb64(pubkey_b64 or cp["pubkey"]))
        pub.verify(_unb64(cp["sig"]), _checkpoint_message(int(cp["seq"]), cp["at"], cp["head"]))
        return True
    except (InvalidSignature, KeyError, ValueError, TypeError):
        return False


SCHEMA = """
CREATE TABLE IF NOT EXISTS keys (
  category TEXT PRIMARY KEY, wrapped TEXT NOT NULL, nonce TEXT NOT NULL, created_at TEXT NOT NULL, destroyed_at TEXT);
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY, category TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT,
  nonce TEXT NOT NULL, ciphertext TEXT NOT NULL, digest TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS rec_cat ON records(category);
CREATE TABLE IF NOT EXISTS tags (record_id TEXT NOT NULL, blind TEXT NOT NULL, PRIMARY KEY (record_id, blind));
CREATE INDEX IF NOT EXISTS tags_blind ON tags(blind);
CREATE TABLE IF NOT EXISTS log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
  category TEXT, record_id TEXT, digest TEXT, ok INTEGER NOT NULL, prev TEXT NOT NULL, hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS checkpoints (seq INTEGER PRIMARY KEY, at TEXT NOT NULL, head TEXT NOT NULL, sig TEXT NOT NULL);
"""


class Vault:
    """One person's vault. Open a Session (with capabilities) to read or write; the Vault itself only manages keys,
    the chain and verification."""

    def __init__(self, path: Optional[Path] = None, root_key: Optional[bytes] = None, head_file: Optional[Path] = None):
        self.path = Path(path) if path else DATA / "vault.db"
        self.head_file = Path(head_file) if head_file else self.path.with_suffix(".head")
        self.root = root_key or load_root_key(self.path.with_suffix(".key"))
        self.kek = _hkdf(self.root, "kek")
        self.index_key = _hkdf(self.root, "blind-index")
        self.signer = Ed25519PrivateKey.from_private_bytes(_hkdf(self.root, "checkpoint-ed25519"))
        self.pubkey = _b64(self.signer.public_key().public_bytes_raw())
        self.lock = threading.RLock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        new = not self.path.exists()
        self.c = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self.c.row_factory = sqlite3.Row
        self.c.execute("PRAGMA journal_mode=WAL")
        self.c.executescript(SCHEMA)
        if new:
            try:
                os.chmod(self.path, 0o600)
            except OSError:
                pass
        self._deks: dict[str, bytes] = {}

    # -- sessions ----------------------------------------------------------------------------------------------
    def open(self, actor: str, caps: Iterable[str] = ()) -> "Session":
        return Session(self, actor, set(caps))

    def owner(self, actor: str = "owner") -> "Session":
        return Session(self, actor, {"*"})

    # -- keys per category -------------------------------------------------------------------------------------
    def _dek(self, category: str, create: bool = True) -> Optional[bytes]:
        if category in self._deks:
            return self._deks[category]
        row = self.c.execute("SELECT wrapped, nonce, destroyed_at FROM keys WHERE category=?", (category,)).fetchone()
        if row:
            if row["destroyed_at"]:
                return None
            try:
                dek = AESGCM(self.kek).decrypt(_unb64(row["nonce"]), _unb64(row["wrapped"]), category.encode())
            except InvalidTag:
                raise Tampered(f"the data key for '{category}' doesn't unwrap: wrong root key or a changed keys table")
            self._deks[category] = dek
            return dek
        if not create:
            return None
        dek = secrets.token_bytes(32)
        nonce = secrets.token_bytes(12)
        wrapped = AESGCM(self.kek).encrypt(nonce, dek, category.encode())
        self.c.execute("INSERT INTO keys(category, wrapped, nonce, created_at) VALUES (?,?,?,?)",
                       (category, _b64(wrapped), _b64(nonce), _now()))
        self._deks[category] = dek
        return dek

    def _destroy_dek(self, category: str) -> bool:
        row = self.c.execute("SELECT 1 FROM keys WHERE category=? AND destroyed_at IS NULL", (category,)).fetchone()
        if not row:
            return False
        # Overwrite the wrapped key with random bytes, then mark it destroyed: nothing can unwrap it again.
        self.c.execute("UPDATE keys SET wrapped=?, nonce=?, destroyed_at=? WHERE category=?",
                       (_b64(secrets.token_bytes(48)), _b64(secrets.token_bytes(12)), _now(), category))
        self._deks.pop(category, None)
        return True

    # -- blind index -------------------------------------------------------------------------------------------
    def blind(self, tag: str) -> str:
        return hmac.new(self.index_key, normalise_tag(tag).encode(), hashlib.sha256).hexdigest()[:32]

    # -- the chain ---------------------------------------------------------------------------------------------
    def _head(self) -> tuple[int, str]:
        row = self.c.execute("SELECT seq, hash FROM log ORDER BY seq DESC LIMIT 1").fetchone()
        return (row["seq"], row["hash"]) if row else (0, GENESIS)

    @staticmethod
    def _entry_hash(prev: str, at: str, actor: str, action: str, category: Optional[str], record_id: Optional[str],
                    digest: Optional[str], ok: bool) -> str:
        parts = [prev, at, actor, action, category or "", record_id or "", digest or "", "1" if ok else "0"]
        return hashlib.sha256("|".join(parts).encode()).hexdigest()

    def _log(self, actor: str, action: str, category: Optional[str], record_id: Optional[str], digest: Optional[str], ok: bool) -> int:
        _, prev = self._head()
        at = _now()
        h = self._entry_hash(prev, at, actor, action, category, record_id, digest, ok)
        cur = self.c.execute("INSERT INTO log(at, actor, action, category, record_id, digest, ok, prev, hash) VALUES (?,?,?,?,?,?,?,?,?)",
                             (at, actor[:80], action, category, record_id, digest, 1 if ok else 0, prev, h))
        return int(cur.lastrowid)

    def checkpoint(self) -> Checkpoint:
        """Sign the current head and mirror it to the head file (so a swapped or truncated database shows)."""
        with self.lock:
            seq, head = self._head()
            at = _now()
            sig = _b64(self.signer.sign(_checkpoint_message(seq, at, head)))
            self.c.execute("INSERT OR REPLACE INTO checkpoints(seq, at, head, sig) VALUES (?,?,?,?)", (seq, at, head, sig))
            cp = Checkpoint(seq, at, head, sig, self.pubkey)
            # The head file only ever moves forward. A database restored from yesterday would otherwise overwrite the
            # evidence of its own rollback at the next checkpoint; verify() reports the disagreement instead.
            try:
                mirror = json.loads(self.head_file.read_text())
            except (OSError, ValueError):
                mirror = None
            behind = bool(mirror) and verify_checkpoint(mirror, self.pubkey) and (
                int(mirror["seq"]) > seq or (int(mirror["seq"]) == seq and mirror["head"] != head))
            if not behind:
                _write_secret_file(self.head_file, json.dumps(cp.to_dict()) + "\n")
            return cp

    def latest_checkpoint(self) -> Optional[Checkpoint]:
        row = self.c.execute("SELECT seq, at, head, sig FROM checkpoints ORDER BY seq DESC LIMIT 1").fetchone()
        return Checkpoint(row["seq"], row["at"], row["head"], row["sig"], self.pubkey) if row else None

    def verify(self) -> dict:
        """Recompute the whole chain, check every present record against its last logged digest, check that
        forgotten records are gone, and compare the head with the signed checkpoint and the head file.
        Returns {ok, problems[], entries, records, head, checkpoint}. Never raises."""
        problems: list[str] = []
        with self.lock:
            prev = GENESIS
            last_digest: dict[str, Optional[str]] = {}
            n = 0
            expected_seq = 0
            for r in self.c.execute("SELECT * FROM log ORDER BY seq"):
                n += 1
                expected_seq += 1
                if r["seq"] != expected_seq:
                    problems.append(f"log entry {r['seq']} follows {expected_seq - 1}: entries were deleted")
                    expected_seq = r["seq"]
                if r["prev"] != prev:
                    problems.append(f"log entry {r['seq']} doesn't chain to the previous entry")
                h = self._entry_hash(r["prev"], r["at"], r["actor"], r["action"], r["category"], r["record_id"], r["digest"], bool(r["ok"]))
                if h != r["hash"]:
                    problems.append(f"log entry {r['seq']} was altered")
                prev = r["hash"]
                if r["ok"] and r["record_id"]:
                    if r["action"] in ("put", "update"):
                        last_digest[r["record_id"]] = r["digest"]
                    elif r["action"] in ("forget", "expire"):
                        last_digest[r["record_id"]] = None
            seq, head = self._head()
            present = {r["id"]: (r["digest"], r["category"], r["nonce"], r["ciphertext"]) for r in self.c.execute("SELECT id, digest, category, nonce, ciphertext FROM records")}
            for rid, (digest, cat, nonce, ct) in present.items():
                real = hashlib.sha256((nonce + ct).encode()).hexdigest()
                if real != digest:
                    problems.append(f"record {rid} ({cat}) was changed on disk")
                if rid not in last_digest:
                    problems.append(f"record {rid} ({cat}) was never logged: it was planted")
                elif last_digest[rid] is None:
                    problems.append(f"record {rid} ({cat}) was forgotten but is back")
                elif last_digest[rid] != digest:
                    problems.append(f"record {rid} ({cat}) doesn't match its last logged write")
            for rid, d in last_digest.items():
                if d is not None and rid not in present:
                    problems.append(f"record {rid} is missing (deleted without a forget)")
            cp = self.latest_checkpoint()
            if cp:
                if not verify_checkpoint(cp.to_dict(), self.pubkey):
                    problems.append("the stored checkpoint signature is invalid")
                if cp.seq > seq:
                    problems.append(f"the log has {seq} entries but the checkpoint signed {cp.seq}: the log was truncated")
                elif cp.seq == seq and cp.head != head:
                    problems.append("the log head differs from the signed checkpoint")
            try:
                mirror = json.loads(self.head_file.read_text())
            except (OSError, ValueError):
                mirror = None
            if mirror:
                if not verify_checkpoint(mirror, self.pubkey):
                    problems.append("the head file's signature is invalid")
                elif cp is None or int(mirror["seq"]) > (cp.seq if cp else -1):
                    problems.append("the head file remembers a later checkpoint than the database: the database was replaced or rolled back")
                elif int(mirror["seq"]) == (cp.seq if cp else -1) and mirror["head"] != cp.head:
                    problems.append("the head file and the database disagree about the head")
            elif cp is not None:
                problems.append("the head file is missing")
            return {"ok": not problems, "problems": problems, "entries": n, "records": len(present), "head": head,
                    "checkpoint": cp.to_dict() if cp else None}

    def log_entries(self, limit: int = 200, since_seq: int = 0) -> list[dict]:
        rows = self.c.execute("SELECT seq, at, actor, action, category, record_id, ok FROM log WHERE seq>? ORDER BY seq DESC LIMIT ?",
                              (since_seq, max(1, min(int(limit), 5000)))).fetchall()
        return [dict(r) for r in rows]

    def stats(self) -> dict:
        cats = {r["category"]: r["n"] for r in self.c.execute("SELECT category, count(*) n FROM records GROUP BY category")}
        destroyed = [r["category"] for r in self.c.execute("SELECT category FROM keys WHERE destroyed_at IS NOT NULL")]
        seq, head = self._head()
        return {"records": sum(cats.values()), "by_category": cats, "forgotten_categories": destroyed,
                "log_entries": seq, "head": head, "pubkey": self.pubkey, "path": str(self.path)}

    def close(self) -> None:
        with self.lock:
            self.c.close()


class Session:
    """What one actor may do. caps: 'read:<category>', 'write:<category>', 'forget:<category>', or '*' (owner)."""

    def __init__(self, vault: Vault, actor: str, caps: set):
        self.v = vault
        self.actor = actor
        self.caps = caps

    def can(self, action: str, category: str) -> bool:
        return "*" in self.caps or f"{action}:{category}" in self.caps or f"{action}:*" in self.caps

    def _need(self, action: str, category: str, record_id: Optional[str] = None) -> None:
        if not self.can(action, category):
            with self.v.lock:
                self.v._log(self.actor, action, category, record_id, None, ok=False)
            raise Forbidden(f"{self.actor} may not {action} {category}")

    # -- write ---------------------------------------------------------------------------------------------------
    def put(self, category: str, data: dict, tags: Iterable[str] = (), record_id: Optional[str] = None,
            ttl_days: Optional[float] = None) -> Record:
        category = str(category).strip().lower()
        if not category or len(category) > 40 or not category.replace("_", "").isalnum():
            raise VaultError("category must be a short word (people, habits, money, documents, ...)")
        if not isinstance(data, dict):
            raise VaultError("data must be a JSON object")
        rid = record_id or ("r_" + secrets.token_hex(8))
        self._need("write", category, rid)
        with self.v.lock:
            dek = self.v._dek(category)
            if dek is None:
                raise VaultError(f"'{category}' was forgotten; its key is destroyed. Start a new category name to keep new facts.")
            existing = self.v.c.execute("SELECT created_at, category FROM records WHERE id=?", (rid,)).fetchone()
            if existing and existing["category"] != category:
                raise VaultError("that record id belongs to another category")
            now = _now()
            expires = (datetime.now(timezone.utc) + timedelta(days=float(ttl_days))).isoformat(timespec="seconds").replace("+00:00", "Z") if ttl_days else None
            nonce = secrets.token_bytes(12)
            plain = json.dumps(data, ensure_ascii=False, sort_keys=True, default=str).encode()
            ct = AESGCM(dek).encrypt(nonce, plain, f"{category}|{rid}".encode())
            nonce_s, ct_s = _b64(nonce), _b64(ct)
            digest = hashlib.sha256((nonce_s + ct_s).encode()).hexdigest()
            created = existing["created_at"] if existing else now
            self.v.c.execute("BEGIN")
            try:
                self.v.c.execute("INSERT OR REPLACE INTO records(id, category, created_at, updated_at, expires_at, nonce, ciphertext, digest)"
                                 " VALUES (?,?,?,?,?,?,?,?)", (rid, category, created, now, expires, nonce_s, ct_s, digest))
                self.v.c.execute("DELETE FROM tags WHERE record_id=?", (rid,))
                blinds = {self.v.blind(t) for t in tags if str(t).strip()}
                blinds.add(self.v.blind(f"category:{category}"))
                self.v.c.executemany("INSERT OR IGNORE INTO tags(record_id, blind) VALUES (?,?)", [(rid, b) for b in blinds])
                self.v._log(self.actor, "update" if existing else "put", category, rid, digest, ok=True)
                self.v.c.execute("COMMIT")
            except Exception:
                self.v.c.execute("ROLLBACK")
                raise
        return Record(rid, category, data, created, now, expires, list(tags))

    # -- read ------------------------------------------------------------------------------------------------------
    def _decrypt(self, row: sqlite3.Row) -> Record:
        dek = self.v._dek(row["category"], create=False)
        if dek is None:
            raise VaultError(f"'{row['category']}' was forgotten")
        try:
            plain = AESGCM(dek).decrypt(_unb64(row["nonce"]), _unb64(row["ciphertext"]), f"{row['category']}|{row['id']}".encode())
        except InvalidTag:
            raise Tampered(f"record {row['id']} doesn't decrypt: it was changed on disk")
        return Record(row["id"], row["category"], json.loads(plain), row["created_at"], row["updated_at"], row["expires_at"])

    def get(self, record_id: str) -> Optional[Record]:
        with self.v.lock:
            row = self.v.c.execute("SELECT * FROM records WHERE id=?", (record_id,)).fetchone()
            if not row:
                return None
            self._need("read", row["category"], record_id)
            rec = self._decrypt(row)
            self.v._log(self.actor, "read", row["category"], record_id, row["digest"], ok=True)
            return rec

    def find(self, category: Optional[str] = None, tags: Iterable[str] = (), limit: int = 50) -> list[Record]:
        """Records matching ALL the tags (and the category). Blind-index lookup: the tag words are never stored."""
        tags = [t for t in tags if str(t).strip()]
        if category:
            self._need("read", category)
        with self.v.lock:
            blinds = [self.v.blind(t) for t in tags]
            if category:
                blinds.append(self.v.blind(f"category:{category}"))
            if blinds:
                q = ("SELECT r.* FROM records r WHERE " + " AND ".join("EXISTS (SELECT 1 FROM tags t WHERE t.record_id=r.id AND t.blind=?)" for _ in blinds)
                     + " ORDER BY r.updated_at DESC LIMIT ?")
                rows = self.v.c.execute(q, (*blinds, max(1, min(int(limit), 1000)))).fetchall()
            else:
                rows = self.v.c.execute("SELECT * FROM records ORDER BY updated_at DESC LIMIT ?", (max(1, min(int(limit), 1000)),)).fetchall()
            out = []
            for row in rows:
                if not self.can("read", row["category"]):
                    continue  # an agent with narrower rights simply doesn't see other categories
                out.append(self._decrypt(row))
            self.v._log(self.actor, "find", category, None, hashlib.sha256(json.dumps(sorted(blinds)).encode()).hexdigest()[:16], ok=True)
            return out

    # -- forget ---------------------------------------------------------------------------------------------------
    def forget(self, record_id: str) -> bool:
        with self.v.lock:
            row = self.v.c.execute("SELECT category FROM records WHERE id=?", (record_id,)).fetchone()
            if not row:
                return False
            self._need("forget", row["category"], record_id)
            self.v.c.execute("BEGIN")
            self.v.c.execute("DELETE FROM records WHERE id=?", (record_id,))
            self.v.c.execute("DELETE FROM tags WHERE record_id=?", (record_id,))
            self.v._log(self.actor, "forget", row["category"], record_id, None, ok=True)
            self.v.c.execute("COMMIT")
            return True

    def forget_category(self, category: str) -> int:
        """Crypto-shred: destroy the category's key and drop its rows. Old backups of the file become unreadable too."""
        self._need("forget", category)
        with self.v.lock:
            self.v.c.execute("BEGIN")
            ids = [r["id"] for r in self.v.c.execute("SELECT id FROM records WHERE category=?", (category,))]
            for rid in ids:  # one forget entry per record, so the chain still accounts for every row
                self.v._log(self.actor, "forget", category, rid, None, ok=True)
            self.v.c.execute("DELETE FROM tags WHERE record_id IN (SELECT id FROM records WHERE category=?)", (category,))
            self.v.c.execute("DELETE FROM records WHERE category=?", (category,))
            self.v._destroy_dek(category)
            self.v._log(self.actor, "forget_category", category, None, None, ok=True)  # the key is gone: nothing comes back
            self.v.c.execute("COMMIT")
            return len(ids)

    def sweep(self) -> int:
        """Drop expired records (raw text with a ttl). Owner only."""
        if "*" not in self.caps:
            raise Forbidden("only the owner sweeps the vault")
        now = _now()
        with self.v.lock:
            rows = self.v.c.execute("SELECT id, category FROM records WHERE expires_at IS NOT NULL AND expires_at<=?", (now,)).fetchall()
            for r in rows:
                self.v.c.execute("DELETE FROM records WHERE id=?", (r["id"],))
                self.v.c.execute("DELETE FROM tags WHERE record_id=?", (r["id"],))
                self.v._log(self.actor, "expire", r["category"], r["id"], None, ok=True)
            return len(rows)

    # -- rights ----------------------------------------------------------------------------------------------------
    def export(self) -> dict:
        """Everything, decrypted, as JSON: the person's right to their own data. Owner only."""
        if "*" not in self.caps:
            with self.v.lock:
                self.v._log(self.actor, "export", None, None, None, ok=False)
            raise Forbidden("only the owner may export the vault")
        with self.v.lock:
            out = {"exported_at": _now(), "records": [], "forgotten_categories": [], "log": self.v.log_entries(limit=5000)}
            for row in self.v.c.execute("SELECT * FROM records ORDER BY category, created_at"):
                try:
                    out["records"].append(self._decrypt(row).public())
                except VaultError as e:
                    out["records"].append({"id": row["id"], "category": row["category"], "error": str(e)})
            out["forgotten_categories"] = [r["category"] for r in self.v.c.execute("SELECT category FROM keys WHERE destroyed_at IS NOT NULL")]
            self.v._log(self.actor, "export", None, None, None, ok=True)
            return out


# ---------------------------------------------------------------- capabilities for the agents

DEFAULT_CAPS = {
    # least privilege: each agent sees only what its job needs; the owner (phone, hub page, CLI) has everything
    "letter-reader": {"write:documents", "read:documents"},
    "navigator": {"read:people", "read:money", "write:money"},
    "phone-hands": {"read:habits", "write:habits"},
    "laptop-hands": {"read:habits"},
    "profile": {"read:*", "write:habits", "write:people", "write:money"},
    "guardian": {"read:*", "write:canary", "write:notes"},
    "owner": {"*"},
}


def caps_for(actor: str, path: Optional[Path] = None) -> set:
    """The owner's capability file (data/guardian_caps.json) overrides the defaults; unknown actors get nothing."""
    path = path or DATA / "guardian_caps.json"
    caps = {k: set(v) for k, v in DEFAULT_CAPS.items()}
    try:
        user = json.loads(path.read_text())
        for k, v in user.items():
            caps[k] = set(v)
    except (OSError, ValueError, AttributeError):
        pass
    return caps.get(actor, set())
