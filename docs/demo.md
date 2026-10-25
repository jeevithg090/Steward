# Demo runbook

Everything below works with **no keys and no network** (replay mode). Live vendors are switched on
one at a time as their keys arrive (`make doctor` shows which are ready).

## The chat beats (plan.md §6, about two minutes)

`make demo` starts the Gateway from a scratch folder on 8000 (replay mode, no keys, `TEMPO_DEMO=1`),
seeds the demo's people and opens the web app on <http://localhost:3000>. The chat is the front
door, every page is in the sidebar, and the badge at the top says **REPLAY data · SIMULATED
company, rail data, jurors, vision**. Sample chips carry every beat, so nothing needs typing.

1. **Type** (or say, with the mic): *my 08:12 Oxford to Paddington was 38 minutes late on 23 October, ticket £28.40* (the replay data records the 08:12 on 22 and 23 October only, so say the date).
   Tempo understands, finds the delay, prices it from the rule pack and asks once: the consent card
   with the Proof Trace (38 min → 50% of £28.40 under GWR DR15, with the published source) and the
   Court's three votes, inline. Leave the fare out and it asks one question, never guesses.
2. **Yes, claim £14.20.** Filed once; the mission waits for the money, not for a webhook.
3. **Mission Control** (sidebar): the timeline with latencies, the Proof Trace, the Court, the
   Passport card. Press **Check the payment now** (or let the scheduler do it within 30 s).
4. **Money arrived**, and the ledger ticks: hours and pounds returned, counted only once the money
   is there.
5. Back in the chat: **what do you remember?** The Memory Card: her own words, each with its
   source, date and trust. *Forget* removes one everywhere; company text never becomes a memory.
6. **Paste the HMRC text** ("You are due a tax refund… confirm within 24 hours"). Tempo warns in
   plain words and says why; the Scam Shield page has the log, the link findings and six languages.
7. **Read this letter** → the sample letter (a water overpayment): what it is, what it says, who
   owes what, what to do by when, the clocks it starts. Say a reply and get a plain draft that adds
   no facts.
8. **The broadband card** in Mission Control: the missed engineer visit priced at £32.31, and the
   Rights Portfolio says **Waiting, on purpose**, with the date and the odds. **Demo: jump ahead
   31 days** flips it to acting and the money arrives. The other ending: **Demo: the credit
   arrives** first, and nobody calls.
9. **The Passport card** on the mission: what Tempo may and may not do for her, the amount, the
   expiry, what the company checked and what it refused. **STOP** in the chat revokes it everywhere.
10. **Who's calling?** Margaret, Dilip and Joan: language, pace, voice, the words the voice agent is
    given, and the memories behind them.

`make showcase` runs the same app with no Gateway, on recorded replies; the badge then reads
**SHOWCASE · recorded replay · no Gateway**.

## Tempo's real voice (optional)

Without a key, the browser's own voice reads every reply and the face still moves. For ElevenLabs,
put the key in the demo's scratch folder, outside the repo, where `make demo` reads it:

```bash
printf 'ELEVENLABS_API_KEY=%s\n' '<your key>' > ../.tempo-demo/.env && chmod 600 ../.tempo-demo/.env
```

Then `scripts/demo.sh --stop` and `make demo` again; Settings shows **Gateway voice on**. The key
stays on the Gateway (`POST /voice/tts`); it never reaches the browser and never goes on Vercel.
Tempo uses ElevenLabs' premade voices (Sarah for Tempo, George for the lower voice), which work on
the free plan; the older library voices are refused there with 402. The free plan has 10,000
characters a month: a full rehearsal speaks a few thousand, repeated sentences come from the
Gateway's cache, and when the quota runs out the browser's voice takes over by itself. The script
refuses a `.env` there that sets `DATABASE_URL`.

## Before the demo

```bash
make setup                         # once: uv sync, hooks, npm ci in apps/web
make demo-rehearsal                # three text dry runs; all must pass
make demo                          # Gateway (scratch folder, 8000) + seed + web app (3000)
```

`make demo` runs `scripts/demo.sh`: it never starts the Gateway from inside the repo (whose `.env`
may point `DATABASE_URL` at a hosted database) but from `../.tempo-demo/`; it reuses a Gateway that
already answers on 8000, seeds once (`scripts/seed.py`), and stops what it started on Ctrl-C.
`make demo-gateway` starts and seeds only the Gateway; `scripts/demo.sh --stop` ends it.

For the kill-and-resume drill below the Gateway needs a database:

```bash
createdb tempo_demo                # or Tiger Data / any Postgres with pgvector
DATABASE_URL=postgresql+asyncpg://<user>@localhost:5432/tempo_demo make db-migrate
make doctor                        # Postgres: SELECT 1, pgvector available
```

Then start the Gateway by hand from a scratch folder with that `DATABASE_URL`, `TEMPO_API_TOKEN`,
`TEMPO_DEMO=1` and `PAYMENT_CHECK_AFTER_S=0` exported, seed it with `TEMPO_API_TOKEN=<same> make
seed`, and start the web app with `cd apps/web && npm run dev`. Amir's claim is already paid (the
counters show real hours and pounds); Margaret's claim and broadband case are waiting for her OK;
her memories and timeline are in place (demo mode only; her words still go through the Memory
Gate).

## The beats, page by page (the long form)

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

6. **Two screens, one Tempo** (Tempo Mesh, the **Devices** page `#/devices`). On the phone:
   "Use this browser for approvals", then "Add Face ID or fingerprint". "Add another device" shows a
   QR code; open it on the laptop (it lands on `#/pair`), and both show the same 6-digit code: press
   "Yes, the codes match". Start Margaret's claim, then press "Yes, claim £14.20 with Face ID" on the
   phone: the question disappears from the laptop at the same moment (115 to 170 ms in the e2e run).
   Once a browser has Face ID, the Gateway refuses unsigned answers for Margaret, and a typed "yes"
   in the chat asks for Face ID instead. Pushes carry no details, only "sync" (they need a VAPID key).
   WebAuthn needs https or localhost; open the web app at http://localhost:3000, not 127.0.0.1.

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

9. **Agent Passport: who says you can act for her?** The new UI shows the Passport card on the
   mission with a Gateway-signed mandate; Face ID signing needs the Mesh client (step 6). With Face
   ID set up there, press "Sign a mandate with Face ID" on the mission. The card shows the company, what Tempo may and may not do,
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
