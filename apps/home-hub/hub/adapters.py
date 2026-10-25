"""Turn what existing apps already send into Tempo events, so we don't build native apps tonight.

Each adapter takes the raw JSON body an app POSTs and returns a list of normalised events:
  {"kind": ..., "event_time_utc": ISO-8601 Z, "event_offset": "+01:00", "event_tz": ..., "payload": {...}}
Adapters never raise on odd input: they skip what they can't read.

The time helpers here (parse_time, local_label, zone, ...) are shared with db, memory and main.
"""
from __future__ import annotations

import hashlib
import hmac
import math
import os
import re
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any, Callable
from zoneinfo import ZoneInfo

# ---------- time helpers ----------

_HAE_FMT = re.compile(r"^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ?([+-]\d{4})$")
_ZONE_SUFFIX = re.compile(r"^(.*?)\s*\[([^\]]+)\]$")  # Java/Kotlin ZonedDateTime: ...+01:00[Europe/London]
_NUMBER = re.compile(r"^[+-]?\d+(\.\d+)?$")
_OFFSET = re.compile(r"^([+-])(\d{1,2}):?(\d{2})?$")


def home_tz() -> str:
    """The person's home zone, used for local times that come without one (TEMPO_HOME_TZ)."""
    return os.environ.get("TEMPO_HOME_TZ", "Europe/London")


@lru_cache(maxsize=128)
def _zone(name: str) -> ZoneInfo | None:
    try:
        return ZoneInfo(name)
    except Exception:  # unknown name, path-like junk, ...
        return None


def zone(name: Any) -> ZoneInfo | None:
    """ZoneInfo for an IANA name like 'Europe/London', or None if it isn't one."""
    if not isinstance(name, str) or not name.strip() or len(name) > 64:
        return None
    return _zone(name.strip())


def fold_name(fold: Any) -> str | None:
    """'earlier' / 'later' (which pass of a repeated hour), or None for anything else."""
    if fold is None or isinstance(fold, bool):
        return None
    return {"earlier": "earlier", "0": "earlier", "first": "earlier",
            "later": "later", "1": "later", "second": "later"}.get(str(fold).strip().lower())


def offset_str(value: Any) -> str | None:
    """'+01:00' from a timedelta, seconds (3600), '+0100', '+01:00', 'Z' or {'totalSeconds': 3600}."""
    if isinstance(value, dict):
        value = value.get("totalSeconds", value.get("seconds", value.get("total_seconds")))
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, timedelta):
        secs = int(value.total_seconds())
    elif isinstance(value, (int, float)):
        if not math.isfinite(value) or abs(value) > 18 * 3600:
            return None
        secs = int(value)
    else:
        s = str(value).strip()
        if s in ("Z", "z", "UTC"):
            return "+00:00"
        m = _OFFSET.match(s)
        if not m:
            return None
        secs = (int(m.group(2)) * 3600 + int(m.group(3) or 0) * 60) * (-1 if m.group(1) == "-" else 1)
        if abs(secs) > 18 * 3600:
            return None
    sign = "-" if secs < 0 else "+"
    mins = abs(secs) // 60
    return f"{sign}{mins // 60:02d}:{mins % 60:02d}"


def _from_epoch(value: Any) -> datetime | None:
    try:
        v = float(value)
        if not math.isfinite(v):
            return None
        a = abs(v)
        secs = v / 1e9 if a > 1e17 else v / 1e6 if a > 1e14 else v / 1e3 if a > 1e11 else v  # ns, µs, ms or s
        return datetime.fromtimestamp(secs, tz=timezone.utc)
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def _offset_in(dt: datetime, z: ZoneInfo | None) -> str | None:
    return offset_str(dt.astimezone(z).utcoffset()) if z else None


def parse_time(value: Any, tz: str | None = None, fold: str | None = None) -> tuple[str, str | None]:
    """Return (UTC ISO 'Z' string, local offset like '+01:00' or None if unknown). Never raises.

    A naive local time is read in `tz` (default TEMPO_HOME_TZ = Europe/London), and fold='later' picks
    the second pass of a repeated hour, so tonight's 01:30 BST (00:30Z) and 01:30 GMT (01:30Z) stay two
    instants. A 'Z' time says nothing about the local clock: its offset is None unless `tz` is given.
    Unreadable values, and years outside 1970-2100 (year 1 or 9999 overflow on conversion), become 'now'
    with offset None."""
    now = datetime.now(timezone.utc)
    try:
        when, off = _parse_time(value, tz, fold, now)
    except (OverflowError, ValueError, OSError):
        return _z(now), None
    return (when, off) if "1970" <= when[:4] <= "2100" else (_z(now), None)


def _parse_time(value: Any, tz: str | None, fold: str | None, now: datetime) -> tuple[str, str | None]:
    z = zone(tz)
    if value is None or value == "" or isinstance(value, bool):
        return _z(now), None
    if isinstance(value, (int, float)):
        dt = _from_epoch(value)
        return (_z(dt), _offset_in(dt, z)) if dt else (_z(now), None)
    s = str(value).strip()[:80]
    m = _ZONE_SUFFIX.match(s)
    if m:
        s, z = m.group(1), z or zone(m.group(2))
    if _NUMBER.match(s):
        dt = _from_epoch(s)
        return (_z(dt), _offset_in(dt, z)) if dt else (_z(now), None)
    m = _HAE_FMT.match(s)  # Health Auto Export: "2026-10-24 07:12:00 +0100"
    if m:
        s = f"{m.group(1)}T{m.group(2)}{m.group(3)[:3]}:{m.group(3)[3:]}"
    utc_only = s[-1:] in ("Z", "z")
    if utc_only:
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return _z(now), None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=z or zone(home_tz()) or timezone.utc, fold=1 if fold_name(fold) == "later" else 0)
        return _z(dt), offset_str(dt.utcoffset())
    if utc_only:
        return _z(dt), _offset_in(dt, z)
    return _z(dt), offset_str(dt.utcoffset())


def event_time_fields(value: Any, tz: str | None = None, fold: str | None = None) -> dict:
    """Envelope time fields from what a client sent: a string / epoch, or the envelope v1 object
    {utc, offset, tz, fold} (or {local, tz, fold}). Returns event_time_utc, event_offset, event_tz, fold."""
    given_off = None
    if isinstance(value, dict):
        tz = value.get("tz") or tz
        fold = value.get("fold") or fold
        given_off = offset_str(value.get("offset"))
        value = value.get("utc") or value.get("local") or value.get("time")
    when, off = parse_time(value, tz, fold)
    return {"event_time_utc": when, "event_offset": off or given_off,
            "event_tz": tz.strip() if zone(tz) else None, "fold": fold_name(fold)}


def is_repeated_hour(local: datetime) -> bool:
    """True when this local wall-clock time happens twice (the hour the clocks go back)."""
    return local.replace(fold=1 - local.fold).utcoffset() != local.utcoffset()


def local_label(utc_iso: Any, tz: str | None = None, offset: str | None = None, mark_repeat: bool = False) -> str:
    """How the person's clock showed a stored UTC time, e.g. 'Sun 01:30 BST' or 'Sun 01:30 GMT'.

    Uses `tz` (the event's event_tz) when valid, else the home zone; if `offset` (event_offset) disagrees
    with the home zone, shows that fixed offset instead ('Sun 09:30 UTC+09:00'). mark_repeat adds
    ' (1st)' / ' (2nd)' inside the repeated hour. Never raises: unreadable input comes back as given."""
    try:
        dt = datetime.fromisoformat(str(utc_iso).strip().replace("Z", "+00:00"))
    except ValueError:
        return str(utc_iso)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    z: Any = zone(tz)
    if z is None:
        home = zone(home_tz())
        off = offset_str(offset)
        if off and (home is None or _offset_in(dt, home) != off):
            m = _OFFSET.match(off)
            mins = (int(m.group(2)) * 60 + int(m.group(3))) * (-1 if m.group(1) == "-" else 1)
            z = timezone(timedelta(minutes=mins), "UTC" if mins == 0 else f"UTC{off}")
        else:
            z = home or timezone.utc
    try:
        local = dt.astimezone(z)
    except (OverflowError, ValueError):
        return str(utc_iso)
    label = f"{local.strftime('%a %H:%M')} {local.tzname() or ''}".strip()
    if mark_repeat and isinstance(z, ZoneInfo) and is_repeated_hour(local):
        label += " (2nd)" if local.fold else " (1st)"
    return label


def _z(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


# ---------- value helpers ----------

def _metric_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(name).lower()).strip("_") or "unknown"


def _num(v: Any) -> Any:
    """Numbers stay numbers (rounded); numeric strings become numbers. Never returns NaN/Infinity:
    a non-finite float becomes None, and a string like 'nan' or '1e999' stays a string."""
    if isinstance(v, bool):
        return v
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return round(v, 4) if math.isfinite(v) else None
    try:
        f = float(v)
    except (TypeError, ValueError, OverflowError):
        return v
    if not math.isfinite(f):
        return v
    return int(f) if f.is_integer() else round(f, 4)


def _f(v: Any) -> float:
    """A finite float for arithmetic (durations), 0.0 for anything else."""
    if isinstance(v, bool):
        return 0.0
    try:
        f = float(v)
    except (TypeError, ValueError, OverflowError):
        return 0.0
    return f if math.isfinite(f) else 0.0


def _zone_offset(*records: Any) -> str | None:
    """A Health Connect zone offset (startZoneOffset, zone_offset, ...) from a record or its metadata."""
    for rec in records:
        if not isinstance(rec, dict):
            continue
        for k in ("start_zone_offset", "startZoneOffset", "zone_offset", "zoneOffset",
                  "start_zone_offset_seconds", "zone_offset_seconds"):
            off = offset_str(rec.get(k))
            if off:
                return off
    return None


# ---------- Health Auto Export (iPhone → REST) ----------

def health_auto_export(body: Any) -> list[dict]:
    """Health Auto Export 'REST API' automation. Shape: {"data": {"metrics": [{"name", "units",
    "data": [{"date", "qty" | "Avg"/"Min"/"Max" | sleep fields, "source"}]}], "workouts": [...]}}"""
    data = body.get("data", body) if isinstance(body, dict) else {}
    if not isinstance(data, dict):
        return []
    out: list[dict] = []
    for metric in data.get("metrics") or []:
        if not isinstance(metric, dict):
            continue
        name = _metric_name(metric.get("name", "unknown"))
        unit = metric.get("units")
        for point in metric.get("data") or []:
            if not isinstance(point, dict):
                continue
            when, off = parse_time(point.get("sleepStart") or point.get("startDate") or point.get("date"))
            value = point.get("qty")
            extra = {k: _num(v) for k, v in point.items()
                     if k not in ("date", "qty", "source") and isinstance(v, (int, float, str))}
            if value is None and "Avg" in point:
                value = point.get("Avg")
            if value is None and "totalSleep" in point:
                value = point.get("totalSleep")
            out.append({
                "kind": f"health.{name}", "event_time_utc": when, "event_offset": off, "class": "vault",
                # extra first, so a point's own 'value'/'unit' field can't overwrite the canonical ones
                "payload": {**extra, "metric": name, "value": _num(value), "unit": unit,
                            "origin": point.get("source")},
                # Grouped values (e.g. this hour's steps) grow between exports: same id, newest wins.
                "id": f"hae:{name}:{when}:{point.get('source') or ''}", "upsert": True,
            })
    for w in data.get("workouts") or []:
        if not isinstance(w, dict):
            continue
        when, off = parse_time(w.get("start") or w.get("startDate"))
        out.append({
            "kind": "health.workout", "event_time_utc": when, "event_offset": off, "class": "vault",
            "payload": {"metric": "workout", "value": w.get("name"),
                        "duration_s": _num(w.get("duration")), "end": w.get("end"),
                        "energy": w.get("activeEnergyBurned") or w.get("activeEnergy")},
            **({"id": f"hae:workout:{w['id']}", "upsert": True} if w.get("id") else {}),
        })
    return out


# ---------- Health Connect webhook apps (Android) ----------

_TIME_KEYS = ("time", "startTime", "start_time", "timestamp", "date", "start", "recordedAt")
_VALUE_KEYS = ("value", "count", "steps", "bpm", "beatsPerMinute", "inKilograms", "percentage",
               "inKilocalories", "inMeters", "qty", "durationMinutes", "duration")


HC_ENVELOPE = {"timestamp", "app_version", "timezone", "test", "syncType", "sync_type"}
HC_SLEEP_STAGES = {"0": "unknown", "1": "awake", "2": "sleeping", "3": "out_of_bed", "4": "light",
                   "5": "deep", "6": "rem", "7": "awake_in_bed"}
HC_VALUE = {"steps": "count", "heart_rate": "bpm", "resting_heart_rate": "bpm",
            "heart_rate_variability": "rmssd_millis", "oxygen_saturation": "percentage",
            "respiratory_rate": "rate", "distance": "meters", "active_calories": "calories",
            "total_calories": "calories", "weight": "kilograms", "height": "meters", "hydration": "liters",
            "body_fat": "percentage", "blood_glucose": "mmol_per_liter", "body_temperature": "celsius",
            "vo2_max": "vo2_milliliters_per_minute_kilogram", "bmi": "value"}


def hc_webhook(body: Any) -> list[dict]:
    """HC Webhook (github.com/mcnaveen/health-connect-webhook) JSON: an envelope with timestamp /
    app_version / timezone, then one array per Health Connect type (steps, heart_rate, sleep,
    exercise, ...) and deleted[]. Each record may carry metadata {data_origin, id, last_modified_time, device}.
    The envelope 'timezone' (unless UTC) becomes each event's event_tz; a record's zone offset, when
    present, is its event_offset."""
    out: list[dict] = []
    if not isinstance(body, dict):
        return out
    test = bool(body.get("test"))
    tz = body.get("timezone")
    tz = tz.strip() if zone(tz) and tz.strip().upper() not in ("UTC", "ETC/UTC", "Z") else None
    for rtype, records in body.items():
        if rtype in HC_ENVELOPE or not isinstance(records, list):
            continue
        if rtype == "deleted":
            out += [{"kind": "_delete", "id": f"hc:{r.get('type')}:{r.get('id')}"} for r in records if isinstance(r, dict)]
            continue
        for rec in records:
            if not isinstance(rec, dict):
                continue
            meta = rec.get("metadata") if isinstance(rec.get("metadata"), dict) else {}
            dev = meta.get("device") if isinstance(meta.get("device"), dict) else {}
            payload: dict[str, Any] = {"metric": rtype, "origin": meta.get("data_origin"),
                                       "device": " ".join(str(x) for x in (dev.get("manufacturer"), dev.get("model")) if x) or None}
            if rtype == "sleep":
                end = rec.get("session_end_time") or rec.get("end_time")
                end_utc, off = parse_time(end, tz)
                dur = _f(rec.get("duration_seconds"))
                stages: dict[str, float] = {}
                stage_list = [st for st in (rec.get("stages") or []) if isinstance(st, dict)]
                for st in stage_list:
                    name = HC_SLEEP_STAGES.get(str(st.get("stage")), _metric_name(st.get("stage")))
                    stages[name] = stages.get(name, 0) + _f(st.get("duration_seconds")) / 60
                start = (stage_list[0].get("start_time") if stage_list else None) or rec.get("start_time")
                when, off2 = parse_time(start, tz) if start else (end_utc, off)
                payload.update({"value": round(dur / 3600, 2), "unit": "hours", "end": end_utc,
                                **{f"{k}_min": round(v) for k, v in stages.items()}})
                kind, off = "health.sleep", off2 or off
            elif rtype == "exercise":
                when, off = parse_time(rec.get("start_time"), tz)
                payload.update({"value": rec.get("title") or rec.get("type"), "duration_s": _num(rec.get("duration_seconds")),
                                "distance_m": _num(rec.get("distance_meters")), "steps": _num(rec.get("steps"))})
                kind = "health.workout"
            else:
                when, off = parse_time(rec.get("time") or rec.get("start_time"), tz)
                field = HC_VALUE.get(rtype)
                value = rec.get("avg", rec.get(field)) if field else None
                if value is None:
                    value = next((v for k, v in rec.items() if isinstance(v, (int, float)) and k != "metadata"), None)
                payload.update({"value": _num(value), "unit": field,
                                **{k: _num(v) for k, v in rec.items() if k in ("min", "max", "end_time", "systolic", "diastolic")}})
                kind = f"health.{_metric_name(rtype)}"
            off = off or _zone_offset(rec, meta)
            if test:
                payload["test"] = True
            rid = meta.get("id")
            out.append({
                "kind": kind, "event_time_utc": when, "event_offset": off, "event_tz": tz,
                "class": "vault", "payload": payload,
                # Stable ids so re-sent records dedupe; growing daily totals and edited records replace.
                "id": f"hc:{rtype}:{rid}" if rid else f"hc:{rtype}:{when}", "upsert": True,
            })
    return out


def health_connect(body: Any) -> list[dict]:
    """Android apps that read Health Connect and POST JSON. HC Webhook's format is handled exactly;
    anything else goes through a tolerant parser ({type: [records]}, {records: [...]}, a list...)."""
    if isinstance(body, dict) and ("app_version" in body or "deleted" in body or
                                   any(k in body for k in ("heart_rate", "sleep", "exercise")) and "timestamp" in body):
        return hc_webhook(body)
    out: list[dict] = []

    def emit(rtype: str, rec: dict) -> None:
        tval = next((rec[k] for k in _TIME_KEYS if k in rec), None)
        when, off = parse_time(tval, rec.get("timezone") or rec.get("tz"))
        val = next((rec[k] for k in _VALUE_KEYS if k in rec), None)
        if isinstance(val, dict):  # e.g. {"inKilograms": 70}
            val = next(iter(val.values()), None)
        if val is None:  # a Health Connect unit object under the type's own name: {"weight": {"inKilograms": 70}}
            val = next((u for v in rec.values() if isinstance(v, dict) for k, u in v.items()
                        if str(k).startswith("in") and isinstance(u, (int, float)) and not isinstance(u, bool)), None)
        payload = {"metric": _metric_name(rtype), "value": _num(val),
                   "origin": rec.get("dataOrigin") or rec.get("source") or rec.get("app")}
        for k, v in rec.items():
            if k not in _TIME_KEYS and isinstance(v, (int, float, str)) and k not in payload:
                payload[k] = _num(v)
        out.append({"kind": f"health.{_metric_name(rtype)}", "event_time_utc": when,
                    "event_offset": off or _zone_offset(rec, rec.get("metadata")), "class": "vault", "payload": payload})

    def walk(node: Any, rtype: str | None, depth: int = 0) -> None:
        if depth > 20:
            return
        if isinstance(node, list):
            for item in node:
                walk(item, rtype, depth + 1)
        elif isinstance(node, dict):
            if rtype and any(k in node for k in _TIME_KEYS):
                emit(str(node.get("type") or node.get("recordType") or rtype), node)
                return
            if "type" in node and any(k in node for k in ("records", "data", "samples")):
                walk(node.get("records") or node.get("data") or node.get("samples"), str(node["type"]), depth + 1)
                return
            rt = node.get("type") or node.get("recordType")  # {records: [{type, time, ...}]}: the record names itself
            if isinstance(rt, str) and rt.strip() and any(k in node for k in _TIME_KEYS):
                emit(rt, node)
                return
            for k, v in node.items():
                if isinstance(v, (list, dict)):
                    walk(v, k if k not in ("data", "records", "payload") else rtype, depth + 1)

    walk(body, None)
    return out


# ---------- OwnTracks (location, iPhone + Android) ----------

def owntracks(body: Any) -> list[dict]:
    """Location fixes, plus region transitions (entering/leaving a place such as a station).
    Waypoint and lwt messages are ignored."""
    if isinstance(body, dict) and body.get("_type") == "transition":
        when, off = parse_time(body.get("tst") or body.get("wtst"))
        return [{
            "kind": "location.transition", "event_time_utc": when, "event_offset": off, "class": "vault",
            "payload": {"event": body.get("event"), "region": body.get("desc"), "lat": body.get("lat"),
                        "lon": body.get("lon"), "accuracy_m": body.get("acc"), "tracker": body.get("tid")},
        }]
    if not isinstance(body, dict) or body.get("_type") != "location":
        return []
    when, off = parse_time(body.get("tst"))
    return [{
        "kind": "location.point", "event_time_utc": when, "event_offset": off, "class": "vault",
        "payload": {"lat": body.get("lat"), "lon": body.get("lon"), "accuracy_m": body.get("acc"),
                    "battery": body.get("batt"), "speed_kmh": body.get("vel"),
                    "region": body.get("inregions"), "tracker": body.get("tid")},
    }]


# ---------- iPhone Shortcut / Tasker / anything simple ----------

_TIME_FIELDS = ("time", "event_time", "tz", "fold")
_NOTIFICATION_FIELDS = ("app", "title", "text")


def _kind(value: Any, default: str) -> str:
    return (str(value).strip().lower() if value not in (None, "") else default)[:80] or default


def _is_notification(item: dict, default_kind: str) -> bool:
    """A Tasker/AutoNotification body: {app, title, text} with no kind, or the bare kind 'notification'.
    Any kind-less item with an app and a title or text is one, whatever the adapter: an app's message
    (say a WhatsApp login code) must never be filed as generic.title / generic.text metrics."""
    if item.get("kind") in (None, "") and "app" in item and ("title" in item or "text" in item):
        return True
    kind = _kind(item.get("kind"), default_kind)
    return kind in ("notification", "notifications") and any(k in item for k in _NOTIFICATION_FIELDS)


def simple(body: Any, default_kind: str = "generic") -> list[dict]:
    """Our own easy format, for Shortcuts and Tasker:
    {"kind": "health.steps", "value": 1234, "unit": "count", "time": "...", "tz": "...", "fold": "later"}
    or a list of those, or {"events": [...]}, or a flat dict of metrics {"steps": 1234, "sleep_hours": 7.2}.
    For Tasker (default_kind 'notification') a body {app, title, text} is one notification.signal event."""
    items = body.get("events") if isinstance(body, dict) and "events" in body else body
    if isinstance(items, dict) and "kind" not in items and not _is_notification(items, default_kind):
        items = dict(items)
        t, et, tz, fold = (items.pop(k, None) for k in _TIME_FIELDS)
        when, off = parse_time(t or et, tz, fold)
        return [{"kind": f"{default_kind}.{_metric_name(k)}"[:80], "event_time_utc": when, "event_offset": off,
                 "event_tz": tz if zone(tz) else None, "payload": {"metric": _metric_name(k), "value": _num(v)}}
                for k, v in items.items() if isinstance(v, (int, float, str)) and not isinstance(v, bool)]
    if isinstance(items, dict):
        items = [items]
    if not isinstance(items, list):
        return []  # a bare number or string: nothing we can file
    item_default = "notification.signal" if default_kind == "notification" else default_kind
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        kind = "notification.signal" if _is_notification(it, item_default) else _kind(it.get("kind"), item_default)
        tz, fold = it.get("tz"), it.get("fold")
        when, off = parse_time(it.get("time") or it.get("event_time"), tz, fold)
        p = it.get("payload")
        if isinstance(p, dict):
            payload = p
        elif p is not None:
            payload = {"value": p}
        else:
            payload = {k: v for k, v in it.items() if k not in ("kind", "class", *_TIME_FIELDS)}
        ev = {"kind": kind, "event_time_utc": when, "event_offset": off,
              "event_tz": tz if zone(tz) else None, "fold": fold_name(fold), "payload": payload}
        if isinstance(it.get("class"), str):
            ev["class"] = it["class"]  # db only lets this raise the class, never lower it
        out.append(ev)
    return out


# ---------- WhatsApp via wacli (a linked device, on the hub computer only) ----------

def _pseudo(jid: str, key: bytes) -> str | None:
    """A stable pseudonym for a WhatsApp JID (phone number): keyed, so it can't be reversed by trying numbers."""
    jid = str(jid or "").strip()
    return "p_" + hmac.new(key or b"tempo", jid.encode(), hashlib.sha256).hexdigest()[:12] if jid else None


_JID = re.compile(r"\b(\d{6,})@(?:s\.whatsapp\.net|g\.us|lid|c\.us)\b")
_MENTION = re.compile(r"(?<![\w@])@(\d{6,})\b")
_PHONE = re.compile(r"(?<![\w+])\+?\(?\d(?:[\s().\-\u2010-\u2015\u00a0]{0,2}\d){8,14}(?![\w])")
_TIME_LIST = re.compile(r"(?:\d{1,2}[.:]\d{2}\s*)+")


def _scrub(text: str, key: bytes) -> str:
    """Phone numbers in text (a JID, an @mention, a shared contact's number) become the same keyed pseudonyms
    as senders, so the hub never keeps a number in clear. Short codes (OTPs, times, dates) are left alone."""
    text = _JID.sub(lambda m: _pseudo(m.group(1) + "@s.whatsapp.net", key) or "", text)
    text = _MENTION.sub(lambda m: "@" + (_pseudo(m.group(1) + "@s.whatsapp.net", key) or ""), text)
    def number(m: re.Match) -> str:
        raw = m.group(0)
        if _TIME_LIST.fullmatch(raw.strip()):
            return raw  # '08.12 08.42 09.12' is a list of times, not a number
        digits = re.sub(r"\D", "", raw)
        if digits.startswith("0") and len(digits) in (10, 11):
            digits = "44" + digits[1:]  # UK national format: the same pseudonym as the +44 form
        return "[number " + (_pseudo(digits + "@s.whatsapp.net", key) or "") + "]"
    return _PHONE.sub(number, text)


def wacli(body: Any, key: bytes = b"") -> list[dict]:
    """wacli (github.com/openclaw/wacli) --webhook: one flat JSON object per stored message,
    {Chat, ID, SenderJID, Timestamp, FromMe, Text, ChatName, Media}; payloads with an EventType (receipts,
    presence) are ignored. Other people's words: kind message.whatsapp is always vault, its text is hidden
    unless WhatsApp is in TEMPO_NOTIFY_APPS, and it is untrusted data for the model. Phone numbers are kept
    only as pseudonyms (keyed with the webhook secret); media keeps its type and size, never a file name.
    The id hashes chat + message ID, so a re-sent message is a duplicate; an edit (Edited) replaces the stored
    text and a 'delete for everyone' (Revoked) deletes it for good. Reactions are not stored."""
    items = body if isinstance(body, list) else [body]
    out: list[dict] = []
    for m in items:
        if not isinstance(m, dict) or m.get("EventType") or not m.get("ID"):
            continue
        if m.get("ReactionToID") or m.get("ReactionEmoji"):
            continue  # a reaction, not a message
        chat, mid = str(m.get("Chat") or ""), str(m.get("ID"))
        # Keyed by the message ID alone: a revoke or edit carries the chat as the *sender* sees it, so chat+ID
        # would never match an incoming 1:1 message.
        eid = "wa:" + hashlib.sha256(mid.encode()).hexdigest()[:24]
        if m.get("Revoked"):
            out.append({"kind": "_delete", "id": eid})  # the sender deleted it for everyone: so do we
            continue
        when, off = parse_time(m.get("Timestamp"))
        name = m.get("ChatName") if isinstance(m.get("ChatName"), str) else ""
        payload: dict[str, Any] = {
            "app": "WhatsApp", "chat": _scrub(name.strip()[:100], key) or "a chat",
            "chat_type": "group" if chat.endswith("@g.us") else "direct", "chat_id": _pseudo(chat, key),
            "from_me": bool(m.get("FromMe")), "sender": "me" if m.get("FromMe") else _pseudo(m.get("SenderJID"), key),
            "text": _scrub(str(m.get("Text") or "")[:4000], key)}
        media = m.get("Media") if isinstance(m.get("Media"), dict) else None
        if media:
            payload["media"] = {"type": str(media.get("Type") or "")[:20] or None,
                                "mime": str(media.get("MimeType") or "")[:60] or None, "bytes": _num(media.get("FileLength"))}
            if isinstance(media.get("Caption"), str) and media["Caption"].strip():
                payload["caption"] = _scrub(media["Caption"][:1000], key)
        if m.get("Edited"):
            payload["edited"] = True
            payload.pop("from_me", None)  # an edit's FromMe/Chat are from the sender's side: keep the stored ones
            payload.pop("sender", None)
            payload.pop("chat", None)
            payload.pop("chat_id", None)
            payload.pop("chat_type", None)
        out.append({"kind": "message.whatsapp", "event_time_utc": when, "event_offset": off, "class": "vault",
                    "id": eid, "payload": payload, "upsert": bool(m.get("Edited"))})
    return out


ADAPTERS: dict[str, tuple[str, Callable[[Any], list[dict]]]] = {
    "health-auto-export": ("Apple Health (Health Auto Export)", health_auto_export),
    "health-connect": ("Health Connect (Android)", health_connect),
    "owntracks": ("Location (OwnTracks)", owntracks),
    "shortcut": ("iPhone Shortcut", lambda b: simple(b, "health")),
    "tasker": ("Android Tasker", lambda b: simple(b, "notification")),
    "generic": ("Other app", simple),
    "whatsapp": ("WhatsApp (wacli, this computer)", wacli),
}
