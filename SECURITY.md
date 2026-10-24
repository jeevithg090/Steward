# Security policy

Tempo acts for people, sometimes with their money, so we take reports seriously.

## Reporting a vulnerability

Please **don't open a public issue**. Use GitLab's confidential issue option on this project and
include what you found, how to reproduce it and the impact you expect. We aim to reply within
72 hours and to credit you in the fix unless you'd rather we didn't.

## In scope

- Anything that lets Tempo act without a person's consent, or beyond the consent's limits
- Prompt injection that changes an action, an amount or what Tempo remembers
- Leaks of personal data, evidence or keys (logs, traces, webhooks, the database)
- Webhook signature or approval-signature bypasses, and replayed approvals

## Our commitments

- Money and eligibility are decided by code, not models (docs/adr/0003-rules-as-code.md).
- Consent is append-only and deny wins (docs/adr/0004-deny-wins.md).
- No secrets in the repo: gitleaks runs in pre-commit and in CI. Keys used during OxHack 26 are
  rotated after the event.
