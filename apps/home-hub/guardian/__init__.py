"""Kairos Guardian: the blue team and the vault.

    vault.py      the encrypted local store of what Kairos knows about the person (people, habits, money, documents)
    profile.py    the person's own rhythm: usual payees, hours, apps, struggles; anomaly scores; the monthly review
    threats.py    the scam catalogue as code: how each scam looks, the hook it uses, the signal, the friction, the lesson
    watchers.py   agents that watch the agents: invariants, canaries, the text sentinel, code integrity
    lockdown.py   the kill switch (stdlib only; honoured by the Navigator and the phone-task runner)
    run.py        the Guardian process: tails the hub, runs the watchers, writes guardian.* events and the status file
    api.py        /api/guardian/* on the hub

Keep this file free of imports: lockdown.py is imported by processes that run on macOS's Python 3.9.
"""
