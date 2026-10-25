"""The vault: encrypted at rest, searchable without decrypting, rights-checked, tamper-evident, and forgettable for good."""
import base64
import json
import os
import sqlite3

import pytest

os.environ.setdefault("TEMPO_VAULT_KEY", base64.b64encode(b"test-key-32-bytes-test-key-32-by").decode())

from guardian import vault as V  # noqa: E402


@pytest.fixture()
def vault(tmp_path):
    v = V.Vault(tmp_path / "v.db")
    yield v
    v.close()


def test_roundtrip_and_nothing_plain_on_disk(vault, tmp_path):
    o = vault.owner()
    rec = o.put("people", {"name": "Arjun Gaddam", "relation": "son", "phone": "07700 900821"}, tags=["payee:Arjun Gaddam", "relation:son"])
    assert o.get(rec.id).data["name"] == "Arjun Gaddam"
    raw = (tmp_path / "v.db").read_bytes() + (tmp_path / "v.db-wal").read_bytes() if (tmp_path / "v.db-wal").exists() else (tmp_path / "v.db").read_bytes()
    for word in (b"Arjun", b"Gaddam", b"07700", b"son", b"payee"):
        assert word not in raw, f"{word!r} is in the file in plain text"


def test_blind_index_finds_by_tag(vault):
    o = vault.owner()
    o.put("people", {"name": "Arjun"}, tags=["relation:son"])
    o.put("people", {"name": "Priya"}, tags=["relation:daughter"])
    o.put("money", {"payee_id": "water"}, tags=["payee:water"])
    assert [r.data["name"] for r in o.find("people", ["Relation: SON"])] == ["Arjun"]
    assert len(o.find("people")) == 2
    assert len(o.find(tags=["payee:water"])) == 1
    assert o.find("people", ["relation:uncle"]) == []


def test_capabilities_are_least_privilege(vault):
    lr = vault.open("letter-reader", V.caps_for("letter-reader"))
    lr.put("documents", {"summary": "water bill"})
    with pytest.raises(V.Forbidden):
        lr.put("money", {"x": 1})
    with pytest.raises(V.Forbidden):
        lr.find("people")
    nav = vault.open("navigator", V.caps_for("navigator"))
    assert nav.find("people") == []          # may read people (none yet)
    with pytest.raises(V.Forbidden):
        nav.find("documents")                # may not read letters
    with pytest.raises(V.Forbidden):
        nav.export()
    # every refusal is in the log
    actions = [(e["actor"], e["action"], e["ok"]) for e in vault.log_entries()]
    assert ("letter-reader", "write", 0) in actions and ("navigator", "export", 0) in actions


def test_find_hides_categories_the_actor_may_not_read(vault):
    o = vault.owner()
    o.put("people", {"name": "A"}, tags=["shared:x"])
    o.put("documents", {"summary": "B"}, tags=["shared:x"])
    lr = vault.open("letter-reader", V.caps_for("letter-reader"))
    assert [r.category for r in lr.find(tags=["shared:x"])] == ["documents"]


def test_ciphertext_cannot_move_between_records(vault):
    o = vault.owner()
    a = o.put("people", {"name": "A"})
    b = o.put("people", {"name": "B"})
    c = vault.c
    ra = c.execute("SELECT nonce, ciphertext FROM records WHERE id=?", (a.id,)).fetchone()
    c.execute("UPDATE records SET nonce=?, ciphertext=? WHERE id=?", (ra["nonce"], ra["ciphertext"], b.id))
    with pytest.raises(V.Tampered):
        o.get(b.id)
    assert any("changed on disk" in p or "doesn't match" in p for p in vault.verify()["problems"])


def test_tamper_detection_record_log_and_truncation(vault, tmp_path):
    o = vault.owner()
    r = o.put("habits", {"active": [8, 21]})
    o.put("habits", {"apps": {"Opened Weather": 3}})
    assert vault.verify()["ok"]
    cp = vault.checkpoint()
    assert V.verify_checkpoint(cp.to_dict())
    assert V.verify_checkpoint(cp.to_dict(), vault.pubkey)
    bad = dict(cp.to_dict(), head="0" * 64)
    assert not V.verify_checkpoint(bad)
    # 1. a byte of ciphertext
    c = vault.c
    row = c.execute("SELECT ciphertext FROM records WHERE id=?", (r.id,)).fetchone()
    ct = row["ciphertext"]
    c.execute("UPDATE records SET ciphertext=? WHERE id=?", (("A" if ct[0] != "A" else "B") + ct[1:], r.id))
    rep = vault.verify()
    assert not rep["ok"] and any(r.id in p for p in rep["problems"])
    c.execute("UPDATE records SET ciphertext=? WHERE id=?", (ct, r.id))
    assert vault.verify()["ok"]
    # 2. a log entry edited
    c.execute("UPDATE log SET actor='someone else' WHERE seq=1")
    assert any("altered" in p for p in vault.verify()["problems"])
    c.execute("UPDATE log SET actor='owner' WHERE seq=1")
    assert vault.verify()["ok"]
    # 3. the log truncated after a checkpoint
    c.execute("DELETE FROM log WHERE seq=(SELECT max(seq) FROM log)")
    rep = vault.verify()
    assert not rep["ok"] and any("truncated" in p or "deleted" in p or "doesn't chain" in p for p in rep["problems"])


def test_planted_record_is_noticed(vault):
    o = vault.owner()
    o.put("people", {"name": "A"})
    c = vault.c
    c.execute("INSERT INTO records(id, category, created_at, updated_at, nonce, ciphertext, digest) VALUES ('r_planted','people','x','x','AAAA','BBBB',?)",
              (__import__("hashlib").sha256(b"AAAABBBB").hexdigest(),))
    assert any("planted" in p for p in vault.verify()["problems"])


def test_crypto_shred_forgets_for_good(vault, tmp_path):
    o = vault.owner()
    o.put("people", {"name": "Arjun"}, tags=["relation:son"])
    o.put("people", {"name": "Priya"})
    o.put("money", {"payee_id": "water"})
    assert o.forget_category("people") == 2
    assert o.find("people") == [] and len(o.find("money")) == 1
    assert "people" in vault.stats()["forgotten_categories"]
    assert vault.verify()["ok"], vault.verify()["problems"]
    with pytest.raises(V.VaultError):
        o.put("people", {"name": "again"})
    # even a backup taken before the forget is unreadable: the key is gone from the keys table
    row = vault.c.execute("SELECT destroyed_at FROM keys WHERE category='people'").fetchone()
    assert row["destroyed_at"]


def test_forget_one_and_export(vault):
    o = vault.owner()
    a = o.put("notes", {"t": "a"})
    b = o.put("notes", {"t": "b"}, ttl_days=-1)  # already expired
    assert o.forget(a.id) and not o.forget(a.id)
    assert o.sweep() == 1
    assert vault.verify()["ok"]
    out = o.export()
    assert out["records"] == [] and any(e["action"] == "forget" for e in out["log"]) and any(e["action"] == "expire" for e in out["log"])


def test_head_file_detects_database_swap(tmp_path):
    v = V.Vault(tmp_path / "v.db")
    o = v.owner()
    o.put("people", {"name": "A"})
    v.checkpoint()
    o.put("people", {"name": "B"})
    v.checkpoint()
    v.close()
    # an attacker restores yesterday's database (fewer checkpoints) but can't rewrite the head file
    os.remove(tmp_path / "v.db")
    for suffix in ("-wal", "-shm"):
        try:
            os.remove(str(tmp_path / "v.db") + suffix)
        except FileNotFoundError:
            pass
    v2 = V.Vault(tmp_path / "v.db")
    v2.owner().put("people", {"name": "A"})
    v2.checkpoint()
    rep = v2.verify()
    assert not rep["ok"] and any("rolled back" in p or "replaced" in p for p in rep["problems"])
    v2.close()


def test_root_key_file_is_private(tmp_path, monkeypatch):
    monkeypatch.delenv("TEMPO_VAULT_KEY", raising=False)
    k = V.load_root_key(tmp_path / "k.key")
    assert len(k) == 32 and (tmp_path / "k.key").stat().st_mode & 0o077 == 0
    assert V.load_root_key(tmp_path / "k.key") == k
