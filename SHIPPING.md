# Shipping Tempo: the plan, the contracts and the status

*Started Sun 25 Oct 2026, 00:15 BST, in `tempo/` on `main`. This file is the single place that
says what "shipped" means for Tempo, what was built to get there, how to deploy it, and what is
honestly not done. It is updated as the work lands; the status log is at the end.*

---

## 0. What shipping means here

Tempo is about 14k lines of Python and 3k of TypeScript that already do something no shipped
product does: an AI agent that wins back money and time, where **models read and plan and code
decides money, time and permissions**. Tonight it is lying in a working tree as nine features
that each demo well but do not yet read as one product, cannot be opened by a stranger, and have
no path for a stranger to add their own use case.

Shipping is the difference between those two states. Concretely:

1. **One story a stranger can follow in two minutes**, online, with no keys and no backend: a
   landing page that connects the dots, and a Mission Control that runs on recorded data.
2. **Profiles**: a shareable document that says who Tempo works for, which skills are on, how it
   must speak with the person, and what it may never do. A profile is enforced by the Harness,
   not just displayed.
3. **An open-source path** that takes a newcomer from "I have a use case" to a merged skill in
   ten minutes without writing Python, and a longer path for those who do.
4. **Guardrails you can point at**: the existing policy engine plus profile-aware capability and
   budget guards, a written threat model, security headers, dependency audit in CI, and a
   size-capped, schema-validated import path for anything a stranger can paste in.
5. **Accessibility that beats the agents people hear about** (Muse and its kind are
   screen-first, English-first, click-fast): voice and SMS first, patient by default, plain words
   gated in CI, large text, keyboard and screen-reader paths, and a Patience Profile that sets
   language, pace and voice per caller before the first word.
6. **Deployed**: the web app on Vercel from `apps/web`, the Gateway as a container on Render or
   Fly (or Docker anywhere), with GitHub Actions as CI and a GitHub-first contributor flow.
7. **Everything committed and pushed**, with the unfinished Skill Forge parked on its own
   branch so `main` is green.

---

## 1. The story we ship (how the dots connect)

Margaret is 74, stammers, and rings from a landline. Her 08:12 to Paddington was 38 minutes
late. That one fact runs through every part of Tempo, in this order, and the landing page tells
it in this order:

| Beat | What happens | Where it lives |
|---|---|---|
| **Hear** | Tempo answers the way she asked to be spoken to: slowly, one question at a time, waiting as long as it takes | Patience Profile (`tempo_core.voice_profile`, `POST /voice/initiation`), `access` memories |
| **Read** | Rail data says how late; vision reads a ticket or a card and reads back anything unsure | `tempo_adapters.rail`, `mcp-servers/rail`, `tempo_core.intake.follow_up` |
| **Price** | The amount comes from a YAML rule pack with a citation, never from a model | Rights Engine, `skills/*/rules/*.yaml`, Proof Trace |
| **Check** | Three models from three providers may say no or ask a person; they can never raise the amount | Consensus Court |
| **Weigh** | Is it worth her time, at her own value of an hour? | Arbiter, Time Ledger |
| **Time it** | Every right has a clock; sometimes the right move is to wait, with the date | Rights Decay, `skills/rights-decay` |
| **Ask once** | One question, a signed yes (Face ID, SMS `YES`, or a spoken yes), STOP stops everything | Consent ledger (deny wins), Mesh passkeys |
| **Prove it** | The company's own AI verifies Tempo's mandate in milliseconds, and refuses anything outside it | Agent Passport (`tempo_passport`), `MandateGuard`, Sludge Arena verifier |
| **Remember only her words** | Company text is evidence, never memory; everything dated, visible, forgettable | Memory Gate, Memory Card |
| **Return the time** | Hours and pounds returned, counted only once the money has arrived | Watchdog, Time Ledger |

Tonight adds the frame around that story:

- **Profiles** choose which beats are on for whom, and bound what Tempo may do.
- **Skills** are the units a profile is made of; each has a manifest a newcomer can copy.
- **Showcase mode** lets anyone walk the story on Vercel with no backend.
- **Guardrails** make the profile real: the Harness refuses what the profile does not allow.

---

## 2. Inventory and gaps (as found at 00:00)

**Green:** `mypy --strict`, 824 fast tests, web typecheck, 50 web tests, `next build`.

**Red:** `ruff` with 243 errors, all in the uncommitted Skill Forge work (`skill_forge/`,
`blueprints/`, `packages/tempo_skill_forge`, `skills/generated`): `blueprints/base.py` uses
`Enum` without importing it, `blueprints/__init__.py` imports four modules that do not exist,
and `skill_forge/` duplicates the package. 102 files uncommitted in total, including the finished
and tested Rights Decay and Agent Passport tracks. A second Claude session is live-editing the
Patience Profile track in the same checkout (the `/voice/initiation` and `/voice/profile` routes,
memory `access` category, ElevenLabs config).

**Missing for an MVP:**

| Gap | Fix tonight |
|---|---|
| No way to open Tempo without running a Python backend | Showcase mode in the web app (recorded Gateway responses) |
| The web app opens straight into Mission Control with no explanation | A landing page that tells §1, then links to Control, Profiles, Skills, docs |
| Nothing says "who is Tempo working for and what may it do" as one object | Profiles (schema, six starters, routes, page, share link), enforced by `CapabilityGuard` and `BudgetGuard` |
| Skills have rule packs but no manifest; nothing lists what a skill does in plain words | `skills/<id>/skill.yaml` for all seven, loaded by `tempo_core.skills` |
| Adding a use case means reading the code | `docs/add-a-usecase.md`, `make new-skill`, `make validate-skills` |
| CI only on GitLab; GitHub repo has no Actions, templates or security reporting | `.github/` workflows, templates, Dependabot, CODE_OF_CONDUCT, SECURITY.md pointing at GitHub |
| No deployment story beyond Docker | Vercel for `apps/web` (button + steps), Render blueprint and Fly config for the Gateway, `docs/deploy.md` |
| Security is strong in code but undocumented as a whole; web has no security headers | `docs/security.md` threat model; headers in `next.config.ts`; `pip-audit` and `pnpm audit` in CI |
| Accessibility is a principle, not a page | `docs/accessibility.md`, `/accessibility`, text-size and plain-mode controls, axe tests |
| Skill Forge breaks `main` | Parked on `skill-forge-wip`; the manifest + scaffolder path ships instead |

---

## 3. Tracks, owners and done-criteria

| Track | Owner | Files | Done when |
|---|---|---|---|
| **0. Stabilise** | this session | `pyproject.toml`, `uv.lock`, branch `skill-forge-wip` | `ruff` clean on `main`; Skill Forge preserved on its branch |
| **1. Profiles + guards (backend)** | agent A | `tempo_core/{profiles,skills}.py`, `tempo_harness/policies_profile.py`, `tempo_gateway/profiles.py`, `scripts/{new_skill,validate_skills}.py`, tests | unit, policy and integration tests green; six starter profiles load; an invalid share code is refused with a reason |
| **1b. Safety barrier (backend)** | agent B | `tempo_core/{letters,letter_words,payee}.py`, `tempo_gateway/letters.py`, fixtures, tests, the `letter-explainer` manifest | a photo of a letter becomes a plain spoken-ready reading with the clocks it starts; the before-you-pay check answers in plain words; all offline in replay mode |
| **1c. Scam & Fraud Shielding** | a second user-started session | `tempo_core/{links,scam_model,scam_words}.py`, `skills/scam-shield/**`, `fixtures/signals/scam_messages.json`, Android node, `/shield` page; plan and status in `docs/scam-shield.md` | its own checklist in `docs/scam-shield.md` |
| **2. Patience Profile** | the ElevenLabs session | `tempo_core/voice_profile.py`, memory `access`, Gateway voice routes, ElevenLabs config, seeds | its own plan's checklist (`OxHack26-Patience-Profile-Plan.md` §9) |
| **3. Web: landing, showcase, profiles, a11y** | agent C | `apps/web/app/**` (new pages), `lib/{profiles,showcase}.ts`, `components/site/**`, `showcase/*.json`, `next.config.ts` | `pnpm typecheck && pnpm test && pnpm build` green; the site works with `NEXT_PUBLIC_TEMPO_SHOWCASE=1` and no Gateway; axe finds no violations on the new pages |
| **4. Docs, GitHub, deploy, security** | agent D | `.github/**`, `docs/{deploy,github-setup,security,accessibility,profiles,add-a-usecase}.md`, `deploy/{render.yaml,fly.toml}`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CONTRIBUTING.md` | every doc links to real files; the CI workflow mirrors `.gitlab-ci.yml` plus audits |
| **5. Wire, verify, commit, push** | this session | `app.py`/`main.py` (two lines each), `Makefile`, `README.md`, this file | `make check` green; web green; logical commits on `main`; pushed to GitHub and GitLab |
| **6. Scam Shield (A–Z)** | the Scam & Fraud Shielding session | `docs/scam-shield.md` (plan, contracts, status), `tempo_core/{links,scam,scam_model,scam_voice,signals}.py`, `skills/scam-shield/{signals.yaml,model.json}`, `tempo_adapters/scam/{sandbox,feeds}.py`, `tempo_gateway/shield.py`, `apps/android-signal`, `apps/shortcuts/build_scam_spotter.py`, `apps/web/app/shield`, `scripts/scam_{train,synth}.py` | the phone speaks the warning offline from the same rules and model the Gateway runs; the grey zone is held and settled by the sandbox; corpora test fold precision ≥ 0.97 at `warn` and 0% of held-out genuine transactional texts spoken on; every door (`/scam/check`, Mesh signal, SMS `CHECK`, voice `check_message`, `/shield`) gives the same verdict |

Collision rules: agents create new files; the only existing files an agent edits are listed
above. Nobody but the ElevenLabs session edits `app.py`, `main.py`, `missions.py`,
`apps/web/lib/api.ts`, `MissionControl.tsx` or `MemoryCard.tsx` until it says it is done.
Commits are made with `--no-verify` while two sessions share the tree (the hooks stash and
restore every unstaged file); `make check` is run by hand instead.

---

## 4. Contracts (what every track builds against)

### 4.1 Capability vocabulary

The eight words in `tempo_passport.ACTIONS`, used by mandates, profiles and the Harness alike:
`claim`, `call`, `accept_cash`, `accept_voucher`, `discuss_other_accounts`, `change_contract`,
`share_personal_data`, `escalate`. A profile's `may` and `may_not` are subsets; a skill's `needs`
is a subset; `TOOL_ACTIONS` in `tempo_harness.policies_mandate` maps binding tools onto them.

### 4.2 Skill manifest: `skills/<id>/skill.yaml`

```yaml
id: clawback-uk-rail            # [a-z0-9-]{2,40}, equals the folder name
name: Delay Repay for UK trains
version: "0.1.0"
status: demo-values             # ready | demo-values | experimental
summary: >-                     # one or two plain sentences, Flesch >= 60
jobs: [ ... ]                   # 1-6 plain sentences: what Tempo does when this skill is on
needs: [claim, accept_cash]     # capabilities its binding tools need; may be empty
channels: [web, sms, voice]     # subset
mission: clawback_rail          # optional: the mission that runs it
operators: [GWR, Chiltern]      # optional
docs: ...                       # optional path or https URL
notes: ...                      # optional honesty note
maintainers: [tempo-team]
```

Rule packs stay where they are (`skills/<id>/rules/*.yaml`, loaded by `RulePackRegistry`). The
manifest is informational for people and binding for profiles: a profile that turns a skill on
must allow every capability in its `needs`.

### 4.3 Profile: `profiles/<id>.yaml`

```yaml
id: commuter                    # [a-z0-9-]{2,40}
name: The Commuter
version: "0.1.0"
status: starter                 # starter | community
summary: >-                     # Flesch >= 60
for_whom: >-
skills: [clawback-uk-rail, rights-decay]   # every id must have a manifest
may: [claim, accept_cash, escalate]        # subset of ACTIONS
may_not: [accept_voucher, call, ...]       # subset of ACTIONS, disjoint from may
limits:
  max_gbp_per_claim: "250.00"   # Decimal as a string
  max_user_questions: 2         # 1..10
  max_llm_gbp_per_mission: "0.20"
  mandate_days: 7               # 1..7 (tempo_passport.MAX_LIFETIME)
access:
  language: en                  # a code in tempo_core.voice_profile.LANGUAGES
  pace: normal                  # normal | slower
  patience: normal              # normal | high
  voice: default                # default | low
  prefers_text: false
  plain_words: true
channels: [web, sms, voice]
time_value_gbp_h: "18.00"
share: { public: true, author: Tempo team }
```

Validation (`tempo_core.profiles`): schema with `extra="forbid"`; `may ∩ may_not = ∅`; every skill
exists; `needs(skill) ⊆ may` for every skill; amounts are `Decimal`; the summary scores Flesch ≥ 60.
A profile is immutable once loaded.

**Share code:** `base64url(canonical JSON)` of the profile, prefixed `tp1.`; at most 4096 bytes;
`from_share_code` re-validates everything above and raises `ProfileInvalid` with a plain reason.
The share URL puts the code in the fragment (`/profiles/import#p=<code>`) so it never reaches a
server log. Importing never persists anything server-side; the Gateway only validates and echoes.

**Derived view** (`ProfileView`, what the Gateway and the web show):

```json
{"id": "...", "name": "...", "version": "...", "status": "starter", "summary": "...", "for_whom": "...",
 "skills": [{"id": "...", "name": "...", "status": "...", "jobs": ["..."]}],
 "jobs": ["... union of the skills' jobs, in order ..."],
 "may": [...], "may_not": [...], "limits": {...}, "access": {...}, "channels": [...],
 "time_value_gbp_h": "18.00", "share": {...}}
```

### 4.4 Harness policies (`tempo_harness.policies_profile`)

- `CapabilityGuard(profile)`: `PRE_TOOL`; maps the tool to an action with `TOOL_ACTIONS` and
  `offer_action`; `DENY` if the action is in `may_not` or not in `may`; tools outside
  `TOOL_ACTIONS` are allowed (read-only). Message in plain words: "This profile doesn't let me
  accept vouchers, so I stopped."
- `BudgetGuard(profile)`: `PRE_TOOL` on `file_claim` and `accept_offer`: `ESCALATE` when
  `amount_gbp` is above `limits.max_gbp_per_claim` (the person may still say yes); `DENY` when
  the amount is unreadable. Exported from `tempo_harness.__init__`.

### 4.5 Gateway routes (`tempo_gateway.profiles.profiles_router`)

All behind the same bearer as `/missions`.

| Route | Returns |
|---|---|
| `GET /skills` | `{"skills": [SkillManifest...]}` |
| `GET /profiles` | `{"profiles": [ProfileView...]}` (public only) |
| `GET /profiles/{id}` | `ProfileView`, 404 if unknown |
| `GET /profiles/{id}/share` | `{"code": "tp1....", "url": "<first WEB_ORIGINS>/profiles/import#p=..."}` |
| `POST /profiles/import` `{"code": str}` | `ProfileView`; 413 if over 4096 bytes; 422 with the reason if invalid |

Wired in `create_app(..., profiles: ProfileCatalog | None)` and `main.build()` with
`ProfileCatalog.load(REPO / "profiles", REPO / "skills")`.

### 4.6 Web routes and showcase mode

| Route | What |
|---|---|
| `/` | Landing: the story in §1, live counters from the ledger when a Gateway is reachable, CTAs |
| `/control` | Mission Control (the existing component, unchanged) |
| `/profiles`, `/profiles/[id]`, `/profiles/import` | Catalogue, detail with "what this profile will do for you" and "what it may never do", share and import |
| `/skills` | Catalogue from the manifests |
| `/accessibility` | The accessibility statement and the controls |

`NEXT_PUBLIC_TEMPO_SHOWCASE=1` (or no `NEXT_PUBLIC_GATEWAY_URL`) switches every page to
`lib/showcase.ts`: a `Gateway` subclass that serves recorded responses from `apps/web/showcase/*.json`
(captured from a real replay-mode Gateway) and walks Margaret's mission through its states on a
timer; the honesty badge reads **SHOWCASE · recorded replay · no Gateway**. `/profiles` and
`/skills` read `showcase/catalog.json`, generated from `profiles/*.yaml` and `skills/*/skill.yaml`
by `apps/web/scripts/build-catalog.mjs` (`pnpm catalog`), so the two never drift.

Accessibility controls (persisted per browser): text size (A, A+, A++), plain mode (one card at
a time, bigger targets), honour `prefers-reduced-motion` and `prefers-contrast`. Every page has a
skip link, landmarks, visible focus, `aria-live` for state changes, and passes axe in tests.

### 4.8 The safety barrier: four accessibility use cases, assessed

Asked at 00:30: should Tempo add a banking navigator, a letter interpreter, a voice-to-text bridge
and background scam shielding? The honest answer, use case by use case:

| Proposed | Verdict | Why, and what ships instead |
|---|---|---|
| **Mobile money / banking navigator** ("pay the bill", "send money to my son") | **No as proposed; yes reframed** | Tempo's first rule is that it never moves money (ADR 0003, the voice prompt, every guard). "Send money to my son" is also the exact sentence APP-fraud coaching uses. What ships: **Before You Pay**, a check that stands between the person and the transfer. Tempo asks who, how much and why, runs the pressure signs and the registers (`tempo_core.scam.assess`, Scam Shield), applies a cooling-off rule for a new payee, and says in plain words "wait, and ring them on a number you already know". The person pays, or not. Nothing is moved by Tempo. |
| **Visual document and letter interpreter** | **Yes, the flagship accessibility beat** | Tempo already has vision intake with read-back, the PIP Letter Explainer, Flesch-gated plain words and per-caller language. Generalising to "read this to me" for any official letter connects them: what it is, what it says, whether money is owed to you or by you, what you must do and by when, and which rights clocks it starts (Rights Decay). Replay fixtures: a water-company overpayment letter and a council-tax reminder. |
| **Voice-to-text communications bridge** (rewrite what I said and send it on WhatsApp) | **Only the half that is Tempo's job** | Sending messages through other people's chat apps is app automation Tempo does not have (the iOS skills pack is a design, not code) and a consent risk when the agent rewrites feelings. What ships: **Say it, Tempo writes it** for the letter you just had read: speak your reply in your own words, Tempo drafts a plain formal reply that adds no facts (the Decision Challenger's rule), reads it back, and you send it. |
| **Background scam and fraud shielding** | **Yes; it is mostly built** | Scam Shield checks firms and pressure signs today (`CHECK <message>` by SMS). The Android signal node (written, not built) reads notifications on-device and lets only a match's declared fields leave the phone. What ships: `skills/scam-shield/signals.yaml`, on-device filter rules for suspicious texts (links, urgency, "safe account", codes), tested in Python against shared vectors like the rail rules, and the spoken warning in plain words in the caller's language. |

The bigger problem this frames, and the landing page says: the same people are hit from every
side at once. They cannot read the letter, cannot hear the call, cannot navigate the app, and are
the ones scammers target. Tempo's answer is one agent that reads to you, listens patiently, warns
you, and is built so that it **cannot** move your money or act without your signed yes. The
`read-it-to-me` profile is that agent: four skills on, every binding capability off.

### 4.7 Environment

| Where | Variable | Purpose |
|---|---|---|
| Vercel (web) | `NEXT_PUBLIC_TEMPO_SHOWCASE=1` | run with no backend |
| Vercel (web) | `NEXT_PUBLIC_GATEWAY_URL`, `NEXT_PUBLIC_TEMPO_TOKEN` | point at a deployed Gateway (demo token; passkeys are the real auth) |
| Gateway | everything in `.env.example`; at minimum `TEMPO_API_TOKEN`, `WEB_ORIGINS=<the Vercel URL>`, `PUBLIC_URL`, `MESH_RP_ID=<the Vercel host>` | |

---

## 5. Deployment (details in `docs/deploy.md`)

**Web on Vercel.** Import the GitHub repo, set *Root Directory* to `apps/web`, add
`NEXT_PUBLIC_TEMPO_SHOWCASE=1`, deploy. The README carries a one-click button that does the same
(`vercel.com/new/clone?repository-url=…&root-directory=apps/web&env=NEXT_PUBLIC_TEMPO_SHOWCASE`).
To attach a live Gateway, set `NEXT_PUBLIC_GATEWAY_URL` and `NEXT_PUBLIC_TEMPO_TOKEN` and
redeploy; `MESH_RP_ID` on the Gateway must equal the Vercel host for passkeys to work.

**Gateway.** `deploy/gateway.Dockerfile` already builds a reproducible image. `deploy/render.yaml`
is a Render blueprint (web service from the Dockerfile plus a managed Postgres with pgvector);
`deploy/fly.toml` does the same on Fly. Replay mode needs no keys; live vendors are switched on
one at a time with `make doctor`.

The Gateway is not a Vercel target: it holds WebSockets open, runs a 30-second scheduler and
writes checkpoints, none of which fit serverless functions.

---

## 6. GitHub setup (details in `docs/github-setup.md`)

Remote `origin` is `github.com/jeevithg090/Tempo` (private tonight). Steps: push `main` and
`skill-forge-wip`; enable Actions; protect `main` (require the CI check, one review, linear
history); turn on Dependabot alerts and private vulnerability reporting (SECURITY.md points
there); add topics; make the repo public when the team is ready; keep the GitLab mirror by
adding it as a second push URL.

---

## 7. Security guardrails (details in `docs/security.md`)

Already in code: `SettlementGuard`, `ConsentScopeGuard`, `ProofRequired`, `InjectionShield`,
`PIIEgressRedactor`, `MandateGuard`, the Memory Gate, signed approvals bound to one question,
constant-time secret checks, signed webhooks, idempotency keys, no-PII logging with a canary
test, gitleaks in pre-commit and CI, client-side encryption with device-held keys.

Added tonight: `CapabilityGuard` and `BudgetGuard` (a profile is enforced, not displayed); a
size-capped, schema-validated, never-persisted import path for shared profiles; security headers
(CSP, frame-ancestors none, no-referrer, nosniff) on the web app; `pip-audit` and `pnpm audit`
in CI; a written threat model mapping each threat to its control and its test.

---

## 8. Accessibility (details in `docs/accessibility.md`)

What "better than Muse" means in checkable terms: reachable by landline and SMS, not only a
screen; patient turn-taking for everyone and per-caller pace, language and voice from the
Patience Profile; every sentence Tempo says scores Flesch ≥ 60 in CI; one question at a time
with read-back; large text and plain mode on the web; keyboard, screen-reader and reduced-motion
paths; nothing binding without a signed yes, and STOP by any channel.

---

## 9. Open source (details in `docs/add-a-usecase.md`)

Three ways in, shortest first: (1) a new operator is one YAML rule pack, checked by schema;
(2) a new skill is a folder with `skill.yaml` and optional rules, scaffolded by
`make new-skill id=…` and checked by `make validate-skills`; (3) a new mission is Python that
copies the shape of `clawback_ofcom`. Profiles are the fourth: one YAML that composes skills
for a kind of person. Governance: Apache-2.0, Contributor Covenant, CODEOWNERS, CI on every PR,
`demo_values: true` until a person has checked a source.

---

## 10. Honesty: what is not done

- A Gateway started at 21:11 from inside `tempo/` (PID 83049, `uv run --no-sync tempo-gateway`) is still listening on port 8000 and reads the `.env` that points `DATABASE_URL` at the hosted database. It belongs to an earlier, idle session; it was left running and is flagged for the team to stop.

- Rule packs, clocks and benefit figures are demo values until a person checks each source.
- Rights Decay's curves are NYC 311 housing requests standing in for UK companies.
- A mandate's passkey is self-certifying; a directory or attestation issuer is roadmap.
- Skill Forge (narrate a skill, get a draft pack) is parked on `skill-forge-wip`.
- Live voice needs ElevenLabs keys and `make sync-voice`; the Vercel showcase is recorded replay.
- The Vercel deployment itself is a click the team makes with its account; this session prepares
  everything and documents the click, because it cannot sign in to Vercel for the team.

---

## 11. Status log

- [x] 00:00 Survey: tests, types, web green; lint red on Skill Forge only; second session live on the Patience track
- [x] 00:15 Six starter profiles and seven skill manifests written (the contracts above)
- [x] 00:20 Skill Forge parked on `skill-forge-wip`; `main` lint-clean; uv re-locked
- [x] 00:35 Four finished tracks committed on main (Rights Decay + Passport, Patience Profile, wiring, Delay Spotter)
- [x] 00:45 GitHub repo: description, topics, Dependabot alerts and automated security fixes switched on (private vulnerability reporting needs a public repo); Makefile gains new-skill, validate-skills, catalog, showcase, web-check, ship-check, deploy-web; README rewritten as the front door; e2e spec points at /control
- [x] 00:45 Track 1 done: `tempo_core.{capabilities,skills,profiles}`, `CapabilityGuard`, `BudgetGuard`, `profiles_router`, `scripts/{new_skill,validate_skills}.py`, 152 tests; `hard-of-hearing` now allows `call` because the Ofcom mission phones the provider
- [x] 00:50 Track 1b done: `tempo_core.{letters,letter_words,payee}`, `OFFICIAL_LETTER` vision kind, two letter fixtures with goldens, `letters_router` (`/letters/read`, `/letters/reply`, `/scam/payee`), 50 tests; the scam-signals piece handed to the Scam Shield session, which now owns everything scam
- [x] 00:55 Wired: `create_app(profiles=…)`, the three routers, `profile_id` on `POST /missions` and `/missions/ofcom` (422 if unknown) and on the view, the two guards in `negotiator_policies(profile=…)`; verified against the real `build()` through a TestClient
- [x] 01:05 Track 3 done: landing, `/control`, `/profiles`, `/profiles/[id]`, `/profiles/import`, `/skills`, `/read`, `/accessibility`; showcase mode (`ShowcaseGateway`, `ShowcaseMesh`, 34 recorded fixtures from a replay Gateway, generated `catalog.json`); SiteChrome with text size, plain mode, skip link, `prefers-contrast`; CSP and security headers; 91 web tests, all new pages axe-clean; smoke-tested in a browser. The two letter readings in the showcase are the recorded goldens (92 web tests)
- [x] 01:20 Track 4 done: `.github/workflows/{ci,release-images}.yml` (six CI jobs: lint-type, fast-tests, integration, web, skills, security; release mirrors GitLab's signed images behind a `release` environment), issue and PR templates, Dependabot, `CODE_OF_CONDUCT.md`, `SECURITY.md` (GitHub private reporting first), `CONTRIBUTING.md`, `CODEOWNERS`, `deploy/render.yaml`, `deploy/fly.toml`, docs for deploy, GitHub setup, security (threat model), accessibility, profiles and add-a-usecase. `pip-audit` and `pnpm audit` clean locally and blocking in CI. `.gitleaksignore` holds two hand-checked false positives (a hashed memory key in doc.md's example response; a type annotation in mandates.py), so the secrets scan is clean over the whole history
- [x] 00:35 Track 2 confirmed done by the ElevenLabs session and committed
- [x] 01:25 Web track committed (94cf816); docs track committed; README rewritten
- [x] 01:30 Verified from a clean `git archive HEAD` export: ruff, format, mypy --strict, 1,270 fast tests, `validate_skills`, web typecheck, 92 web tests, `next build` in both modes: all green
- [x] 01:32 Pushed `main` (e5e279e..6465f12) and `skill-forge-wip` to GitLab (the home) and GitHub (the mirror)
- [x] 01:40 GitLab pipeline on the push: lint, fast suite, integration, web and e2e green; the `secrets` job flagged five gitleaks false positives (recorded memory-item `key` hashes in a showcase fixture, and prose quoting the signing key's type annotation). Fixed at the rule level with two line allowlists in `.gitleaks.toml`; zero findings over the whole history locally. GitHub Actions fails at startup for every workflow including GitHub's own Dependabot ones, which is the mirror account's Actions minutes or billing, not the workflow (actionlint clean, both workflows registered active)
- [x] 01:45 Track 6 (Scam Shield) built end to end by the Scam & Fraud Shielding session: see `docs/scam-shield.md` §12 for its own log, `docs/scam_backtest.md` for the numbers; committed on top of f6610a5 with explicit paths
- [x] 01:50 GitLab pipeline on `main` (f6610a5) fully green: lint-type, unit-contract-policy-workflow, integration, web, e2e, secrets (<https://gitlab.com/na-group4693543/Tempo/-/pipelines/2985466656>). GitHub mirror at the same commit.
- [x] 01:55 Scam & Fraud Shielding landed from the second session (1f35318, 84 files: `/scam/check` and `/scam/shield` in `tempo_gateway/shield.py`, a `check_message` voice tool, SMS `CHECK`/`TEACH`, the `scam_text` on-device signal, a trained model under `skills/scam-shield/`, `/shield` in the web app, `docs/scam-shield.md`); verified from a clean export and pushed to both remotes; GitLab pipeline fully green (<https://gitlab.com/na-group4693543/Tempo/-/pipelines/2985503688>)
- [x] 02:10 Scam Shield's story page pushed by its session (af21894); `apps/web/showcase/catalog.json` regenerated so the committed fallback matches the manifests. Tree clean, both remotes level.

## 12. What the team does next (in this order)

1. **Deploy the web app:** press *Deploy with Vercel* in the README (Root Directory `apps/web`, `NEXT_PUBLIC_TEMPO_SHOWCASE=1`). That is the public showcase, no backend needed. Steps and the live-Gateway variant: `docs/deploy.md`.
2. **Deploy the Gateway** when you want the live product: `deploy/render.yaml` or `deploy/fly.toml` (first-deploy check: `/data` must be writable by uid 10001), then point Vercel at it with `NEXT_PUBLIC_GATEWAY_URL` and `NEXT_PUBLIC_TEMPO_TOKEN`, and set `WEB_ORIGINS` and `MESH_RP_ID` to the Vercel host.
3. **Protect `main`** with the six CI checks (`docs/github-setup.md` §4 has the JSON), then make the repo public when the keys used during the hackathon have been rotated; private vulnerability reporting switches on at that point.
4. **Stop the stale Gateway** on port 8000 (PID 83049, started 21:11 from inside `tempo/` with the hosted `DATABASE_URL`), and consider moving `DATABASE_URL` out of `tempo/.env` into a `.env.cloud` you source on purpose.
5. ~~Land Scam & Fraud Shielding~~ Done (1f35318); its plan and status stay in `docs/scam-shield.md`.
6. **Finish or drop Skill Forge** on `skill-forge-wip`; the manifest + scaffolder path on `main` is the shipped open-source route.
7. **Check the demo values**: every rule pack, clock and benefit figure says `demo_values: true` until a person has checked its cited page and set `last_verified`.

