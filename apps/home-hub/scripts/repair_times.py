#!/usr/bin/env python3
"""Correct the local-time fields of rows stored before the time fixes (needs file access to the database).

    .venv/bin/python scripts/repair_times.py          # show what would change
    .venv/bin/python scripts/repair_times.py --yes    # back up data/, then change it

1. Rows with a valid event_tz get the offset that zone had at that instant (a Mac agent once sent
   Europe/London with +00:00 during BST).
2. Device and app rows with offset +00:00 and no zone get offset NULL: '+00:00' there only meant "sent in
   UTC", not "the person's clock said this", and it rendered as "17:00 UTC" next to BST rows.
Only event_offset changes. Event ids, times and tombstones are untouched. Stop the hub first (./run.sh again after).
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from hub import db  # noqa: E402
from hub.adapters import offset_str, zone  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true")
    args = ap.parse_args()
    db.init()
    c = db.conn()
    fixes: list[tuple[str | None, int]] = []
    for r in c.execute("SELECT hub_seq, event_time_utc, event_offset, event_tz FROM events WHERE event_tz IS NOT NULL"):
        z = zone(r["event_tz"])
        try:
            want = offset_str(datetime.fromisoformat(r["event_time_utc"].replace("Z", "+00:00")).astimezone(z).utcoffset()) if z else None
        except (ValueError, OverflowError, TypeError):
            continue
        if want and want != r["event_offset"]:
            fixes.append((want, r["hub_seq"]))
    utc_only = [r["hub_seq"] for r in c.execute(
        "SELECT hub_seq FROM events WHERE event_offset='+00:00' AND event_tz IS NULL AND trust_level NOT IN ('hub', 'agent')")]
    print(f"{len(fixes)} row(s) get their zone's offset; {len(utc_only)} UTC-only row(s) get offset NULL.")
    if not args.yes or not (fixes or utc_only):
        print("Nothing changed." + ("" if args.yes else " Run with --yes to apply (a backup is taken first)."))
        return
    folder = db.DB_PATH.parent / "backups"
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    backup = db.backup_to(folder / f"pre-repair-times-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.db")
    c.executemany("UPDATE events SET event_offset=? WHERE hub_seq=?", fixes)
    c.executemany("UPDATE events SET event_offset=NULL WHERE hub_seq=?", [(s,) for s in utc_only])
    c.commit()
    print(f"Done. Backup: {backup}")


if __name__ == "__main__":
    main()
