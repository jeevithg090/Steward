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
- a **revoke** at or after a grant cancels it (a tie goes to the revoke), and revokes count even
  when stamped in the future, so a device clock running fast can't delay a STOP;
- **expired** grants, and grants not valid yet, count for nothing;
- limits come from the active grants and the **most restrictive** value wins: caps (e.g.
  `auto_accept_max_gbp`) take the **minimum**, floors (keys starting `min_`, e.g.
  `min_settlement_ratio`) take the **maximum**, booleans (e.g. `accept_vouchers`) take **AND**;
- a limit that is a yes/no in one grant and a number in another raises `ConsentConflict`, and the
  caller fails closed;
- the same events in any order give the same state.

## Consequences
- A late or duplicated grant can never re-open something a person stopped.
- Property tests (Hypothesis, 500 examples each) check deny-wins, minimum caps, AND booleans and
  order independence.
- The database blocks UPDATE and DELETE on the consents table; history is the audit trail.
- Every binding tool checks the merged state through the `ConsentScopeGuard` policy.
