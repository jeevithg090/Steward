# Security policy

Tempo acts for people, sometimes with their money, so we take reports seriously. The written
threat model, with each threat mapped to its control and its test, is
[docs/security.md](docs/security.md).

## Reporting a vulnerability

Please **don't open a public issue, merge request or pull request** for a vulnerability.

1. **GitHub (preferred):** use private vulnerability reporting on this repository: the
   *Security* tab, then *Report a vulnerability*, or go straight to
   <https://github.com/jeevithg090/Tempo/security/advisories/new>. Only the maintainers see it,
   and the fix can be prepared in a private fork before anything is public.
2. **GitLab (the mirror):** open an issue on <https://gitlab.com/na-group4693543/Tempo/-/issues/new>
   and tick **This issue is confidential** before you submit.

Include what you found, how to reproduce it (replay mode needs no keys) and the impact you
expect. We aim to reply within 72 hours, to fix in-scope problems before we talk about them, and
to credit you in the fix unless you'd rather we didn't. Don't put a real secret or anyone's
personal data in the report itself; describe where it is.

## In scope

Anything that breaks one of Tempo's promises:

- **Acting without consent, or beyond it.** Tempo files, calls, accepts or shares something
  without a signed yes, outside the consent's scope or limits, after a STOP, or outside the
  mandate the person signed (the Agent Passport).
- **A model deciding money.** Prompt injection or memory poisoning that changes an action, an
  amount, an eligibility verdict or what Tempo remembers; a Proof Trace that doesn't come from a
  rule pack; the Consensus Court raising an amount.
- **Leaks.** Personal data, evidence, memories or keys in logs, traces, webhooks, push payloads,
  the database (beyond what the vault model says an operator may see) or the browser bundle.
- **Signatures and replay.** Bypassed webhook signatures (Twilio, ElevenLabs), replayed or
  re-purposed passkey approvals, a "no" turned into a "yes", a pairing link used twice, a device
  token accepted after removal.
- **Profiles.** The profile import route (`POST /profiles/import`) or a `tp1.` share code
  accepting a profile that fails validation, exceeds the size cap, grants a capability outside
  the eight in `tempo_passport.ACTIONS`, or persists anything server-side; a shared profile link
  that puts the code anywhere but the URL fragment; `CapabilityGuard` or `BudgetGuard` letting a
  tool run that the profile forbids.
- **Letter reading.** Text inside a photographed letter (`POST /letters/read`) that changes what
  Tempo does, remembers or says beyond reading the letter back; a reading that invents a fact,
  an amount or a deadline not in the letter.
- **Scam signals.** Anything that makes Scam Shield say "safe", skip a warning, or let a message
  through `skills/scam-shield/signals.yaml` that its vectors say must match; the before-you-pay
  check (`POST /scam/payee`) failing to apply the cooling-off rule for a new payee.
- **Supply chain.** A dependency, image or action that can change what Tempo does without a
  reviewed commit.

## Out of scope (open a normal issue instead)

- Demo values that turn out wrong. Rule packs, clocks and benefit figures ship as
  `demo_values: true` until a person checks each source; a wrong number is an honesty issue, and
  we want to hear about it, but it isn't a vulnerability.
- The shared bearer token (`TEMPO_API_TOKEN`) being visible in the web bundle. It is a demo
  convenience documented in `apps/web/.env.example`; passkey-signed approvals are the real
  authentication, and the gap is listed in [docs/security.md](docs/security.md).
- Rate limiting on the Gateway. It isn't there yet; it is a known gap, not a secret.
- Vendor behaviour we only pass through (ElevenLabs, Twilio, Snowflake Cortex, Gemini). Report
  those to the vendor; tell us too if Tempo's handling makes it worse.

## Supported versions

`main` only. There are no releases yet; a fix lands on `main` and is mirrored to GitLab.

## Our commitments

- Money and eligibility are decided by code, not models ([ADR 0003](docs/adr/0003-rules-as-code.md)).
- Consent is append-only and deny wins ([ADR 0004](docs/adr/0004-deny-wins.md)); a policy that
  errors denies.
- No secrets in the repo: gitleaks runs in pre-commit and in CI on both GitHub and GitLab. Keys
  used during OxHack 26 are rotated after the event.
- Dependencies are locked (`uv.lock`, `pnpm-lock.yaml`), audited in CI (`pip-audit`,
  `pnpm audit`) and bumped weekly by Dependabot; container base images are pinned by digest.
- We say what isn't done. [docs/security.md](docs/security.md) ends with the known gaps.
