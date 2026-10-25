"""Scam and safety checks that don't trust the model alone. Pure functions over the extracted facts."""
from __future__ import annotations

import re

RISK_ORDER = {"none": 0, "low": 1, "medium": 2, "high": 3}

PAYMENT_TRAPS = ("gift card", "itunes", "google play", "steam card", "bitcoin", "crypto", "western union", "moneygram",
                 "wire transfer", "transfer to", "personal account", "voucher code")
PRESSURE = ("within 24 hours", "within 48 hours", "immediately", "act now", "today only", "final warning", "last chance",
            "legal action will", "arrest", "warrant", "police", "court order", "suspended", "will be closed", "lose your")
VERIFY = ("verify your", "confirm your bank", "confirm your card", "update your details", "click the link", "scan the qr",
          "whatsapp", "text us on", "reply with your")
OFFICIAL = ("hmrc", "hm revenue", "dvla", "dwp", "department for work", "royal mail", "nhs", "council", "hm courts",
            "home office", "gov.uk", "bank", "barclays", "lloyds", "hsbc", "natwest", "santander", "nationwide", "monzo")
GOV_DOMAINS = (".gov.uk", ".nhs.uk", ".police.uk", ".ac.uk")


def _text(facts: dict) -> str:
    bits = [facts.get("transcript", ""), facts.get("summary_plain", ""), " ".join(facts.get("key_points") or [])]
    c = facts.get("contact") or {}
    bits += [c.get("website", ""), c.get("email", ""), (facts.get("sender") or {}).get("name", "")]
    return " ".join(b for b in bits if b).lower()


def assess(facts: dict) -> dict:
    """Combine the model's verdict with fixed signals. Returns {level, reasons, notice}."""
    model = facts.get("scam_risk") or {}
    level = model.get("level") if model.get("level") in RISK_ORDER else "none"
    reasons = list(model.get("reasons") or [])
    text = _text(facts)
    score = 0

    traps = [w for w in PAYMENT_TRAPS if w in text]
    if traps:
        score += 3
        reasons.append("asks for payment in an unusual way (" + ", ".join(traps[:2]) + ")")
    pressure = [w for w in PRESSURE if w in text]
    if pressure:
        score += 1 if len(pressure) == 1 else 2
        reasons.append("uses pressure or threats (" + ", ".join(pressure[:2]) + ")")
    verify = [w for w in VERIFY if w in text]
    if verify:
        score += 2
        reasons.append("wants you to confirm details via a link, message or WhatsApp")
    claims_official = any(w in text for w in OFFICIAL)
    sites = re.findall(r"(?:https?://)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)", text)
    odd_sites = [s for s in sites if not s.endswith(GOV_DOMAINS) and any(k in s for k in ("refund", "claim", "verify", "secure", "hmrc", "gov", "tax", "bank"))]
    if claims_official and odd_sites:
        score += 2
        reasons.append("claims to be official but points to a non-official website (" + odd_sites[0] + ")")
    phones = re.findall(r"(?<!\d)(0[79]\d{2}\s?\d{3}\s?\d{3,4}|\+44\s?7\d{3}\s?\d{6})", text)
    if claims_official and phones and any(p.replace(" ", "").startswith(("07", "+447", "09")) for p in phones):
        score += 1
        reasons.append("an official body wouldn't use a mobile or premium number")
    money = facts.get("money") or {}
    if (money.get("they_owe_you") or 0) > 0 and verify:
        score += 1
        reasons.append("a refund that needs your bank details is a classic scam")

    heuristic = "high" if score >= 4 else "medium" if score >= 2 else "low" if score == 1 else "none"
    final = max(level, heuristic, key=lambda k: RISK_ORDER[k])
    seen, uniq = set(), []
    for r in reasons:
        r = str(r).strip()
        if r and r.lower() not in seen:
            seen.add(r.lower())
            uniq.append(r[:160])
    notice = {
        "none": "", "low": "Nothing here looks like a scam, but never share bank details because a letter asks.",
        "medium": "Some things about this look odd. Don't pay or share details until you've checked with the real organisation.",
        "high": "This looks like a scam. Don't pay, don't call the number on it, don't open the link. Check with the real organisation or someone you trust.",
    }[final]
    return {"level": final, "reasons": uniq[:6], "notice": notice, "model_level": level, "signals": score}


def spoken_safe(text: str) -> str:
    """Tidy model output for speaking: strip markdown, bullets and long runs of digits glued together."""
    t = re.sub(r"[*_#`>]+", "", text or "")
    t = re.sub(r"^\s*[-•]\s*", "", t, flags=re.M)
    t = re.sub(r"\s*\n\s*", " ", t).strip()
    return re.sub(r"\s{2,}", " ", t)
