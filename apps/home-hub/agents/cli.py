#!/usr/bin/env python3
"""Run the letter reader from the terminal, for testing and the demo rehearsal.

    .venv/bin/python -m agents.cli agents/samples/water_credit.png
    .venv/bin/python -m agents.cli agents/samples/council_tax.png --language te --dialect Telangana --play
    .venv/bin/python -m agents.cli photo.jpg --ask "what happens if I can't pay by then?"
    .venv/bin/python -m agents.cli --health

Audio (when Gemini TTS is available) is saved next to the photo as <name>.<lang>.wav; --play plays it.
"""
from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
import time
from pathlib import Path

from .core import config, llm
from .core.memory import HubMemory
from .core.speech import Speech
from .document_interpreter.agent import DocumentInterpreterAgent


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("photos", nargs="*", help="photo(s) of the document, in page order")
    ap.add_argument("--language", default="en-GB")
    ap.add_argument("--dialect", default="")
    ap.add_argument("--detailed", action="store_true")
    ap.add_argument("--no-speak", action="store_true")
    ap.add_argument("--no-memory", action="store_true", help="don't write to the hub")
    ap.add_argument("--play", action="store_true", help="play the audio with afplay")
    ap.add_argument("--ask", action="append", default=[], help="a follow-up question (repeatable)")
    ap.add_argument("--json", action="store_true", help="print the full result as JSON")
    ap.add_argument("--health", action="store_true")
    args = ap.parse_args()

    settings = config.load()
    models = llm.build(settings)
    speech = Speech(settings)
    memory = HubMemory(settings.hub_url, enabled=not args.no_memory)
    if args.health:
        print(json.dumps({**settings.public(), "providers": [p.name for p in models.providers], "voice": speech.available,
                          "local_ready": llm.ollama_ready(settings), "hub_memory": memory.ready()}, indent=2))
        return 0
    if not args.photos:
        ap.error("give at least one photo, or --health")

    agent = DocumentInterpreterAgent(models, speech, memory, settings.budget_seconds)
    images = []
    for p in args.photos:
        data = Path(p).read_bytes()
        mime = "image/png" if data[:8] == b"\x89PNG\r\n\x1a\n" else "image/jpeg"
        images.append({"b64": base64.b64encode(data).decode(), "mime": mime})
    inputs = {"images": images, "language": args.language, "dialect": args.dialect,
              "reading_level": "detailed" if args.detailed else "simple", "speak": not args.no_speak}
    context: dict = {"speak": not args.no_speak}
    t0 = time.time()
    out = agent.run(inputs, lambda s: print(f"  · {s}", flush=True), context)
    print(f"\n[{out['provider']['read']} read it, {out['provider']['wrote']} wrote it, voice: {out['provider']['voice']}, {out['seconds']} s]")
    d = out["document"]
    print(f"{d['document_type']} from {d['sender']['name'] or '?'} ({d['sender']['type']}); urgency {d['urgency']}, tone {d['tone']}, "
          f"scam risk {out['safety']['level']}; memory: {out['memory']}")
    print("\n" + out["explanation"]["text"] + "\n")
    if out["safety"]["notice"]:
        print("⚠ " + out["safety"]["notice"] + "\n")
    if out["audio"]:
        wav = Path(args.photos[0]).with_suffix(f".{args.language}.wav")
        wav.write_bytes(base64.b64decode(out["audio"]["audio_b64"]))
        print(f"audio saved: {wav} ({out['audio']['seconds']} s to make)")
        if args.play:
            subprocess.run(["afplay", str(wav)], check=False)
    elif args.play:
        subprocess.run(["say", "-v", "Daniel" if args.language.startswith("en") else "Samantha", out["explanation"]["text"][:1000]], check=False)
    for q in args.ask:
        print(f"\nQ: {q}")
        a = agent.follow_up(q, context, lambda s: None)
        print("A: " + a["answer"])
    if args.json:
        slim = {**out, "audio": {**out["audio"], "audio_b64": f"<{len(out['audio']['audio_b64'])} chars>"} if out["audio"] else None}
        print(json.dumps(slim, indent=2, ensure_ascii=False))
    print(f"\ntotal {time.time() - t0:.1f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
