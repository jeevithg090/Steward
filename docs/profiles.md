# Profiles

*The contract is `SHIPPING.md` §4.3–4.5. The seven starters are `profiles/*.yaml`; the loader is
`tempo_core/profiles.py` (with the capability words in `tempo_core/capabilities.py` and the
manifests in `tempo_core/skills.py`), the guards are `tempo_harness/policies_profile.py`, the
routes are `tempo_gateway/profiles.py`, and the pages are `apps/web/app/profiles`. All landed on
25 Oct 2026; `make validate-skills` reports "7 skills, 12 rule packs, 7 profiles: valid".*

## The concept

Tempo does many things, and that is the problem: a stranger cannot tell, from a list of skills,
who Tempo is working for and what it may never do. A **profile** is one small document that says
exactly that:

- **who it is for** (`for_whom`), in a sentence a person would recognise themselves in;
- **which skills are on** (`skills`), by id, each with a manifest that lists its jobs in plain
  words;
- **how Tempo must speak** with the person (`access`: language, pace, patience, voice, text
  preferred, plain words);
- **what it may and may never do** (`may`, `may_not`), in the eight capability words that
  mandates and the Harness already use;
- **the limits** (`limits`): most money per claim, most questions, most model spend per mission,
  how long a mandate may last;
- and what the person's hour is worth (`time_value_gbp_h`), so the Arbiter can say whether a
  claim is worth their time.

A profile is **enforced, not displayed**. Turning one on puts two policies into the Harness
(`CapabilityGuard`, `BudgetGuard`) that refuse what the profile does not allow, with a reason in
plain words: "This profile doesn't let me accept vouchers, so I stopped."

## The schema, with the `commuter` example

[`profiles/commuter.yaml`](../profiles/commuter.yaml), exactly as it is in the tree:

```yaml
id: commuter
name: The Commuter
version: "0.1.0"
status: starter
summary: >-
  Your train was late. Tempo works out what you are owed, asks you once, claims it and waits
  until the money arrives. It also knows when a right is about to run out.
for_whom: >-
  Anyone who takes the same train most days and never gets round to claiming.
skills: [clawback-uk-rail, rights-decay]
may: [claim, accept_cash, escalate]
may_not: [accept_voucher, call, discuss_other_accounts, change_contract, share_personal_data]
limits:
  max_gbp_per_claim: "250.00"
  max_user_questions: 2
  max_llm_gbp_per_mission: "0.20"
  mandate_days: 7
access:
  language: en
  pace: normal
  patience: normal
  voice: default
  prefers_text: false
  plain_words: true
channels: [web, sms, voice]
time_value_gbp_h: "18.00"
share:
  public: true
  author: Tempo team
```

| Field | Rule (`tempo_core/profiles.py:Profile`) |
|---|---|
| `id` | `[a-z0-9-]{2,40}`, and it must equal the file name |
| `name`, `version` | name 1..80 characters; version as a quoted `x.y.z` string |
| `status` | `starter` (ships with Tempo) or `community` |
| `summary` | one or two sentences; **must score Flesch ≥ 60** (`summary_is_plain`) |
| `for_whom` | who recognises themselves here |
| `skills` | at least one; ids of folders under `skills/` that have a `skill.yaml`; no repeats |
| `may`, `may_not` | subsets of the eight words in `tempo_core/capabilities.py:CAPABILITIES` (`claim`, `call`, `accept_cash`, `accept_voucher`, `discuss_other_accounts`, `change_contract`, `share_personal_data`, `escalate`); **disjoint** (`may_and_may_not_agree`) |
| `limits.max_gbp_per_claim` | a `Decimal` ≥ 0 **written as a string** (`"250.00"`); a bare number is rejected (`money_is_quoted`) |
| `limits.max_user_questions` | 1..10 |
| `limits.max_llm_gbp_per_mission` | a `Decimal` ≥ 0 as a string |
| `limits.mandate_days` | 1..7 (`MAX_MANDATE_DAYS`, the same week as `tempo_passport.MAX_LIFETIME`) |
| `access.language` | a code with a voice preset: `en`, `hi`, `pa`, `pl`, `ur`, `cy` (`tempo_core/voice_profile.py:LANGUAGES`) |
| `access.pace` / `patience` / `voice` | `normal` or `slower`; `normal` or `high`; `default` or `low` |
| `access.prefers_text`, `plain_words` | booleans |
| `channels` | at least one of `web`, `sms`, `voice`; no repeats |
| `time_value_gbp_h` | a `Decimal` > 0 as a string |
| `share.public`, `share.author` | whether `GET /profiles` lists it; who wrote it (1..80 characters) |

The schema has `extra="forbid"`, so a misspelt field is an error, not a silent default, and a
profile is frozen once loaded. Beyond the schema, `check_against_skills` insists every skill has
a manifest and that **`needs(skill) ⊆ may` for every skill**: a profile cannot turn on a skill
whose binding tools it then forbids. Every failure is a `ProfileInvalid` with a plain reason that
names the file. Tests: `tests/unit/test_profiles.py::test_a_profile_must_allow_what_its_skills_need`,
`::test_a_bad_profile_says_what_is_wrong`, `::test_money_is_decimal_and_must_be_quoted`,
`::test_a_profile_is_frozen`.

## How a profile is enforced

Two Harness policies (`tempo_harness/policies_profile.py`, exported from `tempo_harness`), both
`PRE_TOOL`, join the existing guards (`ConsentScopeGuard`, `SettlementGuard`, `ProofRequired`,
`MandateGuard`) for every mission under the profile, right after consent. Deny wins, and a
policy that errors denies ([docs/security.md](security.md)).

| Guard | What it does |
|---|---|
| `CapabilityGuard(profile)` | Maps the tool to an action with `TOOL_ACTIONS` (`file_claim → claim`, `phone_company → call`, `share_with_helper → share_personal_data`, `accept_offer → accept_cash` or `accept_voucher` by what is offered). `DENY` if the action is in `may_not` or not in `may`. Tools outside `TOOL_ACTIONS` are read-only and pass. The message is plain: "This profile doesn't let me accept vouchers, so I stopped." |
| `BudgetGuard(profile)` | On `file_claim` and `accept_offer`: `ESCALATE` when `amount_gbp` is above `limits.max_gbp_per_claim`, naming both amounts (the person may still say yes); `DENY` when the amount is unreadable. A zero budget turns every penny into a question. |

Tests: `tests/policy/test_profile_guards.py::test_am_i_owed_denies_every_binding_tool`,
`::test_read_only_tools_are_always_allowed`, `::test_a_zero_budget_turns_every_penny_into_a_question`,
`::test_deny_wins_and_a_question_only_follows_an_allowed_action`, `::test_every_message_is_in_plain_words`;
`tests/workflow/test_negotiator_profile.py::test_a_profile_adds_its_two_guards_right_after_consent`,
`::test_the_commuter_profile_refuses_a_voucher_before_settlement_is_even_asked`.

The access block is enforced by the voice line: a profile's `access` fields are the same ones
the Patience Profile derives from memories (`tempo_core/voice_profile.py:VoiceProfile`), so a
caller on the `hard-of-hearing` profile gets the lower, slower voice and the question by text
before the first word.

## Sharing and importing, safely

A profile travels as a **share code**: `tp1.` (`SHARE_PREFIX`) followed by base64url of the
profile's canonical JSON, at most **4096 bytes** (`MAX_SHARE_BYTES`). `GET /profiles/{id}/share`
returns the code and a URL of the form `<first WEB_ORIGINS entry>/profiles/import#p=<code>`. The
code sits in the URL **fragment**, so it never reaches a server log or a referrer.

Importing (`POST /profiles/import {"code": ...}`, or the `/profiles/import` page) re-validates
everything from scratch with `from_share_code`: **413** if the code is over the cap, before
anything is decoded; **422** with a plain reason if anything fails (an unknown skill, a
capability a skill needs that the profile forbids, a summary that is not plain enough).
Importing **never persists anything server-side**: the Gateway validates and echoes the
`ProfileView`; the browser keeps it. A code may allow *more* than its skills need, never less.

Tests: `tests/integration/test_profiles_routes.py::test_share_then_import_round_trips`,
`::test_an_oversize_code_is_413_before_anything_is_decoded`, `::test_a_tampered_code_is_refused_with_a_reason`,
`::test_an_import_never_persists`, `::test_a_private_profile_is_hidden_from_the_list_but_not_from_its_link`;
`tests/unit/test_profiles.py::test_every_starter_round_trips`, `::test_a_code_may_widen_but_never_drop_what_a_skill_needs`.

What a shared profile **cannot** do: grant a capability outside the eight; raise a limit above
the schema's bounds; turn on a skill that does not exist in this Tempo; change the amount of any
claim (that is still the rule pack's); or skip the signed yes.

## The seven starters

From `profiles/*.yaml` as they are in the tree:

| Profile | For whom | Skills | May | May never | Access | Max per claim |
|---|---|---|---|---|---|---|
| **The Commuter** (`commuter`) | Takes the same train most days and never gets round to claiming | clawback-uk-rail, rights-decay | claim, accept_cash, escalate | accept_voucher, call, discuss_other_accounts, change_contract, share_personal_data | en, normal pace | £250 |
| **The Carer** (`carer`) | A son, daughter or friend who handles a parent's post, calls and refunds | clawback-uk-rail, clawback-ofcom, rights-decay, letter-explainer, entitlement-check, scam-shield | claim, call, accept_cash, escalate, share_personal_data | accept_voucher, discuss_other_accounts, change_contract | en, slower, high patience | £500 |
| **Am I Owed Anything?** (`am-i-owed`) | Wants answers first and will decide later whether Tempo may act | entitlement-check, letter-explainer, scam-shield | *(nothing)* | all eight | en, normal, up to 10 questions | £0 |
| **Say It Again, Lower** (`hard-of-hearing`) | Struggles to hear on the phone, especially high voices | clawback-uk-rail, clawback-ofcom, entitlement-check, scam-shield | claim, call, accept_cash, escalate | accept_voucher, discuss_other_accounts, change_contract, share_personal_data | en, slower, high patience, **low voice, text preferred** | £250 |
| **New Here** (`new-to-the-uk`) | New to the UK; the rules, letters and calls are hard to follow | clawback-uk-rail, clawback-uk-flights, rights-decay, scam-shield | claim, accept_cash, escalate | accept_voucher, call, discuss_other_accounts, change_contract, share_personal_data | **hi**, slower | £600 |
| **Read It To Me** (`read-it-to-me`) | Finds official letters, phone menus and banking apps frightening, or reads another language better than English | letter-explainer, scam-shield, entitlement-check, rights-decay | escalate | claim, call, accept_cash, accept_voucher, discuss_other_accounts, change_contract, share_personal_data | en, slower, high patience, text preferred | £0 |
| **Take Your Time** (`take-your-time`) | Stammers, or needs a moment to answer, and is tired of being cut off | clawback-uk-rail, clawback-ofcom, scam-shield | claim, call, accept_cash, escalate | accept_voucher, discuss_other_accounts, change_contract, share_personal_data | en, slower, high patience | £250 |

Every starter is `plain_words: true`, allows `web`, `sms` and `voice`, and lets a mandate live at
most 7 days (1 day for the two profiles that may not claim). The profiles that turn on
`clawback-ofcom` allow `call`, because that skill's manifest `needs` it (the missed-visit mission
may phone the provider within the mandate); the loader would reject them otherwise.
`read-it-to-me` is the safety barrier from `SHIPPING.md` §4.8: four skills on, every binding
capability off, so the agent that reads your letters and warns you before you pay is, by
construction, unable to move your money.

## Writing a community profile

1. Copy the starter closest to your person: `cp profiles/commuter.yaml profiles/night-shift.yaml`.
2. Change `id` to the file name, `status` to `community`, and `share.author` to you.
3. Write `for_whom` and `summary` for one real kind of person, in short sentences. The summary
   must score Flesch ≥ 60; this tells you:
   `uv run python -c "from tempo_core.readability import flesch_reading_ease as f; print(f(open(0).read()))" <<< "your sentence"`.
4. Pick `skills` from `skills/*/skill.yaml`. Read each manifest's `needs`: everything a skill
   needs must be in your `may`, or the profile is rejected when it loads.
5. Decide `may_not` first, then `may`. If in doubt, forbid it; the person can always say yes
   to a specific question.
6. Set `limits` for this person, and `access` for how they need to be spoken to.
7. `make validate-skills` checks the profile against the schema and the manifests, and
   `make check` runs the tests (`tests/unit/test_profiles.py` loads every file in `profiles/`).
8. Open a pull request; or share it as a link from `/profiles/<id>/share` and never commit it.
   A profile shared as a link reaches only the people you give it to, and `share.public: false`
   keeps it out of the catalogue even when it is in the tree.

Related: [add-a-usecase.md](add-a-usecase.md) for the skills a profile is made of;
[security.md](security.md) for what the guards do; [accessibility.md](accessibility.md) for what
`access` changes on the line.
