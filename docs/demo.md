# Demo runbook

Everything below works with **no keys and no network** (replay mode). Live vendors are switched on
one at a time as their keys arrive (`make doctor` shows which are ready).

## Before the demo

```bash
make setup                         # once
make demo-rehearsal                # three dry runs; all must pass
createdb tempo_demo                # or any Postgres; Docker: docker compose up -d postgres
export DATABASE_URL=postgresql+asyncpg://<user>@localhost:5432/tempo_demo
make db-migrate
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

## Failure drills (run each once, then keep them in the dry run)

| Drill | Do | Expect |
|---|---|---|
| Kill the Gateway mid-mission | Start a mission, then `kill -9` the Gateway and start it again | The same question comes back (same request id); approve and it completes. Needs `DATABASE_URL` |
| Wi-Fi drops | Run with `TEMPO_MODE=replay` (the default) | Nothing changes: rail data, jurors and the company are all replayed |
| A juror times out | Live mode with one Cortex model unavailable | "juror absent", the other two must agree, the result is flagged |
| The voice call fails | ElevenLabs error | Fall back to the web or SMS approval; the mission doesn't care how the yes arrives |
| A duplicate approval | Send the same SMS `YES` twice, or press Yes twice | Claimed once (idempotency keys; Twilio retries are ignored) |

## Say these out loud (honesty)

- The badge at the top says what's real: **REPLAY data · SIMULATED COMPANY · JURORS**. The rail
  journeys, the company and the jurors' verdicts are synthetic until the team's keys are in.
- Rule packs say "demo values" until each band is checked against the operator's published terms.
- The amount always comes from the rules, never from a model; the jurors can only say no or ask
  you, and they never change the number.
- Nothing is filed without a signed yes, and "STOP" stops everything.
