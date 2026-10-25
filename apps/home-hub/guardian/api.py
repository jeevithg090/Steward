"""/api/guardian/* on the hub: what the person's own devices (and the hub page) may see and do.

Mounted by hub/main.py with the hub's own auth dependencies, so the rules are the hub's: ask-only devices (the voice
agent, anything through the tunnel) see nothing here; household controls (unlock, forget, export) need an admin device,
and export is this computer only. The Guardian process itself writes through POST /api/events like any device.

    GET  /api/guardian/status          protected?, headline, lockdown, integrity, vault checkpoint, last alerts
    GET  /api/guardian/alerts          guardian.alert events, newest first
    GET  /api/guardian/catalogue       the scam catalogue (for the page and the pitch)
    GET  /api/guardian/pubkey          the vault's Ed25519 public key + latest signed checkpoint (the phone pins these)
    GET  /api/guardian/profile         the baseline (admin)
    GET  /api/guardian/review?month=   the monthly review (admin)
    GET  /api/guardian/integrity       manifest check + permissions (admin)
    GET  /api/guardian/vault           vault stats + chain verification (admin)
    GET  /api/guardian/vault/log       the access log (admin)
    GET  /api/guardian/vault/export    everything, decrypted (admin, loopback only)
    POST /api/guardian/vault/forget    {record_id} or {category} (admin)
    POST /api/guardian/lock            {reason, scopes} (admin)      POST /api/guardian/unlock (admin)
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from . import lockdown, profile as profile_mod, threats
from .vault import Vault, VaultError, load_root_key
from .watchers import Integrity

ROOT = Path(__file__).resolve().parents[1]
_vault: Optional[Vault] = None


def data_dir() -> Path:
    """TEMPO_GUARDIAN_DATA (tests, demos) or tempo-hub/data; read at call time."""
    import os
    return Path(os.environ.get("TEMPO_GUARDIAN_DATA") or (ROOT / "data"))


def get_vault() -> Vault:
    global _vault
    if _vault is None or Path(_vault.path).parent != data_dir():
        _vault = Vault(data_dir() / "vault.db", root_key=load_root_key(data_dir() / "vault.key"))
    return _vault


def reset_vault() -> None:  # tests
    global _vault
    if _vault is not None:
        _vault.close()
    _vault = None


class ForgetIn(BaseModel):
    record_id: Optional[str] = Field(default=None, max_length=80)
    category: Optional[str] = Field(default=None, max_length=40)


class LockIn(BaseModel):
    reason: str = Field(min_length=1, max_length=300)
    scopes: list[str] = Field(default_factory=lambda: ["money", "hands"], max_length=3)
    ttl_minutes: Optional[float] = Field(default=None, ge=1, le=1440)


def mount(app: FastAPI, current_device, admin_device, client_ip, via_tunnel, db, memory) -> None:
    def own_device(dev: dict = Depends(current_device)) -> dict:
        if dev.get("ask_only"):
            raise HTTPException(403, "Protection status is private to the person's own devices.")
        return dev

    def _alerts(person_id: str, limit: int) -> list:
        rows = db.timeline(person_id, kinds=["guardian.alert"], limit=max(1, min(int(limit), 500)))
        out = []
        for e in rows:
            p = e["payload"] if isinstance(e["payload"], dict) else {}
            out.append({"ref": f"#{e['hub_seq']}", "time": e["event_time_utc"], "local": e.get("local"), "severity": p.get("severity"),
                        "code": p.get("code"), "text": p.get("text"), "lockdown": p.get("lockdown"), "threat": p.get("threat"),
                        "evidence": p.get("evidence")})
        return out

    def _status_file() -> dict:
        try:
            return json.loads((data_dir() / "guardian_status.json").read_text())
        except (OSError, ValueError):
            return {}

    @app.get("/api/guardian/status")
    def status(dev: dict = Depends(own_device)):
        st = _status_file()
        lock = lockdown.status()
        running = bool(st) and _fresh(st.get("checked_at"))
        if not running:
            st = {"protected": False, "headline": "Protection isn't running on the hub computer (python -m guardian run).",
                  "integrity": {}, "vault": {}, "alerts": [], "alert_counts": {}, "baseline": {}, "canaries": 0, **st}
        st["lockdown"] = lock
        st["running"] = running
        if lock["locked"] and running:
            st["headline"] = "Kairos stopped something. " + ", ".join(lock["scopes"]).capitalize() + " are paused until you check."
        st["alerts"] = _alerts(dev["person_id"], 10) or st.get("alerts", [])
        try:
            cp = get_vault().latest_checkpoint()
            st["vault"]["checkpoint"] = cp.to_dict() if cp else None
            st["vault"]["pubkey"] = get_vault().pubkey
        except VaultError:
            pass
        return st

    @app.get("/api/guardian/alerts")
    def alerts(limit: int = 50, dev: dict = Depends(own_device)):
        return {"alerts": _alerts(dev["person_id"], limit)}

    @app.get("/api/guardian/catalogue")
    def catalogue(dev: dict = Depends(own_device)):
        return {"threats": threats.catalogue(), "friction": threats.FRICTION}

    @app.get("/api/guardian/pubkey")
    def pubkey(dev: dict = Depends(own_device)):
        v = get_vault()
        cp = v.latest_checkpoint()
        return {"pubkey": v.pubkey, "checkpoint": cp.to_dict() if cp else None}

    @app.get("/api/guardian/profile")
    def profile(dev: dict = Depends(admin_device)):
        evs = db.events_after(dev["person_id"], 0, 2000)
        after = evs[-1]["hub_seq"] if evs else 0
        while len(evs) % 2000 == 0 and evs:
            more = db.events_after(dev["person_id"], after, 2000)
            if not more:
                break
            evs += more
            after = more[-1]["hub_seq"]
        return profile_mod.build(evs).to_dict()

    @app.get("/api/guardian/review")
    def review(month: Optional[str] = None, dev: dict = Depends(admin_device)):
        if month and not __import__("re").match(r"^\d{4}-\d{2}$", month):
            raise HTTPException(400, "month looks like 2026-10")
        evs = db.events_after(dev["person_id"], 0, 2000)
        return profile_mod.monthly_review(evs, month)

    @app.get("/api/guardian/integrity")
    def integrity(dev: dict = Depends(admin_device)):
        integ = Integrity(ROOT, data_dir() / "guardian_manifest.json", signer_key=load_root_key(data_dir() / "vault.key"))
        rep = integ.verify()
        rep["permissions"] = integ.permissions()
        return rep

    @app.get("/api/guardian/vault")
    def vault_info(dev: dict = Depends(admin_device)):
        v = get_vault()
        return {"stats": v.stats(), "verify": v.verify()}

    @app.get("/api/guardian/vault/log")
    def vault_log(limit: int = 200, dev: dict = Depends(admin_device)):
        return {"log": get_vault().log_entries(limit)}

    @app.get("/api/guardian/vault/export")
    def vault_export(request: Request, dev: dict = Depends(admin_device)):
        ip = client_ip(request)
        if ip is None or not ip.is_loopback or via_tunnel(request):
            raise HTTPException(403, "Export the vault from the hub computer itself, never over the network.")
        out = get_vault().owner(f"owner:{dev['name']}").export()
        db.insert_events(dev["person_id"], dev["id"], [{"kind": "guardian.export", "payload": {"records": len(out["records"])}, "class": "vault"}],
                         source="hub", trust_level="hub")
        return out

    @app.post("/api/guardian/vault/forget")
    def vault_forget(body: ForgetIn, dev: dict = Depends(admin_device)):
        v = get_vault().owner(f"owner:{dev['name']}")
        if body.record_id:
            ok = v.forget(body.record_id)
            db.insert_events(dev["person_id"], dev["id"], [{"kind": "guardian.forget", "payload": {"record_id": body.record_id, "forgotten": ok}, "class": "vault"}],
                             source="hub", trust_level="hub")
            return {"forgotten": ok}
        if body.category:
            n = v.forget_category(body.category)
            db.insert_events(dev["person_id"], dev["id"], [{"kind": "guardian.forget", "payload": {"category": body.category, "records": n}, "class": "vault"}],
                             source="hub", trust_level="hub")
            return {"forgotten": n, "category": body.category, "key_destroyed": True}
        raise HTTPException(400, "Say record_id or category.")

    @app.post("/api/guardian/lock")
    def lock(body: LockIn, dev: dict = Depends(admin_device)):
        st = lockdown.lock(body.reason, body.scopes, by=f"owner:{dev['name']}", ttl_minutes=body.ttl_minutes)
        db.insert_events(dev["person_id"], dev["id"], [{"kind": "guardian.lockdown", "payload": {**st, "by": dev["name"]}, "text": "Paused by the owner: " + body.reason}],
                         source="hub", trust_level="hub")
        return st

    @app.post("/api/guardian/unlock")
    def unlock(dev: dict = Depends(admin_device)):
        was = lockdown.status()
        ok = lockdown.unlock(by=dev["name"])
        db.insert_events(dev["person_id"], dev["id"], [{"kind": "guardian.unlocked", "payload": {"by": dev["name"], "was": was}, "text": "Switched back on by the owner."}],
                         source="hub", trust_level="hub")
        return {"unlocked": ok, "was": was}


def _fresh(iso: Any, max_age_s: float = 180.0) -> bool:
    from datetime import datetime, timezone
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - dt).total_seconds() <= max_age_s
    except (ValueError, TypeError):
        return False
