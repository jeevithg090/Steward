"""Try the Navigator from a terminal.

    python3 -m navigator "send fifty pounds to my son for rent" --mock --approve
    python3 -m navigator "pay the electricity bill" --mock --approve --mode popup
    python3 -m navigator "send fifty pounds to my son" --mock --mode cop_mismatch      # stops before sending
    python3 -m navigator "what's my balance" --phone 10.232.29.97:8200               # the real iPhone (iCTRL)

--approve (mock only) plays the owner tapping Yes on the Kairos card. --brain gemini|ollama|off picks the model
for the judgement calls (default: Gemini if GEMINI_API_KEY is set, else the local model). --json prints the record.
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from pathlib import Path

from .brain import Brain
from .hands import ICTRLHands, MockHands
from .ledger import Ledger
from .navigator import Navigator
from .payees import Book


def main() -> int:
    ap = argparse.ArgumentParser(prog="navigator")
    ap.add_argument("text", nargs="+")
    ap.add_argument("--mock", action="store_true", help="drive the scripted OxBank instead of a phone")
    ap.add_argument("--mode", default="", help="mock adversarial modes, comma-separated: cop_mismatch,wrong_amount,injection,popup,locked,wrong_account")
    ap.add_argument("--phone", default=None, help="iCTRL host:port of the iPhone")
    ap.add_argument("--approve", action="store_true", help="(mock) auto-tap Yes when the approval card appears")
    ap.add_argument("--brain", default=None, choices=["gemini", "ollama", "off"])
    ap.add_argument("--book", default=None, help="path to payees.json (default data/payees.json, demo book created if missing)")
    ap.add_argument("--oxbank-url", default=None)
    ap.add_argument("--card", action="store_true", help="serve the approval card API on 127.0.0.1 (running ON the phone, e.g. inside OpenMinis)")
    ap.add_argument("--port", type=int, default=8790, help="port for --card (default 8790)")
    ap.add_argument("--kairos", default="uk.oxhack.tempo.6q9wsfp48t", help="bundle id of the Kairos app to bring forward for the card")
    ap.add_argument("--pair-as", default="kairos-navigator", help="client name used if the iCTRL runner needs pairing")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    text = " ".join(a.text)
    book = Book.load(Path(a.book) if a.book else None, create_demo=True)
    brain = Brain(a.brain)
    hands = MockHands([m for m in a.mode.split(",") if m]) if a.mock else ICTRLHands(a.phone, pair_as=a.pair_as)
    ledger = Ledger(post=not a.mock)
    nav = Navigator(book, hands, brain=brain, ledger=ledger, oxbank_url=a.oxbank_url)
    card = None
    if a.card:
        from .card_server import CardServer
        card = CardServer(nav, a.port).start()
        nav.card_app = a.kairos
        print(f"approval card API on http://127.0.0.1:{a.port}/navigator/status (Kairos: {a.kairos})")
    print(f"brain: {brain.describe()}   hands: {hands.name}   book: {book.path}")

    def approver():
        for _ in range(400):
            time.sleep(0.05)
            st = nav.status()
            if st.get("status") == "awaiting_approval":
                p = st["payment"]
                print(f"  [card] {p['readback']}  ·  bank shows: {p.get('cop_name')}  ·  {p['expires_in']}s left")
                print("  [card] (auto) Yes, do it  → Face ID ok")
                nav.approve(st["id"], p["token"], by="cli")
                return
            if st.get("status") not in ("understanding", "checking", "navigating", "awaiting_approval"):
                return
    if a.approve and a.mock:
        threading.Thread(target=approver, daemon=True).start()

    t0 = time.time()
    out = nav.run(text, on_step=lambda s: print(f"  · {s}", flush=True), via="cli")
    print(f"\n{out['status']} in {time.time() - t0:.1f}s: {out['answer']}")
    if a.mock:
        print(f"mock bank actually sent: {hands.sent or 'nothing'}")
    print("\nledger:")
    for e in nav.timeline():
        print(f"  +{e['ms']:>6} ms  {e['kind']}")
    if a.json:
        print(json.dumps(out, indent=2, default=str))
    if card:
        card.stop()
    return 0 if out["status"] in ("done", "refused", "mismatch") else 1


if __name__ == "__main__":
    sys.exit(main())
