"""The person's own rhythm, learned from their hub, and what counts as "unusual for them".

Scammers work because they know nothing about you and make you act before anyone who does can speak. Kairos
knows you: who you pay and roughly how much, when you're usually active, which apps you use, where you get stuck.
That knowledge lives in the vault (encrypted, this computer only) and is used for three things:

    anomaly()          is this payment / task unusual for this person? A score, the reasons, the friction to apply
    monthly_review()   at the end of the month: what happened, what Kairos stopped, where you struggled, what's coming,
                       how much time came back; plain words to be spoken
    Profile.save()     derived facts into the vault (never the raw events), so the agents read a baseline, not a life

Everything is deterministic code over the hub's events. No model decides anything here.
"""
from __future__ import annotations

import json
import re
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Optional
from zoneinfo import ZoneInfo

from . import threats

HOME_TZ = "Europe/London"
SKIP_PREFIXES = ("node.", "device.", "hub.", "guardian.heartbeat")
STRUGGLE_STATUSES = ("failed", "refused", "needs_confirmation", "cancelled", "error")
# Minutes a person would have spent without Kairos, used only for the review's "time returned" estimate (marked as such).
MINUTES = {"letter": 12, "payment": 8, "phone_task": 4, "question": 2}


# ---------------------------------------------------------------- helpers

def _payload(ev: dict) -> dict:
    p = ev.get("payload")
    if isinstance(p, str):
        try:
            p = json.loads(p)
        except ValueError:
            p = {}
    return p if isinstance(p, dict) else {}


def _utc(ev: dict) -> Optional[datetime]:
    t = ev.get("event_time_utc") or ev.get("time") or ev.get("event_time")
    if not t:
        return None
    try:
        dt = datetime.fromisoformat(str(t).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def local_time(ev: dict, tz: str = HOME_TZ) -> Optional[datetime]:
    dt = _utc(ev)
    if dt is None:
        return None
    off = ev.get("event_offset")
    if isinstance(off, str) and re.match(r"^[+-]\d\d:\d\d$", off):
        sign = 1 if off[0] == "+" else -1
        delta = timedelta(hours=int(off[1:3]), minutes=int(off[4:6])) * sign
        return (dt + delta).replace(tzinfo=None)
    try:
        return dt.astimezone(ZoneInfo(ev.get("event_tz") or tz)).replace(tzinfo=None)
    except Exception:
        return dt.astimezone(ZoneInfo(tz)).replace(tzinfo=None)


def _dec(v: Any) -> Optional[Decimal]:
    try:
        d = Decimal(str(v).replace("£", "").replace(",", "").strip())
        return d if d.is_finite() else None
    except (InvalidOperation, ValueError, TypeError):
        return None


def _f(d: Optional[Decimal]) -> Optional[float]:
    return float(d) if d is not None else None


# ---------------------------------------------------------------- the baseline

@dataclass
class PayeeStats:
    payee_id: str
    n: int = 0
    amounts: list = field(default_factory=list)
    last: Optional[str] = None
    hours: list = field(default_factory=list)
    name: str = ""

    @property
    def median(self) -> Optional[float]:
        return statistics.median(self.amounts) if self.amounts else None

    @property
    def maximum(self) -> Optional[float]:
        return max(self.amounts) if self.amounts else None

    def to_dict(self) -> dict:
        return {"payee_id": self.payee_id, "name": self.name, "payments": self.n, "median": self.median, "max": self.maximum,
                "last": self.last, "usual_hours": sorted(set(self.hours))[:8]}


@dataclass
class Baseline:
    tz: str = HOME_TZ
    days_observed: int = 0
    first_seen: Optional[str] = None
    last_seen: Optional[str] = None
    hours: list = field(default_factory=lambda: [0] * 24)   # activity per local hour
    active_window: tuple = (8, 21)                          # (first_hour, last_hour) that covers ~90% of activity
    payees: dict = field(default_factory=dict)              # payee_id -> PayeeStats
    all_amounts: list = field(default_factory=list)
    apps: Counter = field(default_factory=Counter)          # "Opened Weather" -> n (hands labels, never screen text)
    tasks_by_status: Counter = field(default_factory=Counter)
    struggles: Counter = field(default_factory=Counter)     # task text (short) -> times it failed / needed help
    senders: Counter = field(default_factory=Counter)       # letters by sender
    deadlines: list = field(default_factory=list)           # {due, what, sender}
    notifications: Counter = field(default_factory=Counter)
    refused: Counter = field(default_factory=Counter)       # money refusal reasons
    scam_letters: int = 0
    alerts: Counter = field(default_factory=Counter)
    counts: Counter = field(default_factory=Counter)        # letters, payments, phone_tasks, questions
    money_total: float = 0.0
    money_refused_total: float = 0.0
    repeats: dict = field(default_factory=dict)             # payee_id -> approx days between payments

    @property
    def p95_amount(self) -> Optional[float]:
        if not self.all_amounts:
            return None
        s = sorted(self.all_amounts)
        return s[min(len(s) - 1, int(0.95 * len(s)))]

    def knows_payee(self, payee_id: Optional[str]) -> bool:
        return bool(payee_id) and payee_id in self.payees and self.payees[payee_id].n > 0

    def in_active_window(self, hour: int) -> bool:
        a, b = self.active_window
        return a <= hour <= b if a <= b else (hour >= a or hour <= b)

    def to_dict(self) -> dict:
        return {"tz": self.tz, "days_observed": self.days_observed, "first_seen": self.first_seen, "last_seen": self.last_seen,
                "active_window": list(self.active_window), "hours": self.hours,
                "payees": {k: v.to_dict() for k, v in self.payees.items()}, "p95_amount": self.p95_amount,
                "apps": dict(self.apps.most_common(12)), "struggles": dict(self.struggles.most_common(8)),
                "senders": dict(self.senders.most_common(8)), "deadlines": self.deadlines[-12:],
                "notifications": dict(self.notifications.most_common(8)), "refused": dict(self.refused),
                "scam_letters": self.scam_letters, "alerts": dict(self.alerts), "counts": dict(self.counts),
                "money_total": round(self.money_total, 2), "money_refused_total": round(self.money_refused_total, 2),
                "repeats": self.repeats}


def _window(hist: list) -> tuple:
    total = sum(hist)
    if total < 10:
        return (7, 22)  # too little data: a generous daytime default
    lo, acc = 0, 0
    for h in range(24):
        acc += hist[h]
        if acc >= 0.05 * total:
            lo = h
            break
    hi, acc = 23, 0
    for h in range(23, -1, -1):
        acc += hist[h]
        if acc >= 0.05 * total:
            hi = h
            break
    return (lo, hi)


def build(events: Iterable[dict], tz: str = HOME_TZ) -> Baseline:
    """A baseline from hub events (any order). Reads only kinds the agents and the hub write about the person's own
    actions; message text is never read (the hub hides it anyway)."""
    b = Baseline(tz=tz)
    days = set()
    payee_days: dict = defaultdict(set)
    seen_tasks: set = set()
    for ev in events:
        kind = str(ev.get("kind") or "")
        if kind.startswith(SKIP_PREFIXES):
            continue
        p = _payload(ev)
        lt = local_time(ev, tz)
        if lt:
            days.add(lt.date())
            b.hours[lt.hour] += 1
            iso = lt.isoformat(timespec="minutes")
            b.first_seen = min(b.first_seen or iso, iso)
            b.last_seen = max(b.last_seen or iso, iso)
        if kind == "money.sent":
            pid = str(p.get("payee_id") or "unknown")
            st = b.payees.setdefault(pid, PayeeStats(pid))
            amt = _dec(p.get("amount"))
            st.n += 1
            st.name = st.name or str(p.get("cop_name") or p.get("payee") or "")
            if amt is not None:
                st.amounts.append(float(amt))
                b.all_amounts.append(float(amt))
                b.money_total += float(amt)
            if lt:
                st.hours.append(lt.hour)
                st.last = max(st.last or lt.isoformat(), lt.isoformat())
                payee_days[pid].add(lt.date())
            b.counts["payments"] += 1
        elif kind == "money.refused":
            for r in p.get("reasons") or []:
                b.refused[str(r)] += 1
            amt = _dec(p.get("amount"))
            if amt is not None:
                b.money_refused_total += float(amt)
            b.counts["payments_refused"] += 1
        elif kind == "money.requested":
            b.counts["payment_requests"] += 1
        elif kind == "hands.task":
            tid = str(p.get("task_id") or ev.get("id") or "")
            status = str(p.get("status") or "")
            b.tasks_by_status[status] += 1
            if tid not in seen_tasks:
                seen_tasks.add(tid)
                b.counts["phone_tasks"] += 1
            for step in p.get("steps") or []:
                s = str(step)
                if s.startswith("Opened "):
                    b.apps[s] += 1
            if status in STRUGGLE_STATUSES:
                b.struggles[" ".join(str(p.get("task") or "").split())[:60].lower()] += 1
        elif kind == "document.read":
            b.counts["letters"] += 1
            if p.get("sender"):
                b.senders[str(p["sender"])[:60]] += 1
            if p.get("scam_level") in ("medium", "high"):
                b.scam_letters += 1
        elif kind == "document.deadline":
            b.deadlines.append({"due": p.get("due"), "what": str(p.get("what") or "")[:80], "sender": p.get("sender"), "amount": p.get("amount")})
        elif kind == "notification.signal":
            b.notifications[str(p.get("app") or "app")[:40]] += 1
        elif kind.startswith("guardian.alert"):
            b.alerts[str(p.get("severity") or "info")] += 1
        elif kind == "hub.ask" or kind.startswith("agent.question"):
            b.counts["questions"] += 1
    b.days_observed = len(days)
    b.active_window = _window(b.hours)
    for pid, ds in payee_days.items():
        if len(ds) >= 3:
            ds = sorted(ds)
            gaps = [(ds[i + 1] - ds[i]).days for i in range(len(ds) - 1)]
            if gaps:
                b.repeats[pid] = int(statistics.median(gaps))
    b.deadlines.sort(key=lambda d: str(d.get("due") or ""))
    return b


# ---------------------------------------------------------------- "unusual for you"

@dataclass
class Anomaly:
    score: float
    level: str                      # normal | notice | pause | stop
    reasons: list
    friction: list                  # [{id, say}]
    threats: list                   # matched scams (dicts)
    say: str                        # what Kairos tells the person, plain words

    def to_dict(self) -> dict:
        return {"score": round(self.score, 2), "level": self.level, "reasons": self.reasons, "friction": self.friction,
                "threats": self.threats, "say": self.say}


LEVELS = ((0.8, "stop"), (0.55, "pause"), (0.3, "notice"), (0.0, "normal"))


def anomaly(baseline: Baseline, text: str = "", *, payee_id: Optional[str] = None, payee_known: Optional[bool] = None,
            amount: Any = None, when: Optional[datetime] = None, context: Optional[dict] = None) -> Anomaly:
    """How unusual is this, for this person, right now? `context` flags come from the watcher: recent_unknown_call,
    recent_scam_letter, money_tasks_last_10min, new_app_installed, device_joined_recently, unknown_sender."""
    ctx = dict(context or {})
    reasons: list = []
    score = 0.0
    known = payee_known if payee_known is not None else baseline.knows_payee(payee_id)
    amt = _f(_dec(amount)) if amount is not None else None
    if payee_id is not None or amt is not None or ctx.get("money"):
        if not known:
            score += 0.3
            ctx["new_payee"] = True
            reasons.append("first payment to this payee")
        elif amt is not None:
            st = baseline.payees.get(payee_id or "")
            if st and st.median and amt > 3 * st.median:
                score += 0.25
                reasons.append(f"about {amt / st.median:.0f} times what you usually send them")
            if st and st.last and ctx.get("money_tasks_last_10min", 0) >= 1:
                score += 0.1
                reasons.append("a second payment to them within minutes")
        p95 = baseline.p95_amount
        if amt is not None and p95 and amt > p95 and len(baseline.all_amounts) >= 5:
            score += 0.2
            reasons.append("more than nearly all your past payments")
        elif amt is not None and amt >= 500 and len(baseline.all_amounts) < 5:
            score += 0.1
            reasons.append("a large amount for someone who rarely sends money this way")
    when = when or datetime.now(ZoneInfo(baseline.tz)).replace(tzinfo=None)
    if not baseline.in_active_window(when.hour):
        score += 0.15
        reasons.append(f"you don't usually do this at {when.strftime('%-I %p').lower()}")
    levers = threats.pressure(text)
    for lever, weight, words in (("urgency", 0.2, "it's in a hurry"), ("authority", 0.15, "it claims authority"),
                                 ("secrecy", 0.3, "it asks for secrecy"), ("unusual_payment", 0.3, "it wants an unusual way to pay"),
                                 ("remote_access", 0.3, "it wants access to your screen"), ("codes", 0.35, "it asks for a code or PIN"),
                                 ("fear", 0.15, "it uses fear"), ("reward", 0.1, "it promises a reward")):
        if levers.get(lever):
            score += weight
            ctx[lever] = True
            reasons.append(f"{words} (\"{levers[lever]}\")")
    for flag, weight, words in (("recent_unknown_call", 0.25, "an unknown number called or messaged just before"),
                                ("recent_scam_letter", 0.3, "a letter flagged as a likely scam was read just before"),
                                ("new_app_installed", 0.3, "a screen-sharing app was just installed"),
                                ("device_joined_recently", 0.1, "a new device joined Kairos just now"),
                                ("unknown_sender", 0.15, "the request came from someone not in your contacts")):
        if ctx.get(flag):
            score += weight
            reasons.append(words)
    n_recent = int(ctx.get("money_tasks_last_10min") or 0)
    if n_recent >= 2:
        score += 0.15
        reasons.append(f"{n_recent} payments asked for in ten minutes")
    matches = threats.match(text, ctx)
    if matches:
        score += 0.3 * matches[0].score
        reasons.append(f"it looks like: {matches[0].name.lower()}")
    score = min(1.0, score)
    level = next(name for cut, name in LEVELS if score >= cut)
    friction = threats.friction_for([m.id for m in matches[:2]])
    if level in ("pause", "stop"):
        for fid in ("read_back_twice", "tell_someone") if level == "pause" else ("pause_money", "call_back_known_number", "tell_someone"):
            if fid not in {f["id"] for f in friction}:
                friction.append({"id": fid, "say": threats.FRICTION[fid]})
    if level == "normal":
        say = ""
    elif level == "notice":
        say = "This is a little unusual for you: " + "; ".join(reasons[:2]) + ". I'll read it back twice."
    elif level == "pause":
        say = ("Let's pause. This is unusual for you: " + "; ".join(reasons[:3]) + ". " +
               (matches[0].teach + " " if matches else "") + "Tell someone you trust before this goes ahead.")
    else:
        say = ("I'm not sending this now. " + "; ".join(reasons[:3]).capitalize() + ". " +
               (matches[0].teach + " " if matches else "") + "Payments stay paused until you've checked with someone you trust.")
    return Anomaly(score, level, reasons, friction, [m.to_dict() for m in matches[:3]], say)


# ---------------------------------------------------------------- the monthly review

def _month_bounds(month: str, tz: str) -> tuple:
    y, m = (int(x) for x in month.split("-"))
    start = datetime(y, m, 1, tzinfo=ZoneInfo(tz))
    end = datetime(y + (m == 12), 1 if m == 12 else m + 1, 1, tzinfo=ZoneInfo(tz))
    return start, end


def monthly_review(events: Iterable[dict], month: Optional[str] = None, tz: str = HOME_TZ, baseline: Optional[Baseline] = None) -> dict:
    """What happened this month, in numbers and in plain words. `baseline` (from all history) gives the comparison."""
    events = list(events)
    month = month or datetime.now(ZoneInfo(tz)).strftime("%Y-%m")
    start, end = _month_bounds(month, tz)
    this = [e for e in events if (u := _utc(e)) and start <= u < end]
    b = build(this, tz)
    base = baseline or build(events, tz)
    minutes = (b.counts["letters"] * MINUTES["letter"] + b.counts["payments"] * MINUTES["payment"]
               + b.counts["phone_tasks"] * MINUTES["phone_task"] + b.counts["questions"] * MINUTES["question"])
    stopped = b.counts["payments_refused"] + b.alerts["high"] + b.alerts["critical"]
    due_next = [d for d in base.deadlines if d.get("due") and str(d["due"])[:7] > month][:5]
    struggles = [{"task": t, "times": n, "tip": _tip(t)} for t, n in b.struggles.most_common(3) if n >= 2]
    regular = [{"payee": pid, "every_days": gap, "usual": base.payees[pid].median}
               for pid, gap in base.repeats.items() if pid in base.payees][:5]
    suggestions = []
    for r in regular:
        if r["usual"]:
            suggestions.append(f"You pay {base.payees[r['payee']].name or r['payee']} about every {r['every_days']} days, usually £{r['usual']:.0f}. Kairos can remind you the day before.")
    if b.apps:
        top, n = b.apps.most_common(1)[0]
        suggestions.append(f"The thing you asked for most on the phone was \"{top.replace('Opened ', 'opening ')}\" ({n} times). Say \"Kairos, {top.lower().replace('opened ', 'open ')}\" and it's one step.")
    if b.scam_letters:
        suggestions.append("At least one letter this month looked like a scam. Keep photographing anything that worries you; that's exactly what Kairos is for.")
    spoken = _spoken(month, b, base, minutes, stopped, due_next, struggles, tz)
    return {"month": month, "tz": tz, "days_active": b.days_observed,
            "counts": dict(b.counts), "money": {"sent_total": round(b.money_total, 2), "payments": b.counts["payments"],
                                               "refused": b.counts["payments_refused"], "refused_total": round(b.money_refused_total, 2),
                                               "refusal_reasons": dict(b.refused)},
            "protection": {"things_stopped": stopped, "scam_letters": b.scam_letters, "alerts": dict(b.alerts)},
            "rhythm": {"active_window": list(b.active_window), "busiest_hour": max(range(24), key=lambda h: b.hours[h]) if sum(b.hours) else None,
                       "apps": dict(b.apps.most_common(5))},
            "struggles": struggles, "coming_up": due_next, "regular_payments": regular, "suggestions": suggestions[:4],
            "time_returned_minutes": minutes, "time_returned_note": "an estimate: minutes a letter, payment or phone task would have taken by hand",
            "spoken": spoken}


def _tip(task: str) -> str:
    t = task.lower()
    if re.search(r"\b(call|phone|ring)\b", t):
        return "Say the person's name exactly as it is in your contacts, then Kairos shows a Yes button before it calls."
    if re.search(r"\b(send|pay|transfer|money)\b", t):
        return "Payments need the person to be in your payee book first. Add them on the computer, and the first payment waits a day."
    if re.search(r"\b(whatsapp|message|text)\b", t):
        return "Say who, then what to say, in one breath: \"message Priya: I'll be late\"."
    if re.search(r"\b(photo|picture|camera)\b", t):
        return "Hold the phone flat above the paper in good light, and Kairos reads it."
    return "Try asking in one short sentence. Kairos shows each step on the screen while it works."


def _spoken(month: str, b: Baseline, base: Baseline, minutes: int, stopped: int, due_next: list, struggles: list, tz: str) -> str:
    name = datetime.strptime(month, "%Y-%m").strftime("%B")
    bits = [f"Here's your {name} in a nutshell."]
    if b.counts["letters"]:
        bits.append(f"I read {b.counts['letters']} letter{'s' if b.counts['letters'] != 1 else ''} for you" +
                    (f", {b.scam_letters} of them looked like a scam" if b.scam_letters else "") + ".")
    if b.counts["payments"]:
        bits.append(f"You made {b.counts['payments']} payment{'s' if b.counts['payments'] != 1 else ''}, {b.money_total:,.0f} pounds in all, every one checked against the name on the bank's screen.")
    if stopped:
        bits.append(f"I stopped {stopped} thing{'s' if stopped != 1 else ''} that didn't look right" +
                    (f", keeping about {b.money_refused_total:,.0f} pounds where it was" if b.money_refused_total else "") + ".")
    else:
        bits.append("Nothing suspicious got near your money.")
    if b.counts["phone_tasks"]:
        bits.append(f"I did {b.counts['phone_tasks']} thing{'s' if b.counts['phone_tasks'] != 1 else ''} on your phone for you.")
    if minutes:
        bits.append(f"All told, that's about {minutes // 60} hour{'s' if minutes // 60 != 1 else ''} and {minutes % 60} minutes back in your month." if minutes >= 60
                    else f"All told, that's about {minutes} minutes back in your month.")
    a, z = b.active_window if sum(b.hours) >= 10 else base.active_window
    bits.append(f"You're usually active between {a} and {z} o'clock, so I'll be extra careful with anything outside that.")
    if struggles:
        s = struggles[0]
        bits.append(f"The thing that tripped you up most was \"{s['task']}\". {s['tip']}")
    if due_next:
        d = due_next[0]
        bits.append(f"Coming up: {d['what']} by {d['due']}" + (f", from {d['sender']}" if d.get("sender") else "") + ".")
    return " ".join(bits)


# ---------------------------------------------------------------- vault storage of the baseline

class Profile:
    """The baseline, with save/load to the vault (category 'habits', 'money', 'people' as derived facts)."""

    def __init__(self, baseline: Baseline):
        self.baseline = baseline

    @classmethod
    def from_events(cls, events: Iterable[dict], tz: str = HOME_TZ) -> "Profile":
        return cls(build(events, tz))

    def save(self, session) -> dict:
        """Derived facts only: per-payee stats under 'money', rhythm and apps under 'habits'. Record ids are stable so
        the vault holds one current row per fact (and one log entry per refresh)."""
        b = self.baseline
        saved = 0
        for pid, st in b.payees.items():
            session.put("money", {"kind": "payee_baseline", **st.to_dict()}, tags=[f"payee:{pid}", "kind:payee_baseline"],
                        record_id=f"baseline-payee-{pid}")
            saved += 1
        session.put("habits", {"kind": "rhythm", "active_window": list(b.active_window), "hours": b.hours, "days_observed": b.days_observed,
                               "apps": dict(b.apps.most_common(12)), "struggles": dict(b.struggles.most_common(8)),
                               "p95_amount": b.p95_amount, "repeats": b.repeats, "updated": datetime.now(timezone.utc).isoformat(timespec="seconds")},
                    tags=["kind:rhythm"], record_id="baseline-rhythm")
        saved += 1
        return {"saved": saved}

    @classmethod
    def load(cls, session, tz: str = HOME_TZ) -> Optional["Profile"]:
        rows = session.find("habits", ["kind:rhythm"], limit=1)
        if not rows:
            return None
        r = rows[0].data
        b = Baseline(tz=tz, days_observed=int(r.get("days_observed") or 0), hours=list(r.get("hours") or [0] * 24),
                     active_window=tuple(r.get("active_window") or (7, 22)), apps=Counter(r.get("apps") or {}),
                     struggles=Counter(r.get("struggles") or {}), repeats=dict(r.get("repeats") or {}))
        for rec in session.find("money", ["kind:payee_baseline"], limit=500):
            d = rec.data
            st = PayeeStats(d["payee_id"], n=int(d.get("payments") or 0), last=d.get("last"), hours=list(d.get("usual_hours") or []), name=d.get("name") or "")
            if d.get("median") is not None:
                st.amounts = [float(d["median"])] * max(1, st.n)
                b.all_amounts += st.amounts
            b.payees[st.payee_id] = st
        return cls(b)
