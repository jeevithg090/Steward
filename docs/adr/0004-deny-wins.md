# ADR 0004: Consent is an append-only ledger where deny wins

- **Status:** accepted, 24 Oct 2026
- **Spec:** §5, §13, §15.7

## Context
Consent arrives from many places (voice, SMS "YES", a passkey tap on any device in the Mesh) and
can be revoked from any of them ("STOP"). Events can arrive late or out of order across devices.
The safe failure is always "Tempo does less".

## Decision
Consent is a list of immutable `ConsentEvent`s (grant or revoke, scope, expiry, limits, device
signature), stored append-only. The effective state is a pure, deterministic merge
(`tempo_core.consent.effective_consent`):
- a **revoke** at or after the latest grant removes the scope; **expired** grants count for nothing;
- numeric limits (e.g. `auto_accept_max_gbp`) take the **minimum** across active grants;
- boolean permissions (e.g. `accept_vouchers`) take **AND**;
- the same events in any order give the same state.

## Consequences
- A late or duplicated grant can never re-open something a person stopped.
- Property tests (Hypothesis) check deny-wins, minimum limits, AND booleans and order independence.
- The database blocks UPDATE and DELETE on the consents table; history is the audit trail.
- Every binding tool checks the merged state through the `ConsentScopeGuard` policy.
