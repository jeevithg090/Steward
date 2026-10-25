# Kairos Guardian: the vault and the blue team

Scammers steal with urgency. Kairos defends with time.

People who aren't confident with phones don't use automation because they are afraid of it, and they are right to be:
the same agent that pays a bill for you can be talked into paying a stranger. The Guardian is the part of Kairos that
makes the other agents safe to trust, so the person gets their time back without handing their life to a machine.
It does four things:

| | What | Where |
|---|---|---|
| **Vault** | Everything Kairos learns about the person (who "my son" is, the usual water bill, where they get stuck) encrypted on their own computer: a key per category so a category can be forgotten for good, blind-index search, a hash-chained log of every read and write signed with Ed25519, least-privilege capabilities per agent, export and forget as rights | `vault.py` |
| **Rhythm** | The person's own baseline (usual payees and amounts, active hours, apps, struggles) and "unusual for you" scoring; the end-of-month review in plain spoken words, with the time returned | `profile.py`, `threats.py` |
| **Blue team** | Watchers over the agents' event stream: invariants (no payment without the owner's tap, no approval from an agent, no code spoken aloud, each agent on its own rails), canary payees and contacts, a sentinel for text in and out (prompt injection, invented phone numbers and links), a signed manifest of the agents' code and prompts | `watchers.py`, `run.py` |
| **Kill switch** | One file the Navigator, the phone-task runner and the hub all honour; the phone shows why, and only the owner switches it back on | `lockdown.py` |

Research behind it: `research/Kairos-Guardian-Threats-and-Defence.md` (how people are actually scammed, what friction
works, how agents are attacked; 76 sources) and `research/Kairos-Guardian-Architecture.md` (this design, and what we
deliberately don't do).

## Run

```bash
cd tempo-hub
.venv/bin/python -m guardian run          # the Guardian process: tails the hub, watches, writes guardian.* events and data/guardian_status.json
.venv/bin/python -m guardian seal         # after any deliberate change to agents/navigator/hands/phone/voice code or the payee book
.venv/bin/python -m guardian verify       # manifest, vault chain, file permissions, services
.venv/bin/python -m guardian status       # what the phone sees
.venv/bin/python -m guardian review       # this month's review (--month 2026-09)
.venv/bin/python -m guardian export       # the whole vault, decrypted, on this computer only
.venv/bin/python -m guardian unlock       # the owner switches Kairos back on after a lockdown
.venv/bin/python -m guardian attack       # the red team, in-process (see below)
.venv/bin/python -m pytest -q tests/test_guardian_*.py
```

On a build night, when the team is editing watched files every few minutes, run it with
`TEMPO_GUARDIAN_LOCK_ON_CODE_CHANGE=0 .venv/bin/python -m guardian run`: a code change is then a loud alert, not a lockdown
(forged payments, canaries and the rest still lock). Seal, and drop the flag, before the demo.

The hub mounts `/api/guardian/*` (restart the hub once after pulling this). The voice server serves
`GET /voice/guardian/status` and `POST /voice/guardian/unlock` to the Kairos app with the phone key (restart it too).

## How the pieces fit

```
 agents ──▶ hub event log (hub_seq) ──▶ Guardian process (separate; its own device, capability "guardian")
 letter reader, Navigator,              │  Invariants · canaries · Sentinel · Integrity · Rhythm
 phone/laptop hands, voice              ├─▶ guardian.alert / guardian.lockdown / guardian.heartbeat  (back into the hub, class vault)
                                        ├─▶ data/guardian.lockdown   ◀── read by navigator/policy.py and voice/token_server.py before any money or hands task
                                        ├─▶ data/guardian_status.json ◀── served to the phone as /voice/guardian/status (the Shield card)
                                        └─▶ data/vault.db (+ .head)   ◀── baseline, canaries, derived facts; Ed25519 checkpoints the phone can verify
```

Decisions are code, never a model. The one optional model call (`Sentinel.second_opinion`) uses a *different* model
from the one that wrote the text, and can only add a warning, never remove one.

## The red team (for the stage)

```bash
.venv/bin/python -m guardian attack                 # ten attacks, in-process, nothing needed
.venv/bin/python -m guardian attack forge --live    # against the running hub + Guardian on this Mac
.venv/bin/python -m guardian attack reset --live    # restore the edited file, the vault row, unlock, re-seal
```

| Attack | What the Guardian does |
|---|---|
| A letter whose small print gives Kairos orders | Sentinel flags the text in; the model's output may not add an account, phone number or link the letter didn't have; otherwise it is never spoken |
| "Hi Mum" transfer at 2 a.m. to a new payee | Unusual for *this* person (new payee, night, secrecy, the Hi-Mum pattern) → stop, payments paused, call-back advice |
| Scam letter read, then a payment to someone new | Critical: the exact ending of these scams; payments paused |
| A forged `money.sent` with no approval | Critical: payments and hands locked |
| A payment to the canary payee | Critical: something other than the person is driving the agents; everything locked |
| A helper reads out a one-time code | High: hands paused |
| The hands device writes a money record | High: an agent off its rails |
| A device joins mid-payment | High: payment paused |
| `navigator/policy.py` edited on disk | Critical: code changed since sealed; everything locked until re-sealed |
| A byte flipped in the vault | Critical: the chain doesn't add up; everything locked |

## What it deliberately doesn't do

- Never asks for, reads out or types a PIN, password or one-time code.
- Never says "this is safe". It says what it checked and what it couldn't.
- Never acts on words found in a letter, a notification or a screen.
- Never decides money with a model. Models classify and explain; code decides.
- Never leaves the person stuck: a lockdown has one plain reason and one button (Face ID) to lift it.

## Honest limits

A lockdown stops the Navigator and the hands; it can't stop the person tapping their own bank app. The Guardian runs on
the hub computer, so an attacker with full control of that computer and its root key can forge everything there. What
they can't do is make the phone's pinned copy of the vault's public key accept a rolled-back history. The next step is
the phone countersigning each checkpoint with its Secure Enclave key.
