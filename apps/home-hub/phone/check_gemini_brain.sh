#!/bin/bash
# Times 3 phone-agent decisions on recorded screens (no iPhone needed) and prints milliseconds per decision.
#
#   tempo-hub/phone/check_gemini_brain.sh             # Gemini: sends the task + recorded screens to Google with your key
#   tempo-hub/phone/check_gemini_brain.sh --compare   # Gemini, then the local model (Ollama) on the same decisions
#   tempo-hub/phone/check_gemini_brain.sh --local     # the local model only: nothing leaves this Mac
#
# The key is read inside the code (env, tempo-hub/agents/.env or tempo-hub/voice/.env) and is never printed.
# The recorded screens are made up (a Trainline search), not anyone's data. Writes nothing.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export PHONE_DIR="$HERE"
exec /usr/bin/python3 -B - "$@" <<'PY'
import os
import statistics
import sys

sys.path.insert(0, os.environ["PHONE_DIR"])
import gemini_brain as gb  # noqa: E402
import phone_agent as pa  # noqa: E402

TASK = "When is the next train from Oxford to London? Use Trainline."
SCREENS = [  # what the phone would show after each decision, in order (a recorded Trainline search)
    """[text] Trainline
[text] Where to?
[search field] Search stations
[text] From
[button] Oxford
[button] Today, leaving now
[button] Return
[button] 1 adult, no railcard
[button] Get times & tickets
[button] Home
[button] My Tickets
[button] Account""",
    """[text] Oxford to London Paddington
[text] Today
[button] 07:42 to 08:41, 59m, direct, £32.50
[button] 08:01 to 09:05, 1h 4m, direct, £28.10
[button] 08:31 to 09:29, 58m, direct, £28.10
[text] Prices include the booking fee
[button] Earlier trains
[button] Later trains""",
    """[text] Oxford to London Paddington
[text] 07:42 to 08:41, 59m, direct
[text] Platform 2
[text] Great Western Railway
[button] Continue""",
]


def show(calls):
    out = []
    for c in calls:
        args = ", ".join(f"{k}={str(v)[:40]!r}" for k, v in c.args.items())
        out.append(f"{c.name}({args})")
    return " + ".join(out) or "(no tool call)"


def run(provider):
    brain = pa.Brain(TASK, False, provider=provider)
    if provider == "gemini" and not brain.gemini:
        print(f"  Gemini isn't available: {brain.note or 'no key found'}.")
        return []
    print(f"\n{brain.label}")
    ms, screens, task_runs = [], list(SCREENS), 1
    while len(ms) < 3:
        try:
            text, calls = brain.decide()
        except Exception as e:  # e.g. Ollama isn't running
            print(f"  decision {len(ms) + 1}: failed ({type(e).__name__}: {str(e)[:100]})")
            return ms
        took = brain.ms[-1]
        if provider == "gemini" and brain.last != "gemini":
            print(f"  decision {len(ms) + 1}: Gemini failed, the local model answered instead ({brain.note})")
            return ms
        ms.append(took)
        said = show(calls) if calls else "answer: " + text[:80]
        print(f"  decision {len(ms)}: {took:>6} ms  {said}")
        done = not calls or calls[0].name == "finish"
        if done:
            if calls:
                print(f"               answer: {str(calls[0].args.get('answer', ''))[:120]}")
            if len(ms) < 3:  # finished early: ask again from the start for the remaining decisions
                brain, screens, task_runs = pa.Brain(TASK, False, provider=provider), list(SCREENS), task_runs + 1
            continue
        screen = screens.pop(0) if screens else SCREENS[-1]
        acting = [c for c in calls if c.name != "finish"]
        results = []
        for c in calls:
            if c.name == "finish":
                results.append((c, "Not finished yet: check the results above first, then call finish on its own."))
            else:
                results.append((c, screen if c is acting[-1] else "Done."))
        brain.tell(results)
    print(f"  median {statistics.median(ms):.0f} ms per decision, {sum(ms) / 1000:.1f} s for {len(ms)} decisions")
    return ms


args = sys.argv[1:]
if "--local" not in args:
    where = gb.key_source()
    print(f"Gemini key: {'found in ' + where if where else 'not found (run tempo-hub/agents/set_gemini_key.sh)'}; "
          f"model {gb.setting('GEMINI_PHONE_MODEL', gb.DEFAULT_MODEL)}")
    if not where:
        sys.exit(1)
fast = [] if "--local" in args else run("gemini")
slow = run("ollama") if ("--compare" in args or "--local" in args) else []
if fast and slow:
    print(f"\nGemini is about {statistics.median(slow) / max(1, statistics.median(fast)):.0f}x faster per decision "
          f"({statistics.median(fast):.0f} ms vs {statistics.median(slow):.0f} ms).")
sys.exit(0 if (fast or slow) else 1)
PY
