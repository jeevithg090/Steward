#!/usr/bin/env python3
"""Text-only test calls: a simulated caller asks Kairos a question; we print the turns and tool calls.

    python3 simulate.py                                   # "Did anything happen with my train today?"
    python3 simulate.py "What's the weather on my phone?"
    python3 simulate.py --mock -n 5                       # 5 runs, ask_tempo mocked; prints the tool-call rate
    python3 simulate.py --mock --lang cy "Oes rhywbeth wedi digwydd gyda fy nhrên heddiw?"

--mock makes ask_tempo return a fixed answer, which isolates "does the LLM call the tool?" from the hub
and tunnel. Without --mock the simulator may not show tool calls at all, so don't read 0 as failure.
Uses ElevenLabs' simulate-conversation endpoint (deprecated, removed 31 Oct 2026). Costs a few credits per
run, not voice minutes. Never prints the API key.
"""
import argparse

import push_agent as pa

MOCK = '{"answer": "Your 08:12 GWR train to Paddington was 23 minutes late this morning.", "model": "qwen2.5:7b"}'


def short(text, n=220):
    text = " ".join(str(text or "").split())
    return text if len(text) <= n else text[: n - 1] + "…"


def run_once(key, agent_id, question, lang, mock, quiet):
    spec = {"simulated_user_config": {"language": lang, "prompt": {"prompt": (
        "You are a calm adult testing a voice assistant called Kairos. When it greets you, say yes, "
        f"then ask exactly: \"{question}\" Wait for the full answer, then say thank you and goodbye.")}}}
    if mock:
        spec["tool_mock_config"] = {"ask_tempo": {"default_return_value": MOCK, "default_is_error": False}}
    out = pa.call("POST", f"/agents/{agent_id}/simulate-conversation", key,
                  {"simulation_specification": spec, "new_turns_limit": 8})
    tools = []
    for t in out.get("simulated_conversation", []):
        if not quiet and t.get("message"):
            print(f"  {(t.get('role') or '?').upper()}: {short(t['message'])}")
        for c in t.get("tool_calls") or []:
            tools.append(c.get("tool_name"))
            if not quiet:
                print(f"     → tool {c.get('tool_name')} {short(c.get('params_as_json'))}")
    return tools


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("question", nargs="?", default="Did anything happen with my train today?")
    ap.add_argument("--lang", default="en")
    ap.add_argument("--mock", action="store_true")
    ap.add_argument("-n", type=int, default=1)
    a = ap.parse_args()
    env = pa.read_env()
    key, agent_id = env["ELEVENLABS_API_KEY"], env["ELEVENLABS_AGENT_ID"]
    hits = 0
    for i in range(a.n):
        tools = run_once(key, agent_id, a.question, a.lang, a.mock, quiet=a.n > 1)
        ok = "ask_tempo" in tools
        hits += ok
        print(f"run {i + 1}: {'called ask_tempo' if ok else 'NO ask_tempo'}  tools={tools}")
    print(f"\n[{a.lang}] ask_tempo called in {hits}/{a.n} runs")


if __name__ == "__main__":
    main()
