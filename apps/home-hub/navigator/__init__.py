"""Tempo Navigator: the Mobile Money / Banking Navigator.

"Pay the electricity bill." "Send fifty pounds to my son." The Navigator drives the person's banking app on
their own phone, fills in the exact details, reads the bank's review screen back, checks the recipient's name
(Confirmation of Payee) against the person's payee book, and only after the owner approves on their phone
(Face ID) does it press Confirm. Every state change is a time-stamped money.* event in the Tempo hub.

Separation of powers, enforced in code rather than left to any model:
  money.py    amounts come only from the person's literal words (no model ever supplies a number)
  intent.py   words -> structured intent (rules first; Gemini fills the gaps, never invents payees or amounts)
  payees.py   the personal payee/biller book, aliases, limits, cooling-off
  policy.py   the guardrails: caps, daily total, new-payee cooling-off, duplicates, allowlisted apps, no PIN/OTP
  hands.py    how the phone is driven (iCTRL on the iPhone; a scripted mock bank for tests)
  autopilot.py per-bank skill (screens + steps) run deterministically; the brain only helps recover
  verify.py   Confirmation of Payee on the bank's review screen: name, amount, account ending, reference
  navigator.py the state machine: understood -> checked -> navigating -> verified -> awaiting_approval -> done
  ledger.py   the time-stamped money.* ledger (hub events + local file)
Stdlib only, Python 3.9+, so it runs inside voice/token_server.py as well as the hub's venv.
"""
__version__ = "0.1.0"
