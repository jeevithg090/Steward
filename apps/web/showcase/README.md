# Showcase fixtures

Recorded responses from a real **replay-mode Gateway, with no keys** (`TEMPO_MODE=replay`,
`TEMPO_DEMO=1`, `PAYMENT_CHECK_AFTER_S=0`, in-memory store, no `.env`), so Mission Control and
the other pages can run on Vercel with no backend (SHIPPING.md §4.6). `lib/showcase.ts` serves
them and walks Margaret's missions through these states in memory as the buttons are pressed.

- `recorded_at`: 2026-10-25T00:29–00:31+01:00 (clock advanced to +31 days for the last Ofcom files)
- `source`: replay-mode Gateway, no keys, started with
  `uvicorn tempo_gateway.main:build --factory` on 127.0.0.1:8010 from an empty folder; seeded
  with `scripts/seed.py` (Amir paid, Margaret's claim and broadband case waiting, her memories,
  the three Patience Profile callers); driven with curl and the bearer.
- Everything the badge says was simulated really was: company, rail data, jurors, vision.

| File | Route and moment |
|---|---|
| `health.json`, `health-clock31.json` | `GET /health` at start and after `POST /demo/clock {advance_days: 31}` |
| `missions.json`, `missions-final.json` | `GET /missions` after seeding, and after everything below |
| `ledger*.json` | `GET /ledger` after seeding (Amir paid), after Margaret's rail claim paid, after the broadband credit, final |
| `mission-amir-verified.json` | Amir's 07:58, 64 min late, claimed and paid by the seed |
| `mission-rail-awaiting_consent.json` → `-waiting.json` → `-verified.json` | Margaret's 08:12: `POST /missions` → `POST /approvals/{request_id}` (yes) → `POST /scheduler/tick` → `GET /missions/{id}` |
| `mission-ofcom-awaiting_consent.json` → `-waiting.json` → `-waiting-acting.json` → `-verified.json` | Margaret's missed engineer visit with its Rights Decay `plan`: approve (waits on purpose) → `POST /demo/clock` +31 days (plan flips to acting, complaint made) → tick → paid |
| `mission-ofcom2-*.json` | The other ending: a second broadband case where `POST /demo/credit/{id}` arrives before the clock jump; the jump finds it paid and nobody calls |
| `tick-*.json`, `clock-advance-31.json`, `credit-ofcom2.json` | The raw replies to those POSTs |
| `read-card.json` | `POST /missions/ofcom/read` with `public/demo/missed-visit-card.png`: vision's facts and the one read-back question |
| `memories-u_margaret.json`, `privacy-u_margaret.json` | `GET /memories`, `GET /privacy` for Margaret |
| `voice-profile-u_{dilip,joan,margaret}.json` | `GET /voice/profile` for the three Patience Profile callers |
| `catalog.json` | **Generated**, not recorded: `pnpm catalog` reads `profiles/*.yaml` and `skills/*/skill.yaml` (`scripts/build-catalog.mjs`) |
| `letters.json` | Read It To Me: the two readings recorded from `POST /letters/read` (replay vision), copied from `fixtures/letters/*.reading.json`: a Thames Water overpayment and a council-tax reminder |

Timestamps inside the files are from the recording night; the showcase badge says so.
Regenerate by following the recipe in the Track 3 brief (never start the Gateway from inside
`tempo/`, whose `.env` points at a hosted database).
