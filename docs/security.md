# Security: the threat model

*What Tempo protects, who might attack it, and for each threat the control in code and the test
that pins it. Written 25 Oct 2026 against `main`, after the shipping tracks (`SHIPPING.md` §4)
landed; the status column says what is in the tree and what is a gap. Report problems through
[SECURITY.md](../SECURITY.md).*

The one-line model: **models read and plan; code decides money, time and permissions.** Every
control below is a way of making that true even when a model, a company, a device or an operator
is hostile. Where a control is a regular expression or a prompt, it is a seatbelt; the real
control is always that the model has nothing to decide.

## Assets

| Asset | Where it lives | Why it matters |
|---|---|---|
| The person's own words and memories | `tempo_memory` (pgvector or Mem0), the dated timeline | Health, immigration and finance facts; how someone needs to be spoken to (`access`) |
| The consent ledger | `consents` table (append-only trigger, `alembic/versions/0001_initial_tables.py`), checkpoints | The only thing that lets Tempo act |
| Mandates and the keys that sign them | `tempo_passport`, `tempo_gateway/mandates.py`, device passkeys, `MANDATE_SIGNING_KEY` | A mandate is a signed power to act for a person at one company |
| Evidence | Letters, tickets and cards read by vision; call transcripts; company emails | Personal, and the main channel for injection |
| Money paths | `file_claim`, `accept_offer`, `phone_company`, `share_with_helper` (`tempo_missions/tools.py`) | The binding tools |
| Device tokens, passkeys, push subscriptions | `tempo_gateway/mesh.py`, `mesh.json` (public keys and token hashes only) | A device can approve things |
| Vendor keys and the bearer token | The platform's secret store, `.env` locally | Cost, impersonation |
| Rule packs, clocks, figures | `skills/*/rules/*.yaml`, `skills/rights-decay/rules`, `skills/entitlement-check/figures.yaml` | The amounts; must be the published rules, with a citation |
| Checkpoints | `CHECKPOINT_DIR` (`/data/checkpoints` in the image) | Mission state; restored after a crash |
| Logs and traces | stdout JSON, Langfuse over OTLP | Must carry nothing personal, because they leave the machine |

## Trust boundaries

```
person ──voice (ElevenLabs/Twilio), SMS (Twilio), web (bearer, passkeys)──► Tempo Gateway
Tempo ──Negotiator calls, claim forms, mandate verification──► company (and its AI agent)
Tempo ──model calls, vision, speech, rail data, registers, tracing──► vendors
Tempo ◄──pairing, passkey assertions, push, on-device signals──► the person's devices (Mesh)
Tempo ◄──database, disk, logs──► the operator who runs it
```

- **Person → Tempo.** Nothing a person says becomes binding until it is a signed yes (passkey,
  SMS `YES` on a verified Twilio webhook, or a spoken yes the Gateway attests). Memory keeps only
  the person's own words and verified official data.
- **Tempo → company.** Everything that comes back from a company is *data*: it may be evidence,
  never memory and never an instruction. The company's own agent can verify Tempo's mandate
  offline and must refuse anything outside it.
- **Tempo → vendors.** Which vendors see personal data is a deployment mode
  (`tempo_core/config.py:PROFILES`), shown on `/health` and the Privacy Proof panel. Traces
  leave content-free.
- **Devices.** A device is the person's; it holds the key. Pairing is a one-time secret plus a
  code confirmed on an existing device; approvals are signed per question; push says only
  "sync".
- **Operator.** Should see ciphertext (the vault), hashes (phone numbers, user refs) and
  nothing in the logs. Honestly: not yet for everything (see gaps).

## Attacker models and controls

The table is the contract. `file:symbol` is where the control lives; the test is what fails if it
regresses. Status: **in tree** (code and test on `main`), **gap** (not built), with the gap
spelled out.

| # | Threat | Control (file:symbol) | Test | Status |
|---|---|---|---|---|
| 1 | **Prompt injection via company text**: an email, web page or call transcript tells the model to accept a voucher, raise the amount, or "not tell the user" | `tempo_harness/policies.py:InjectionShield` fences instruction-like text in every tool result as `[UNTRUSTED DATA]` (`POST_TOOL`); `ProofRequired` and `SettlementGuard` make the instruction useless anyway; the Memory Gate marks company text `Trust.UNTRUSTED → EPISODE_ONLY` (`tempo_memory/gate.py:decide`) | `tests/policy/test_policies.py::test_injection_shield_quarantines_instructions_in_tool_result`, `tests/workflow/test_harness.py::test_instructions_in_a_tool_result_are_fenced_before_the_model_sees_them`, Sludge Arena scenarios (`evals/arena/scenarios.yaml`, the injector agent) | in tree. The shield is a regex seatbelt (`INSTRUCTION_LIKE`); the amount, consent and scope controls are the real stop |
| 2 | **Memory poisoning**: planted "facts" (a different fare, "prefers vouchers") change a later claim | `tempo_memory/gate.py:decide`: untrusted sources are episode-only; sensitive and `access` categories are opt-in (`OPT_IN`); confidence below 0.8 is read back (`READ_BACK_BELOW`); `ProofRequired` means a remembered amount can never become the claim; the memory header tells the model "Memory never sets an amount" (`tempo_memory/provider.py:HEADER`) | `tests/unit/test_memory_gate.py::test_untrusted_sources_never_stored`, `::test_sensitive_category_requires_consent`, `tests/policy/test_memory_policy.py::test_memory_cannot_change_entitlement_amount` | in tree |
| 3 | **Forged, altered or replayed mandates** (Agent Passport) | `tempo_passport/verify.py:check` fails closed: version, signature over the canonical digest (`signature.py:signature_reason`), window, revocation (`status_unreachable` is a refusal), counterparty, `may_not` beats `may`, amount range; `tempo_harness/policies_mandate.py:MandateGuard` runs the same check before every binding tool; the issuer check `tempo_gateway/mandates.py:MandateService.status` answers "active" only for the exact id **and digest** Tempo issued | `tests/policy/test_passport_redteam.py` (10/10 attacks refused, 2/2 honest allowed; the table is `docs/passport_redteam.md`), `tests/policy/test_passport_guard.py`, `tests/integration/test_mandates.py::test_a_well_signed_mandate_tempo_did_not_issue_is_refused`, `::test_tampering_and_scope_are_refused` | in tree. Gap: the passkey is self-certifying (see gaps) |
| 4 | **Replayed or re-purposed approvals**: a captured "yes" reused, or a signed "no" turned into a "yes" | `tempo_gateway/mesh.py:Mesh._take` makes every challenge single-use (gone on first attempt, right or wrong) and 5-minute; `verify_approval` binds the signature to one `request_id` and one answer; `_verify_assertion` checks rp id, origins, user verification and that the credential belongs to this device | `tests/integration/test_mesh.py::test_unsigned_or_replayed_approval_rejected`, `::test_a_signed_no_cannot_become_a_yes`, `::test_passkey_approval_files_the_claim` | in tree |
| 5 | **A jailbroken agent**: the model is talked into filing, accepting or calling outside what the person allowed | The Harness (`tempo_harness/policies.py:evaluate`): first deny or escalate wins; `ConsentScopeGuard` (no binding tool without a matching, unexpired consent), `SettlementGuard` (no vouchers, nothing below the entitlement, escalate above the auto-accept cap), `ProofRequired` (a claim needs a Proof Trace and must be for its amount), `MandateGuard`; the ledger merge `tempo_core/consent.py:effective_consent` where a revoke always wins | `tests/policy/test_policies.py` (table-driven), `tests/workflow/test_harness.py::test_a_voucher_is_refused_the_tool_never_runs_and_the_model_hears_why`, `::test_a_binding_tool_without_consent_is_refused`, `tests/unit/test_consent.py::test_deny_wins_regardless_of_order`, `tests/unit/test_court.py::test_court_cannot_override_rights_engine_amount` | in tree |
| 6 | **A model that invents the number**: eligibility or amount from a model, not the rules | The amount comes only from a YAML rule pack through `tempo_core/rules/engine.py` into a Proof Trace ([ADR 0003](adr/0003-rules-as-code.md)); the Consensus Court (`tempo_missions/court.py:ConsensusCourt`, `aggregate`) can say no or hand to a person, never yes against the engine and never a number; an absent juror is never a silent yes | `tests/unit/test_court.py::test_court_cannot_override_rights_engine_amount`, `::test_court_cannot_turn_not_eligible_into_eligible`, `tests/unit/test_rules.py` (money exact, bands monotonic, never above the fare), `tests/policy/test_policies.py::test_proof_required_blocks_a_different_amount` | in tree |
| 7 | **A scammer, or a scammer's agent**: a cloned firm, pressure to move money, "a safe account"; or someone using Tempo to reassure a victim | Scam Shield never says "safe" (`tempo_core/scam.py:assess`, `Level.NO_FLAGS` is the best answer, `UNKNOWN` when a register can't be reached); pressure signs are named (`PRESSURE`, `BIG_ASKS`); Tempo never moves money (no tool does; ADR 0003 and every profile); a mandate names one counterparty (`wrong_counterparty`) | `tests/unit/test_scam.py::test_the_answer_is_never_safe`, `::test_an_unreachable_register_is_unknown_never_fine`, `::test_a_safe_account_or_a_code_is_a_likely_scam_even_from_an_unknown_sender`, `tests/policy/test_passport_redteam.py` (wrong counterparty); the on-device signal rules in `skills/scam-shield/signals.yaml` against shared vectors (`tests/unit/test_signals_scam.py::test_filter_matches_the_shared_vectors`, `::test_only_the_four_fields_may_leave_and_the_body_never_does`); the before-you-pay check `POST /scam/payee` (`tempo_gateway/letters.py`) with a cooling-off rule for a new payee (`tests/unit/test_payee.py::test_a_new_payee_waits_with_the_cooling_off_line`, `::test_otherwise_pay_and_tempo_never_moves_money`, `::test_the_answer_is_always_plain_and_a_new_payee_is_never_just_pay`, `tests/integration/test_letters_routes.py::test_before_you_pay_stops_a_safe_account_and_a_warned_firm`) | in tree |
| 8 | **Token theft**: the bearer token, a device token, a webhook secret | Constant-time compares (`tempo_gateway/security.py:secret_matches`, `hmac.compare_digest` throughout); device tokens stored only as hashes (`mesh.py:_hash`, `device_for_token`); Twilio and ElevenLabs webhooks verified by signature, ElevenLabs with a 30-minute window (`security.py:twilio_signature_ok`, `elevenlabs_signature_ok`); duplicate deliveries dropped (`SeenKeys`); voice tools need a shared secret header; query strings (the WebSocket token) never reach server logs (`tempo_adapters/telemetry.py:QueryRedactor`); CORS limited to `WEB_ORIGINS` | `tests/integration/test_gateway.py::test_web_routes_need_the_bearer_token`, `::test_twilio_signature_invalid_rejected`, `::test_post_call_webhook_checks_its_signature`, `::test_webhook_idempotency_duplicate_delivery_processed_once`, `::test_ws_rejects_a_bad_token`, `::test_voice_tool_rejects_missing_secret`, `::test_cors_allows_mission_control_only`, `tests/unit/test_nologs.py::test_server_logs_drop_query_strings` | in tree. Gaps: one shared bearer token for the whole web app, visible in the bundle; no rate limiting |
| 9 | **A hostile or lost paired device** | Pairing: a one-time secret in a 2-minute link, a 6-digit code derived from it that both screens show, and confirmation on the *existing* device (`mesh.py:Mesh.start_pairing`, `claim`, `confirm`); a claimed link can't be claimed twice (`Replayed`); a device sees and removes only its own person's devices (`remove`); capabilities are an allow-list (`CAPABILITIES`); push carries only `{"type":"sync"}` (`SYNC_PAYLOAD`); a notification-reading device sends only a signal's declared fields (`tempo_core/signals.py:only_declared`) | `tests/integration/test_mesh.py::test_pairing_shows_the_same_code_on_both_devices`, `::test_a_pairing_link_is_one_time_and_expires`, `::test_a_lost_phone_is_removed_from_another_device`, `::test_push_payload_contains_no_mission_details`, `::test_a_phone_that_reads_notifications_sends_only_declared_fields`, `tests/unit/test_signals.py::test_only_declared_fields_may_leave` | in tree |
| 10 | **Supply chain**: a dependency, base image, action or built image that isn't what was reviewed | `uv.lock` and `package-lock.json` with `--frozen` / `npm ci` everywhere; base images pinned by digest (`deploy/*.Dockerfile`); reproducible builds, SBOMs, cosign-signed images and a signed allowlist (`release-images` on GitLab and `.github/workflows/release-images.yml`; `tempo_crypto/allowlist.py:verify_allowlist`, `pinned`); a worker gets a key only if its digest is on the signed allowlist (`tempo_crypto/worker_identity.py:verify_report`); `pip-audit` and `npm audit` block CI (`.github/workflows/ci.yml`, job `security`); gitleaks on the whole history; Dependabot weekly | `tests/unit/test_release_images.py::test_deploy_config_pins_digest_not_tag`, `::test_allowlist_signature_verifies`, `tests/unit/test_worker_identity.py::test_report_with_unknown_digest_rejected`, `::test_replayed_nonce_rejected`, `::test_stale_report_rejected` | in tree, except signing: no cosign key pair exists yet, so no image is signed and devices refuse every worker (the safe default) |
| 11 | **An operator with database or disk access** | The vault: per-person, per-mission ciphertext under a device-held key, AAD bound to `user\|mission\|version` so a blob moved elsewhere won't open (`tempo_crypto/envelope.py:seal`, `aad`; `vault.py:Vault`); deleting the wraps is "forget me"; phone numbers stored as hashes (`security.py:phone_hash`); a mandate names the person by `sha256` ref, never the id (`mandates.py:MandateService.draft`); consents can't be rewritten (append-only trigger); the Privacy Proof panel shows an operator's view of a row as ciphertext | `tests/unit/test_envelope.py::test_vault_reads_need_the_right_person_and_key`, `::test_wrong_aad_fails`, `::test_tampered_ciphertext_fails`, `tests/integration/test_privacy_proof.py::test_privacy_proof_shows_digest_match_key_holder_and_ciphertext`, `::test_privacy_proof_is_honest_about_gaps` | in tree for the vault itself. Gap: checkpoints and mission rows still hold names and memories in plain text until the vault is wired into them (`tests/integration/test_canary.py` docstring says so) |
| 12 | **Leaks through logs and traces** | Only allowlisted keys survive a log line (`tempo_adapters/telemetry.py:LOG_KEYS`, `_allowlist`); spans leave content-free (`ContentFreeExporter`, `CONTENT_ATTRIBUTES`, `CONTENT_EVENTS`); `ENABLE_SENSITIVE_DATA` is never set; phone numbers and dates of birth are masked in anything Tempo says (`tempo_harness/policies.py:PIIEgressRedactor`) | `tests/unit/test_nologs.py`, `tests/integration/test_canary.py::test_canary_never_logged` (a marker in a name, a transcript and an SMS appears in no log line and no span), `tests/policy/test_policies.py::test_pii_redactor_masks_phone_and_dob_in_output`, `tests/workflow/test_harness.py::test_phone_numbers_are_redacted_from_the_reply` | in tree |
| 13 | **A profile a stranger pastes in** (shared profile import): a huge payload, extra fields, a capability outside the eight, a skill whose `needs` the profile doesn't allow, or something that lingers on the server | `tempo_core/profiles.py`: schema with `extra="forbid"`, `may ∩ may_not = ∅`, every skill must exist, `needs(skill) ⊆ may` (`check_against_skills`), quoted `Decimal` amounts, Flesch ≥ 60 summary, every failure a `ProfileInvalid` with a plain reason; the share code is `tp1.` + base64url(canonical JSON), **at most 4096 bytes** (`MAX_SHARE_BYTES`), re-validated in full by `from_share_code`; `tempo_gateway/profiles.py` answers 413 over the cap before decoding and 422 with the reason, validates and echoes, and **never persists**; the share URL carries the code in the fragment (`/profiles/import#p=…`) so it never reaches a server log | `tests/unit/test_profiles.py::test_a_profile_must_allow_what_its_skills_need`, `::test_a_code_may_widen_but_never_drop_what_a_skill_needs`, `::test_money_is_decimal_and_must_be_quoted`; `tests/integration/test_profiles_routes.py::test_an_oversize_code_is_413_before_anything_is_decoded`, `::test_a_tampered_code_is_refused_with_a_reason`, `::test_an_import_never_persists`, `::test_every_route_needs_the_bearer` | in tree |
| 14 | **A profile that is only displayed**: the page says "may never accept vouchers" but nothing stops the tool | `tempo_harness/policies_profile.py:CapabilityGuard` (`PRE_TOOL`): maps the tool to an action with `TOOL_ACTIONS` and `offer_action`, `DENY` if the action is in `may_not` or not in `may`, read-only tools pass; `BudgetGuard` (`PRE_TOOL` on `file_claim` and `accept_offer`): `ESCALATE` above `limits.max_gbp_per_claim`, `DENY` when the amount is unreadable; both exported from `tempo_harness` and added right after consent in the Negotiator's policy list | `tests/policy/test_profile_guards.py::test_am_i_owed_denies_every_binding_tool`, `::test_read_only_tools_are_always_allowed`, `::test_a_zero_budget_turns_every_penny_into_a_question`, `::test_a_bad_argument_never_raises_past_evaluate`, `::test_deny_wins_and_a_question_only_follows_an_allowed_action`; `tests/workflow/test_negotiator_profile.py::test_the_commuter_profile_refuses_a_voucher_before_settlement_is_even_asked`, `::test_a_read_only_profile_refuses_every_binding_tool` | in tree |
| 15 | **Text inside a photographed letter** that tries to instruct Tempo, or a reading that invents a fact | Vision is intake, not instruction: facts come out with a source and a confidence, anything under 0.8 is read back one question at a time (`tempo_core/intake.py:follow_up`); the Decision Challenger's draft adds no facts the person didn't give (`tempo_core/decisions.py:unsupported_claims`); the general letter reader (`tempo_core/letters.py`, routes `POST /letters/read` and `POST /letters/reply` in `tempo_gateway/letters.py`) reads back what it assumed rather than trusting it, asks one plain question per unsure fact, refuses a photo over 8 MiB with 413, and in replay reads only from fixtures | `tests/unit/test_intake.py`, `tests/unit/test_decisions.py`, `tests/contract/test_vision.py`; `tests/unit/test_letters.py::test_an_assumed_direction_is_read_back_not_trusted`, `::test_each_unsure_fact_becomes_one_plain_question_most_important_first`, `::test_a_debt_letter_says_check_before_paying`; `tests/integration/test_letters_routes.py::test_a_photo_over_8_mib_is_refused_with_413`, `::test_the_routes_need_the_bearer_token` | in tree. The reading itself comes from a vision model in live mode; the guard is that it can only *read*, never file, pay or remember |
| 16 | **Abuse and denial of service**: hammering the bearer-token routes, huge bodies | Pydantic size limits on every body (`CardPhoto.image_b64` ≤ 10 MB, `ScamCheck.text` ≤ 2000, `Correction.text` ≤ 200, …); every outbound I/O call has a timeout | the models' validators are exercised throughout `tests/integration` | **gap**: no rate limiting on the Gateway (grep finds none); put it at the platform edge for now |
| 17 | **Demo routes in a real deployment** (`/demo/clock`, `/demo/credit/{id}`, `/demo/memory`) | Only mounted when `TEMPO_DEMO=1`, and behind the bearer token; the badge says `DEMO CLOCK +N DAYS` when the clock has moved | `tests/integration/test_gateway_rights.py` (the demo clock), `tests/integration/test_gateway_memory.py` | in tree. Set `TEMPO_DEMO=0` for anything real (`docs/deploy.md`) |

## The model guardrails, specifically

**What a model may never decide.** Not the amount (it comes from a rule pack through the engine
and is checked again by `ProofRequired`: a claim for any other number is denied with
`amount_mismatch`). Not eligibility against the engine (the Court can say no or ask a person).
Not consent (the ledger). Not permissions (consent scope, the mandate, and the profile's
`may`/`may_not`). Not what to remember (the Memory Gate decides from source, trust,
category and confidence; the model only proposes). Not whether a message is "safe" (Scam Shield
has no such answer). Not when a right expires (clocks are `kind: clock` rule packs with a
citation; the planner only chooses between waiting and acting).

**Deny wins.** In the Harness, `evaluate` runs every policy for the point and the first `DENY`
or `ESCALATE` ends it; later policies don't run and transforms don't undo a block. In consent, a
revoke at or after a grant cancels it, a tie goes to the revoke, a future-stamped revoke still
counts, and limits merge to the most restrictive value ([ADR 0004](adr/0004-deny-wins.md)). In
a mandate, `may_not` is checked before `may`. In a profile, the same: an action in `may_not` is
denied before `may` is consulted, and a profile that lists an action in both is invalid
(`tests/policy/test_profile_guards.py::test_deny_wins_and_a_question_only_follows_an_allowed_action`).

**Fail closed on policy error.** A policy that raises becomes `DENY policy_error`
(`tempo_harness/policies.py:evaluate`); a revocation service that can't be reached is
`status_unreachable`, a refusal; an unreadable amount is a denial, not a pass; an unknown
`TEMPO_DEPLOY` value stops the Gateway at start-up rather than falling back to a less private
mode (`tempo_core/config.py:profile`). Tests: `tests/policy/test_policies.py::test_policy_exception_fails_closed`,
`tests/workflow/test_harness.py::test_a_broken_policy_fails_closed`,
`tests/unit/test_passport.py`.

**Output redaction.** `PIIEgressRedactor` runs at `Point.OUTPUT` on everything Tempo says, as
plain text or nested message parts, masking UK phone numbers and dates of birth. It is a last
line; the first is that the model is given references and hashes, not the data.

**Budgets.** Consent limits (`auto_accept_max_gbp`, `min_settlement_ratio`, `accept_vouchers`)
merge most-restrictive; a mandate carries `amount.min_gbp`/`max_gbp` and lives at most 7 days
(`tempo_passport.MAX_LIFETIME`); `BudgetGuard` adds the profile's `limits.max_gbp_per_claim`
(escalate, the person may still say yes) and the profile schema caps `max_user_questions`
(1..10), `max_llm_gbp_per_mission` and `mandate_days` (1..7, `tempo_core/capabilities.py:MAX_MANDATE_DAYS`). Checkpoints
are a trust boundary too: only the mission's own message types can be restored
(`tempo_missions/clawback_ofcom/__init__.py:checkpoint_storage`).

## What the Profiles track added (25 Oct 2026)

A profile (`profiles/<id>.yaml`, SHIPPING.md §4.3, [docs/profiles.md](profiles.md)) is a
document that says who Tempo works for, which skills are on, how it must speak and what it may
never do, and it is **enforced, not displayed**:

- `CapabilityGuard(profile)` and `BudgetGuard(profile)` join the Harness policy list for every
  mission run under the profile (§4.4).
- The skill manifest's `needs` must be a subset of the profile's `may`, checked when the profile
  loads, so a profile can't turn on a skill whose tools it then forbids.
- Import is **size-capped (4096 bytes), schema-validated (`extra="forbid"`), re-validated from
  scratch, never persisted**; the Gateway only validates and echoes; the code travels in the
  URL fragment. There is nothing on the server for an attacker to leave behind.
- The seven starter profiles are the only ones the Gateway lists (`GET /profiles` is public
  profiles only); a community profile exists as a file or a link a person chose to open.

## The web app

`apps/web/next.config.ts` sends these headers on every route (`SECURITY_HEADERS`):

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'`; `script-src 'self' 'unsafe-inline'` (`'unsafe-eval'` only in development); `style-src 'self' 'unsafe-inline'`; `img-src 'self' data: blob:`; `font-src 'self' data:`; `connect-src 'self'` plus the one Gateway URL this build may talk to and its `ws`/`wss` form; `worker-src 'self'`; `manifest-src 'self'`; **`frame-ancestors 'none'`**; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` (so a share link's fragment and the token query never leak through a referrer either) |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `X-Frame-Options` | `DENY` |

`poweredByHeader` is off. The honest limit: `script-src` keeps `'unsafe-inline'` because Next's
hydration needs inline scripts; nonce-based CSP is roadmap. Also in the tree: client-side
encryption with device-held keys (`apps/web/lib/crypto.ts`, interop-tested against Python in
`tests/unit/test_release_interop.py`), the passkey flows (`apps/web/lib/mesh.ts`,
`lib/passport.ts`), and the showcase, which makes no network calls at all.

## CI audits

The `security` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) (and the
`secrets` job in `.gitlab-ci.yml`) runs on every pull request and push to `main`:

| Check | Command | Result on 25 Oct 2026 | Blocking |
|---|---|---|---|
| gitleaks, whole history | `gitleaks git --redact .` with `.gitleaks.toml` and `.gitleaksignore` | no leaks (60 commits) | yes |
| pip-audit, every locked Python dependency | `uv export --frozen --no-dev --no-emit-project --no-emit-workspace -o requirements.txt && uvx pip-audit -r requirements.txt --strict` | no known vulnerabilities (110 packages) | yes |
| npm audit, web production dependencies | `cd apps/web && npm audit --omit=dev --audit-level=high` | no known vulnerabilities | yes |

`--no-emit-workspace` leaves out Tempo's own packages (they are editable installs, which
pip-audit can't hash); every third-party package is audited. `.gitleaksignore` holds exactly two
fingerprints, both checked by hand: a memory item's hashed `key` in a documented example response
(`doc.md:729`) and the type annotation `signing_key: Ed25519PrivateKey | None` in
`apps/gateway/src/tempo_gateway/mandates.py:82`. Anything else gitleaks finds fails the build.

Dependabot (`.github/dependabot.yml`) raises weekly grouped PRs for uv, the two npm lockfiles
and the Actions themselves; CI is the gate.

## Known gaps

Said plainly, so nobody has to find them:

1. **The passkey is self-certifying.** A mandate carries its own public key; a company learns
   that *this key* signed *this mandate* and, through Tempo's status check with the digest, that
   Tempo issued exactly it. A directory or attestation issuer that says "this key belongs to a
   real person Tempo verified" is roadmap. A landline mandate is Gateway-attested, which is
   weaker, and the card says so.
2. **No rate limiting on the Gateway.** Bearer-token routes, the public mandate check
   (`GET /mandates/{id}`, `POST /mandates/verify`) and the webhooks can be hammered. Put a limit
   at the platform edge (Render, Fly and Vercel all offer one) until it is in code.
3. **One shared demo bearer token** (`TEMPO_API_TOKEN`), present in the web bundle. Passkeys
   authenticate approvals; the token only gates reading. Per-person sessions are roadmap.
4. **Images are unsigned until keys exist.** The release job builds reproducibly and would sign
   with cosign, but there is no key pair yet, so there is no allowlist; devices refuse every
   worker, which is the safe default. The Render and Fly deployments build from source.
5. **Checkpoints and mission rows are plain text.** The vault encrypts per person, but it is not
   yet wired into mission checkpoints and the missions tables; an operator can read names and
   memories there. The canary test covers logs and traces only.
6. **The CSP allows inline scripts.** `script-src 'unsafe-inline'` is what Next's hydration
   needs today; a nonce-based policy is roadmap. Every other directive is strict.
7. **Confidential mode is simulated.** Attestation is a recorded document signed by a stand-in
   service ([`deploy/confidential/README.md`](../deploy/confidential/README.md)).
8. **The injection shield is a regular expression.** It catches the obvious; the design does
   not depend on it catching everything, because the model cannot decide money or permissions.
9. **`/data` ownership on a fresh volume.** The image runs as uid 10001; whether a platform's
   fresh mount is writable by it is unverified ([`docs/deploy.md`](deploy.md)). A failure here
   is availability, not confidentiality, but it is a failure.
10. **Rule packs, clocks and figures are demo values** until a person checks each cited source.
    A wrong amount is a false claim in someone's name; the explanation says "demo values" until
    `last_verified` is set.
