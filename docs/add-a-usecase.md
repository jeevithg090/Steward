# Add a use case

*Three ways in, shortest first (`SHIPPING.md` §9), each with the real files and commands. Then
the honesty rule, the manifest, a profile that uses your skill, how tests work, the pull request
checklist, and a ten-minute walkthrough that ends in a pull request.*

Tempo prices nothing from a model. Every amount comes from a **rule pack**: a YAML file with a
citation that a deterministic engine evaluates into a Proof Trace
([ADR 0003](adr/0003-rules-as-code.md)). So most use cases are a YAML file, not Python.

## Which path?

| You want to add… | Path | What you write |
|---|---|---|
| A new train operator, airline scheme, regulator's fixed payment or legal deadline for a skill that exists | **1. A rule pack** | one YAML in `skills/<skill>/rules/` |
| A new kind of help with its own jobs (a new scheme family, a new letter type) | **2. A skill** | a folder `skills/<id>/` with `skill.yaml` and optional `rules/` |
| A new multi-step workflow with its own tools, waits and consent points | **3. A mission** | Python under `packages/tempo_missions/`, copying `clawback_ofcom` |
| A kind of person: which skills are on, what Tempo may never do, how it speaks | **4. A profile** | one YAML in `profiles/` ([profiles.md](profiles.md)) |

## Path 1: a rule pack (one YAML file)

Rule packs live in `skills/<skill>/rules/*.yaml` and are loaded by
`tempo_core.rules.RulePackRegistry.from_directory(REPO / "skills")`: every `**/rules/*.yaml` under
`skills/`, except `skills/generated/` (Skill Forge drafts, never loaded). The schema is
[`packages/tempo_core/src/tempo_core/rules/schema.py`](../packages/tempo_core/src/tempo_core/rules/schema.py);
Pydantic validates each pack before the registry will hold it, and `tests/unit/test_rules.py`
validates every pack in the tree on every run.

### Fields every pack has (`_Honest`)

| Field | Rule |
|---|---|
| `kind` | `delay_repay`, `fixed_amount`, `distance_band` or `clock`: picks the schema and the evaluator |
| `id` | unique across all packs (`uk-rail.gwr.delay-repay`); duplicates are rejected |
| `version` | a quoted string, `"0.1.0"` |
| `operator` | who pays or who sets the clock (`GWR`, `Ofcom`, `DWP`) |
| `citation_url` | **must start with `https://`**; shown in every Proof Trace |
| `demo_values` | `true` until a person has checked the numbers against the cited page |
| `last_verified` | a date; **required when `demo_values` is false** (`verified_packs_say_when`) |

Packs that pay money (`delay_repay`, `fixed_amount`, `distance_band`) also carry
`claim_window_days` (> 0). **Write money as quoted strings** (`"32.31"`, `"25"`): a bare `32.31`
is a binary float and the schema is there to stop it.

### `delay_repay` (UK rail)

`scheme` (`DR15` or `DR30`), `toc_codes` (how rail data names the operator), and `bands` of
`{min_minutes, max_minutes, refund_pct}`. The validator `bands_are_contiguous` insists the first
band starts at 0, the last is open-ended (`max_minutes: null`), bands touch without gaps or
overlaps, and a longer delay never pays less. [`skills/clawback-uk-rail/rules/gwr.yaml`](../skills/clawback-uk-rail/rules/gwr.yaml)
is the model; the walkthrough below copies it.

### `fixed_amount`, complete example

[`skills/clawback-ofcom/rules/missed_appointment.yaml`](../skills/clawback-ofcom/rules/missed_appointment.yaml), as in the tree:

```yaml
# Ofcom automatic compensation: a missed engineer appointment, or one cancelled with less than
# 24 hours' notice. The amount rises with inflation each April; check Ofcom's page and update.
kind: fixed_amount
id: ofcom.missed-appointment
version: "0.1.0"
operator: Ofcom
scheme: automatic compensation (missed appointment)
citation_url: https://www.ofcom.org.uk/phones-and-broadband/service-quality/automatic-compensation-need-know/
amount_gbp: "32.31"
min_notice_hours: 24
claim_window_days: 30
demo_values: true
```

`amount_gbp` (> 0) is paid when the condition is met; `min_notice_hours` says that a cancellation
with less notice than this counts as missed. The evaluator is
`tempo_core.rules.evaluate_missed_appointment`.

### `distance_band` (flights)

`min_arrival_delay_minutes` (> 0) and `bands` of `{max_km, amount_gbp}`, ascending by distance,
the last open-ended (`max_km: null`), and a longer flight never pays less (`bands_ascend`).
[`skills/clawback-uk-flights/rules/uk261.yaml`](../skills/clawback-uk-flights/rules/uk261.yaml)
is the example; extraordinary circumstances are an eligibility question for the Consensus Court,
not the pack.

### `clock`, complete examples

A clock is a right's timer: what starts it, how long it runs, and whether it **closes** a right
when it ends (`role: window`, a hard cliff by default) or **opens** one (`role: wait`, never a
cliff). Rights Decay plans around them. Two from
[`skills/rights-decay/rules/`](../skills/rights-decay/rules/):

```yaml
# skills/rights-decay/rules/uk-rail.delay-repay.claim-window.yaml: a window that closes a right
kind: clock
id: uk-rail.delay-repay.claim-window
version: "0.1.0"
operator: GWR
citation_url: https://www.gwr.com/help-and-support/refunds-and-compensation/delay-repay
demo_values: true
trigger: journey
starts_from: event_date
length: { days: 28 }
role: window
right: uk-rail.delay-repay.claim
summary: You have 28 days from the journey to claim Delay Repay.
```

```yaml
# skills/rights-decay/rules/ofcom.auto-comp.payment-window.yaml: a wait that opens a right
kind: clock
id: ofcom.auto-comp.payment-window
version: "0.1.0"
operator: Ofcom
citation_url: https://www.ofcom.org.uk/phones-and-broadband/service-quality/automatic-compensation-need-know/
demo_values: true
trigger: missed_appointment
starts_from: event_date
length: { days: 30 }
role: wait
right: ofcom.complaint
summary: Your provider should pay this on its own within 30 days. If it doesn't, you can complain.
```

| Field | Rule |
|---|---|
| `trigger` | the event that starts it (`journey`, `complaint_sent`, `decision_letter`); `RulePackRegistry.clocks(trigger)` finds every clock an event starts |
| `starts_from` | one of `event_date`, `letter_date`, `complaint_date`, `final_response_date`, `request_date` |
| `length` | **exactly one** of `days`, `working_days`, `weeks`, `months` (> 0), because the law counts in different units |
| `role` | `window` (the right is lost when it ends) or `wait` (the right opens when it ends) |
| `right` | the right this clock gates (`fos.refer`, `dwp.pip.reconsider`) |
| `hard_cliff` | optional; defaults to `true` for a window and must be `false` for a wait |
| `summary` | one plain sentence shown to the person |

### A new `kind`

If no kind fits (say, a per-day payment), add a Pydantic model to `rules/schema.py`, add it to
the `RulePack` union with its `kind` literal, write `evaluate_<kind>` in `rules/engine.py` that
returns `NotEligible(reason)` or a Proof Trace through `_trace`, and add table and property tests
to `tests/unit/test_rules.py` (money never negative, never above what was paid, monotonic where
it should be). That is Python, but small Python with 100% branch coverage expected.

## Path 2: a skill (a folder)

A skill is `skills/<id>/` with a manifest `skill.yaml` and, if it prices anything, `rules/`.
The manifest is what a newcomer reads and what a profile binds to (`SHIPPING.md` §4.2):

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

`needs` is binding: a profile that turns the skill on must allow every capability listed, or the
profile is rejected. A skill that only reads and explains (`letter-explainer`, `scam-shield`,
`entitlement-check`, `rights-decay`) has `needs: []`.

```bash
make new-skill id=council-tax name="Council tax discounts" needs=claim rules=fixed_amount
make validate-skills
```

`make new-skill` (`scripts/new_skill.py --id --name [--needs] [--rules fixed_amount|delay_repay|none]`)
writes `skills/<id>/skill.yaml` with the fields above for you to fill in and, with `rules=`, a
rule pack template under `skills/<id>/rules/`. `make validate-skills` (`scripts/validate_skills.py`)
loads every rule pack, manifest and profile and checks they agree; today it prints
"7 skills, 12 rule packs, 7 profiles: valid". The manifest loader is `tempo_core/skills.py`
(`tests/unit/test_skills.py` covers a bad manifest, an id that doesn't match its folder, and a
`rules/` folder with no manifest). Fill in `jobs` as the sentences Tempo would say about itself,
keep `status: demo-values` until the rules are checked, and add `rules/*.yaml` from path 1.
[`skills/scam-shield/skill.yaml`](../skills/scam-shield/skill.yaml) is a good read-only example;
[`skills/clawback-ofcom/skill.yaml`](../skills/clawback-ofcom/skill.yaml) a binding one.

## Path 3: a mission (Python)

A mission is a checkpointed workflow with its own steps, waits and consent points. Copy the
shape of [`packages/tempo_missions/src/tempo_missions/clawback_ofcom/`](../packages/tempo_missions/src/tempo_missions/clawback_ofcom/__init__.py):

| Module | Holds |
|---|---|
| `messages.py` | the request, the case, and `CHECKPOINT_TYPES` (only these may be restored from a checkpoint) |
| `assess.py` | `Intake`, `Rights` (the engine and clocks), `Court`, `Appraise` (the Arbiter) |
| `act.py` | `Consent` (the one question), `Decide` (wait or act, durable timers), `Action` (the binding tool, through the Harness) |
| `watchdog.py` | `PaymentWatchdog` (until the money arrives) and `Ledger` |
| `__init__.py` | `build_<name>_workflow`, `start`, `resume`, `checkpoint_storage`, and a stable `WORKFLOW_NAME` |

Then wire it: a method on `MissionService` (`apps/gateway/src/tempo_gateway/missions.py`) and a
route in `app.py` like `POST /missions/ofcom`; binding tools come from
`tempo_missions/tools.py:mission_tools` and must map onto a capability in
`tempo_harness.TOOL_ACTIONS`. Tests go in `tests/workflow/` (pause, resume, crash, restore,
timers, with fakes) like `tests/workflow/test_clawback_ofcom.py`, and an integration test in
`tests/integration/` if there is a route. The domain rules stay in `tempo_core` (pure, no I/O,
`mypy --strict`); the mission orchestrates.

## Path 4: a profile

One YAML in `profiles/` that composes skills for a kind of person; the schema, the guards and a
worked example are in [profiles.md](profiles.md). A profile that uses your new skill is the
fastest way to show it working end to end:

```yaml
id: council-tenant
name: The Council Tenant
version: "0.1.0"
status: community
summary: >-
  Tempo checks your council tax bill for the discounts you are owed, claims them with your yes,
  and keeps an eye on every deadline.
for_whom: >-
  Anyone renting from a council who suspects they pay too much and never has time to check.
skills: [council-tax, rights-decay, scam-shield]
may: [claim, accept_cash, escalate]        # must include everything council-tax's `needs` lists
may_not: [accept_voucher, call, discuss_other_accounts, change_contract, share_personal_data]
limits: { max_gbp_per_claim: "300.00", max_user_questions: 3, max_llm_gbp_per_mission: "0.20", mandate_days: 7 }
access: { language: en, pace: normal, patience: normal, voice: default, prefers_text: false, plain_words: true }
channels: [web, sms, voice]
time_value_gbp_h: "15.00"
share: { public: false, author: you }
```

## The honesty rule

Tempo claims money in a person's name, so a wrong number is a false claim. The rule, from
ADR 0003, is mechanical:

- A pack ships with **`demo_values: true`** until a person has read the cited page and checked
  every band, amount, window and clock against it. The engine's explanation then says "demo
  values" (`tempo_core/rules/engine.py:_honest`), and the web app and the README say the same.
- When a person has checked it, set `demo_values: false` **and** `last_verified: 2026-10-25`.
  A pack that claims to be verified without a date is rejected.
- `citation_url` must be `https://` and must be the page a reader can check, not a search
  result. Quote the rule in the issue or the pull request as the page states it.
- Figures that change on a date (most are uprated in April) get a comment saying so, as
  `missed_appointment.yaml` does.
- Clocks and curves are demo values too; Rights Decay's hazard curves are NYC 311 housing
  requests standing in for UK companies and the docs say so
  ([rights_backtest.md](rights_backtest.md)).

## Tests, by marker

A test's marker is the first folder under `tests/`: `tests/unit/` is `unit`, `tests/policy/` is
`policy`, and so on (`pyproject.toml` `[tool.pytest.ini_options]`). A rule pack needs no new
test to be validated (`test_rules.py::test_pack_yaml_files_validate` covers every pack in the
tree), but a new kind, a new skill with code, or a mission does:

| You added | Tests to add | Run |
|---|---|---|
| A rule pack | none required; a band-boundary case in `tests/unit/test_rules.py` if the scheme is unusual | `uv run pytest tests/unit/test_rules.py -q` |
| A new `kind` | table tests and Hypothesis properties in `tests/unit/test_rules.py` | `make check` |
| Messages Tempo says | the family in `tests/unit/test_plain_language.py::messages` (Flesch ≥ 60) | `uv run pytest tests/unit/test_plain_language.py -q` |
| A Harness policy | a row in `tests/policy/test_policies.py`'s tables | `uv run pytest -m policy -q` |
| A mission | `tests/workflow/test_<mission>.py`: pause, resume, crash, restore | `uv run pytest -m workflow -q` |
| A Gateway route | `tests/integration/test_<thing>.py` (Postgres by `TEST_DATABASE_URL` or Docker) | `make test-int` |
| A web page | `apps/web/src/**/*.test.tsx`, with `expectNoA11yViolations` from `apps/web/src/test/a11y.ts` (axe) | `cd apps/web && npm test` |

`make check` runs lint, types and the fast markers in under a minute; `make ship-check` adds the
skill validator and the web app. CI runs the same (`.github/workflows/ci.yml`).

## The pull request checklist

The template (`.github/PULL_REQUEST_TEMPLATE.md`) asks for these; for a rule pack they are the
whole review:

- [ ] `demo_values: true`, or `false` with `last_verified`
- [ ] `citation_url` is the published page, `https://`, and the rule is quoted in the PR
- [ ] Money as quoted strings; bands contiguous, open-ended last, never paying less for more
- [ ] The skill manifest lists the operator (`operators:`) and its `needs` are still right
- [ ] Any new sentence Tempo says is in `test_plain_language.py` and scores ≥ 60
- [ ] `make check` and `make validate-skills` green
- [ ] Works in replay mode with no keys
- [ ] No secrets, no PII in logs

## Ten minutes to a pull request: LNER Delay Repay

LNER (TOC code `GR`) is not covered. Its Delay Repay is the same DR15 shape as GWR's.

```bash
# 0:00  fork https://github.com/jeevithg090/Tempo on GitHub, then
git clone https://github.com/<you>/Tempo.git && cd Tempo
make setup                                             # uv sync, hooks, web deps (~2 min first time)

# 2:30  one file: copy the closest pack
git switch -c skill-lner-delay-repay
cp skills/clawback-uk-rail/rules/gwr.yaml skills/clawback-uk-rail/rules/lner.yaml
```

Edit `skills/clawback-uk-rail/rules/lner.yaml`: `id: uk-rail.lner.delay-repay`, `operator: LNER`,
`toc_codes: [GR]`, `citation_url:` LNER's Delay Repay page, the bands and `claim_window_days`
exactly as that page states them, and keep `demo_values: true`. Then tell the manifest:

```yaml
# skills/clawback-uk-rail/skill.yaml
operators: [GWR, Chiltern, LNER]
```

```bash
# 5:00  check: schema, exact money, contiguous bands, the registry finds it by name and code
uv run pytest tests/unit/test_rules.py -q
uv run python -c "
from pathlib import Path
from tempo_core.rules import RulePackRegistry
r = RulePackRegistry.from_directory(Path('skills'))
print(r.delay_repay('LNER').id, r.delay_repay('GR').scheme)"
make validate-skills                                   # packs, manifests and profiles still agree
make check                                             # lint, types, every fast test (< 60 s)

# 8:00  commit (the hooks run gitleaks, ruff, mypy and the fast tests) and open the PR
git add skills/clawback-uk-rail/rules/lner.yaml skills/clawback-uk-rail/skill.yaml
git commit -m "feat(rules): LNER Delay Repay (demo values until checked)"
git push -u origin skill-lner-delay-repay
gh pr create --fill                                    # or the "Compare & pull request" button
```

In the PR body: the URL you read, the bands as the page states them, and the walkthrough's
checklist ticked. CI runs the six checks; a code owner reviews; it merges with linear history. The
registry picks the pack up with no code change, and the next person whose LNER train is late
gets a Proof Trace that cites LNER's own page and says, honestly, "demo values" until someone
sets `last_verified`.

If you'd rather describe the use case than write the YAML, open a **New use case** issue
(`.github/ISSUE_TEMPLATE/new_usecase.yml`): it asks for the person, the company, the published
rule and its URL, what Tempo should say, and which of the eight capabilities it needs.
