#!/usr/bin/env python3
"""Clear the hub's forget tombstones so a demo can be re-seeded (needs file access to the database, i.e. this computer).

    .venv/bin/python scripts/reset_demo.py            # show how many tombstones there are
    .venv/bin/python scripts/reset_demo.py --yes      # delete them, then re-run scripts/simulate.py

Tombstones keep forgotten records from coming back when an app re-sends them. After rehearsing "Forget me"
or a Forget button, they also stop simulate.py from storing the same demo records again ("duplicates").
It resets today's spend counters too (voice calls, Write for me drafts, sends, new people), and the voice page's own
call counter (voice/.voice_sessions.json), so rehearsals don't use up the demo's daily limits. It also removes simulated Delay Repay suggestions (from simulate.py) and the approve / decline / withdraw
events that name them, so a rehearsal tap on Approve doesn't hide the claim card for the rest of the day.
Real data is never touched. Data forgotten in earlier rehearsals can then be re-sent.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from hub import db  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true", help="delete the tombstones (otherwise only count them)")
    args = ap.parse_args()
    db.init()
    pid = db.owner()["id"]
    c = db.conn()
    rules, ids = (c.execute(f"SELECT count(*) FROM tombstones WHERE person_id=? AND event_id_hash IS {op} NULL",
                            (pid,)).fetchone()[0] for op in ("", "NOT"))
    sims = [r for r in c.execute("SELECT id, hub_seq, payload, source FROM events WHERE person_id=? AND kind='mission.suggested'", (pid,))
            if str(r["source"] or "").endswith(":simulated") or json.loads(r["payload"] or "{}").get("_simulated")]
    refs = {f"#{r['hub_seq']}" for r in sims}
    answers = [r["id"] for r in c.execute("SELECT id, payload FROM events WHERE person_id=? AND kind LIKE 'approval.%'", (pid,))
               if json.loads(r["payload"] or "{}").get("request") in refs]
    day = db.now_utc()[:10]
    used = {r["kind"]: r["n"] for r in c.execute("SELECT kind, n FROM usage WHERE person_id=? AND day=?", (pid, day))}
    print(f"{rules} forget rule(s) (kind prefix / device / everything), {ids} forgotten record id(s), "
          f"{len(sims)} simulated claim suggestion(s) and {len(answers)} answer(s) to them. "
          f"Today's counters: {used or 'none'}, plus the voice page's own call count.")
    if not args.yes:
        print("Nothing changed. Run with --yes to clear them before re-seeding the demo.")
        return
    c.execute("DELETE FROM tombstones WHERE person_id=?", (pid,))
    c.execute("DELETE FROM usage WHERE person_id=? AND day=?", (pid, day))
    voice_count = Path(os.environ.get("KAIROS_VOICE_COUNT_FILE")
                       or Path(__file__).resolve().parent.parent / "voice" / ".voice_sessions.json")
    voice_count.unlink(missing_ok=True)  # voice/token_server.py's daily call count (it starts again from 0)
    for eid in [r["id"] for r in sims] + answers:
        c.execute("DELETE FROM events WHERE id=? AND person_id=?", (eid, pid))
    c.commit()
    print("Cleared. Re-run scripts/simulate.py to re-seed.")


if __name__ == "__main__":
    main()
