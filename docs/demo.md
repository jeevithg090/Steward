# Demo runbook

Everything below works with **no keys and no network** (replay mode). Live vendors are switched on
one at a time as their keys arrive (`make doctor` shows which are ready).

## Before the demo

```bash
make setup                         # once
make demo-rehearsal                # three dry runs; all must pass
createdb tempo_demo                # or Tiger Data / any Postgres with pgvector
echo 'DATABASE_URL=postgresql+asyncpg://<user>@localhost:5432/tempo_demo' >> .env   # or the provider's postgres://...?sslmode=require
make db-migrate                    # reads DATABASE_URL from .env
make doctor                        # Postgres: SELECT 1, pgvector available
```

Start the Gateway and Mission Control in two terminals:

```bash
TEMPO_API_TOKEN=<pick-one> TEMPO_DEMO=1 PAYMENT_CHECK_AFTER_S=0 uv run tempo-gateway
cd apps/web && NEXT_PUBLIC_TEMPO_TOKEN=<same> pnpm dev     # http://localhost:3000
```

Then seed the people: `TEMPO_API_TOKEN=<same> make seed`. Amir's claim is already paid (the
counters show real hours and pounds); Margaret's is waiting for her OK, and her memories and
timeline are in place (demo mode only; her words still go through the Memory Gate).

## The beats (text demo, about 90 seconds)

1. **The question.** Margaret's 08:12 Oxford to Paddington arrived 38 minutes late. Mission
   Control shows Tempo's one question, the Proof Trace (38 min → 50% of £28.40 under GWR DR15,
   with the published source), and the Consensus Court's three votes.
2. **The yes.** Press "Yes, claim £14.20" (on the phone: SMS `YES`, or say yes to the voice agent).
3. **The wait.** The mission waits for the money, not for a webhook: it sleeps in its checkpoint.
   Press "Check the payment now" (or let the scheduler do it within 30 s).
4. **The proof.** "Money arrived", the ledger ticks up, and the timeline shows how long each stage
   took, including how long Margaret took to decide.

5. **It remembers you, and when.** The Memory Card shows what Tempo knows about Margaret, each
   line with where it came from and when. Its timeline shows the Broadbandly engineer visit that
   moved (12 Oct struck through, 19 Oct now) and yesterday's promise of £73.67, ref BB-4417
   (seeded by `make seed`). Text `MEMORY` to hear
   it, `FORGET <thing>` to delete it everywhere. A company email that says "customer prefers
   vouchers" never becomes a memory: the Memory Gate keeps it as evidence only.

6. **Two screens, one Tempo.** On the phone: "Use this device for approvals", then "Add Face ID
   or fingerprint". "Add another device" shows a QR code; scan it with the laptop and both show
   the same 6-digit code. Approve on the phone with Face ID and the question disappears from the
   laptop at the same moment (about 0.1 s locally). Pushes carry no details, only "sync".

7. **Prove it.** The Privacy Proof panel lists, each checked by the Gateway: the deployment
   mode and any outside AI companies (none in Private mode), the running image against the
   signed allowlist, which device holds the key, and what an operator sees of a stored row
   (ciphertext). Say the gaps out loud: until the cosign key exists there is no signed
   allowlist, and the panel says so.

8. **Rights Decay: wait, on purpose.** Press "Read Margaret's missed-visit card". Vision reads the
   simulated Broadbandly card and asks one thing: "I read the date of the missed visit as 19
   October 2026. Is that right?" (its confidence is below 0.8 on purpose). Say yes. The Rights
   Engine prices £32.31, the Court votes, and the Rights Portfolio says **Waiting, on purpose**:
   the complaint only opens once Ofcom's 30-day payment window has passed, and about 30% of cases
   like this are paid without a fight by then. Approve. Then press "Demo: jump ahead 31 days"
   (the badge says DEMO CLOCK +31 DAYS): the plan flips to **Acting now**, Tempo complains once,
   and "Check the payment now" shows the money arriving. The other ending: press "Demo: the credit
   arrives" before jumping, and nobody calls.
   If a judge asks "why didn't it just call?", open **Why**: the odds, what an open problem costs
   her in time, and the nearest deadline. `make demo-rehearsal` runs this beat in text too.

9. **Agent Passport: who says you can act for her?** With Face ID set up (step 6), press "Sign a
   mandate with Face ID" on the mission. The card shows the company, what Tempo may and may not do,
   the amount and the expiry. When the company's line checks it (`POST /mandates/verify`, or the
   `verify_mandate` voice tool on the Arena verifier), each check appears under "What the company
   checked" with its reason and latency: a claim is allowed; "her mobile contract" is refused as
   out of scope; a forged mandate, even one signed with the forger's own passkey, is refused
   because Tempo only vouches for the exact mandate it issued. Text STOP: the card flips to
   revoked, and so does every company's answer.

10. **It speaks the way you asked.** `make seed` also creates three callers who told Tempo how
    they need to be spoken to; each line was read back and confirmed (the seed prints which).
    Open **Who's calling?**. **Dilip**: Hindi, slower (0.85×), his greeting in Hindi, and his
    stations as words it listens out for. **Joan**: a lower voice, slower, the question offered by
    text. **Margaret**: no voice change, but the words Tempo's agent is given: "This caller has a
    stammer. Never finish their words for them. Wait as long as it takes, and never rush them."
    Under each, **Because
    they said** lists their own words. Then text `FORGET slower` from Dilip's number (or press
    Forget on the Memory Card): the next call is back to normal speed, and the timeline strikes
    the old setting through. Say it: these are health-adjacent, so they are opt-in, dated,
    visible and forgettable, and the whole line is patient for everyone anyway.
    **Live:** set `SEED_PHONE_DILIP` and `SEED_PHONE_JOAN` to two teammates' numbers before
    `make seed`, run `make sync-voice` (it switches on the conversation-initiation webhook), and
    have them ring the Tempo number: one is answered in Hindi, slowly; the other in the lower
    voice. "Last call" appears on the panel as each call connects. Check it beforehand with
    `uv run python voice/sync.py --print tempo.inbound` and `make doctor`.

## Failure drills (run each once, then keep them in the dry run)

| Drill | Do | Expect |
|---|---|---|
| Kill the Gateway mid-mission | Start a mission, then `kill -9` the Gateway and start it again | The same question comes back (same request id); approve and it completes. Needs `DATABASE_URL` |
| Wi-Fi drops | Run with `TEMPO_MODE=replay` (the default) | Nothing changes: rail data, jurors and the company are all replayed |
| A juror times out | Live mode with one Cortex model unavailable | "juror absent", the other two must agree, the result is flagged |
| The voice call fails | ElevenLabs error | Fall back to the web or SMS approval; the mission doesn't care how the yes arrives |
| The initiation webhook is unreachable | Stop the Gateway's tunnel, then ring in | Expected: the call goes ahead on the agent's defaults (English, patient); ElevenLabs doesn't document this, so confirm it once with live keys. `make doctor` names the gap |
| A duplicate approval | Send the same SMS `YES` twice, or press Yes twice | Claimed once (idempotency keys; Twilio retries are ignored) |

## Say these out loud (honesty)

- Rights Decay's clocks are demo values until a person checks each cited page. Its curves are
  NYC housing repairs standing in for UK companies; the share of closures that pay is the FCA's
  real UK figure (53% upheld, H1 2026). Per-case timing is weak (AUC about 0.6): the planner uses
  the curve's shape, not a per-case score.
- The demo clock only moves in demo mode, only forward, and the badge says when it has.
- A mandate's passkey is self-certifying: a company learns that the key Tempo enrolled signed it,
  and that Tempo issued exactly this mandate. A directory or attestation issuer is the roadmap. A
  landline mandate is Gateway-attested, which is weaker, and the card says so.

- The badge at the top says what's real: **REPLAY data · SIMULATED COMPANY · JURORS**. The rail
  journeys, the company and the jurors' verdicts are synthetic until the team's keys are in.
- Rule packs say "demo values" until each band is checked against the operator's published terms.
- The amount always comes from the rules, never from a model; the jurors can only say no or ask
  you, and they never change the number.
- Nothing is filed without a signed yes, and "STOP" stops everything.
