#!/usr/bin/env python3
"""Show what happened on Tempo's most recent call: turns, tool calls, tool errors, timings.

    python3 last_call.py        # the latest call
    python3 last_call.py 3      # the latest 3 calls (summary lines only, then the newest in full)

Reads the transcript from ElevenLabs into this terminal only. Never prints the API key.
"""
import json
import sys

import push_agent as pa


def short(text, n=160):
    text = " ".join(str(text or "").split())
    return text if len(text) <= n else text[: n - 1] + "…"


def main():
    env = pa.read_env()
    key, agent_id = env.get("ELEVENLABS_API_KEY"), env.get("ELEVENLABS_AGENT_ID")
    if not (key and agent_id):
        sys.exit("Need ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID in tempo-hub/voice/.env.")
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    convs = pa.call("GET", f"/conversations?agent_id={agent_id}&page_size={n}", key).get("conversations", [])
    if not convs:
        print("No calls yet (or they've already been deleted by the retention setting).")
        return
    for c in convs:
        print(f"- {c.get('conversation_id')}  status={c.get('status')}  "
              f"{c.get('call_duration_secs')}s  {c.get('call_successful', '')}")
    cid = convs[0]["conversation_id"]
    d = pa.call("GET", f"/conversations/{cid}", key)
    print(f"\nNewest call {cid}  status={d.get('status')}  "
          f"duration={d.get('metadata', {}).get('call_duration_secs')}s\n")
    for t in d.get("transcript", []):
        at = t.get("time_in_call_secs")
        who = (t.get("role") or "?").upper()
        if t.get("message"):
            print(f"[{at}s] {who}: {short(t['message'])}")
        for call in t.get("tool_calls") or []:
            print(f"[{at}s]   → tool {call.get('tool_name')} {short(call.get('params_as_json'), 200)}")
        for res in t.get("tool_results") or []:
            err = "ERROR " if res.get("is_error") else ""
            print(f"[{at}s]   ← {err}{res.get('tool_name')} {short(res.get('result_value'), 200)}")
    analysis = d.get("analysis") or {}
    if analysis.get("transcript_summary"):
        print("\nSummary:", short(analysis["transcript_summary"], 300))


if __name__ == "__main__":
    main()
