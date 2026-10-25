"""What the model must pull out of a photographed document. One JSON schema, used for Gemini's structured
output and for Ollama's `format`, and normalise() fills in anything a model left out so the rest of the
pipeline can rely on every key being there.
"""
from __future__ import annotations

from typing import Any

DOCUMENT_TYPES = ["bill", "letter", "statement", "medical", "benefits", "tax", "council", "legal", "bank",
                  "insurance", "housing", "school", "utility", "form", "advert", "scam_suspect", "receipt", "other"]
URGENCY = ["none", "low", "medium", "high"]
TONE = ["good_news", "neutral", "bad_news", "warning"]
RISK = ["none", "low", "medium", "high"]

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "readable": {"type": "boolean", "description": "false if the photo is too blurry, dark or cut off to read the main text"},
        "readability_issues": {"type": "array", "items": {"type": "string"}},
        "language_of_document": {"type": "string", "description": "BCP-47 code, e.g. en-GB"},
        "document_type": {"type": "string", "enum": DOCUMENT_TYPES},
        "sender": {"type": "object", "properties": {
            "name": {"type": "string", "description": "organisation or person who sent it, as printed"},
            "type": {"type": "string", "description": "e.g. water company, council, NHS hospital, HMRC, DWP, bank, landlord, debt collector, school, unknown"}},
            "required": ["name", "type"]},
        "recipient_name": {"type": "string"},
        "date_of_document": {"type": "string", "description": "ISO date YYYY-MM-DD or empty"},
        "summary_plain": {"type": "string", "description": "one or two plain English sentences: what this document is and its main message"},
        "key_points": {"type": "array", "items": {"type": "string"}, "description": "the facts that matter to the person, plain English, max 6"},
        "money": {"type": "object", "properties": {
            "you_owe": {"type": "number", "description": "amount the person must pay now, 0 if nothing; omit if no money is involved"},
            "they_owe_you": {"type": "number", "description": "amount credited or refunded to the person"},
            "currency": {"type": "string"},
            "already_paid": {"type": "boolean"},
            "notes": {"type": "string"}}},
        "dates": {"type": "array", "items": {"type": "object", "properties": {
            "date": {"type": "string", "description": "ISO date, or ISO date and time"}, "what": {"type": "string"}},
            "required": ["date", "what"]}},
        "deadline": {"type": "object", "properties": {"date": {"type": "string"}, "what": {"type": "string"}}},
        "actions_required": {"type": "array", "items": {"type": "object", "properties": {
            "action": {"type": "string"}, "by_when": {"type": "string", "description": "ISO date or empty"},
            "how": {"type": "string", "description": "phone, website, form, visit, nothing..."}},
            "required": ["action"]}},
        "urgency": {"type": "string", "enum": URGENCY},
        "tone": {"type": "string", "enum": TONE},
        "scam_risk": {"type": "object", "properties": {
            "level": {"type": "string", "enum": RISK},
            "reasons": {"type": "array", "items": {"type": "string"}}},
            "required": ["level", "reasons"]},
        "reference_numbers": {"type": "array", "items": {"type": "object", "properties": {
            "label": {"type": "string"}, "value": {"type": "string"}}, "required": ["label", "value"]}},
        "contact": {"type": "object", "properties": {
            "phone": {"type": "string"}, "email": {"type": "string"}, "website": {"type": "string"}}},
        "transcript": {"type": "string", "description": "the document's text, as printed, in its own language (up to about 3000 characters)"},
        "confidence": {"type": "number", "description": "0 to 1: how sure you are about the main message"},
    },
    "required": ["readable", "document_type", "sender", "summary_plain", "key_points", "urgency", "tone",
                 "scam_risk", "actions_required", "transcript", "confidence"],
}

DEFAULTS: dict[str, Any] = {
    "readable": True, "readability_issues": [], "language_of_document": "", "document_type": "other",
    "sender": {"name": "", "type": "unknown"}, "recipient_name": "", "date_of_document": "", "summary_plain": "",
    "key_points": [], "money": {}, "dates": [], "deadline": {}, "actions_required": [], "urgency": "none",
    "tone": "neutral", "scam_risk": {"level": "none", "reasons": []}, "reference_numbers": [], "contact": {},
    "transcript": "", "confidence": 0.5,
}


def _num(v: Any):
    if v is None or v == "":
        return None
    try:
        return round(float(str(v).replace(",", "").replace("£", "").replace("$", "").replace("€", "")), 2)
    except ValueError:
        return None


def normalise(raw: dict) -> dict:
    """Every key present, enums valid, numbers numeric, lists are lists. Never raises on odd model output."""
    f: dict[str, Any] = {}
    raw = raw if isinstance(raw, dict) else {}
    for k, default in DEFAULTS.items():
        v = raw.get(k, None)
        if v is None or (isinstance(default, dict) and not isinstance(v, dict)) or \
           (isinstance(default, list) and not isinstance(v, list)):
            v = default.copy() if isinstance(default, (dict, list)) else default
        f[k] = v
    f["document_type"] = f["document_type"] if f["document_type"] in DOCUMENT_TYPES else "other"
    f["urgency"] = f["urgency"] if f["urgency"] in URGENCY else "none"
    f["tone"] = f["tone"] if f["tone"] in TONE else "neutral"
    sr = f["scam_risk"]
    f["scam_risk"] = {"level": sr.get("level") if sr.get("level") in RISK else "none",
                      "reasons": [str(r) for r in (sr.get("reasons") or []) if r][:6]}
    s = f["sender"]
    f["sender"] = {"name": str(s.get("name") or "").strip()[:120], "type": str(s.get("type") or "unknown").strip()[:60]}
    m = f["money"]
    f["money"] = {"you_owe": _num(m.get("you_owe")), "they_owe_you": _num(m.get("they_owe_you")),
                  "currency": (m.get("currency") or "GBP") if m else None, "already_paid": m.get("already_paid"),
                  "notes": str(m.get("notes") or "")[:300]}
    f["key_points"] = [str(p)[:300] for p in f["key_points"] if p][:8]
    f["readability_issues"] = [str(p)[:120] for p in f["readability_issues"] if p][:5]
    f["dates"] = [{"date": str(d.get("date", ""))[:25], "what": str(d.get("what", ""))[:120]}
                  for d in f["dates"] if isinstance(d, dict) and d.get("date")][:10]
    d = f["deadline"]
    f["deadline"] = {"date": str(d.get("date") or "")[:25], "what": str(d.get("what") or "")[:160]} if d.get("date") else {}
    f["actions_required"] = [{"action": str(a.get("action", ""))[:200], "by_when": str(a.get("by_when") or "")[:25],
                              "how": str(a.get("how") or "")[:120]}
                             for a in f["actions_required"] if isinstance(a, dict) and a.get("action")][:6]
    f["reference_numbers"] = [{"label": str(r.get("label", ""))[:60], "value": str(r.get("value", ""))[:60]}
                              for r in f["reference_numbers"] if isinstance(r, dict) and r.get("value")][:8]
    c = f["contact"]
    f["contact"] = {k: str(c.get(k) or "")[:120] for k in ("phone", "email", "website")}
    f["transcript"] = str(f["transcript"])[:6000]
    f["summary_plain"] = str(f["summary_plain"])[:600]
    try:
        f["confidence"] = max(0.0, min(1.0, float(f["confidence"])))
    except (TypeError, ValueError):
        f["confidence"] = 0.5
    f["readable"] = bool(f["readable"])
    return f


def public(facts: dict) -> dict:
    """What goes back to the phone: everything but the full transcript (it stays server-side for follow-ups)."""
    return {k: v for k, v in facts.items() if k != "transcript"}
