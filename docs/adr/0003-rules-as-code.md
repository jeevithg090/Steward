# ADR 0003: Entitlements are rules as code, never model output

- **Status:** accepted, 24 Oct 2026
- **Spec:** §6.1 principle 2, §8.1

## Context
Tempo claims money for people. A wrong amount is a false claim made in their name, and DoNotPay's
2025 FTC order shows what unproven "robot lawyer" claims cost. Models are good at reading tickets
and letters and bad at being exactly right about pence.

## Decision
Compensation schemes are **YAML rule packs** (one per operator or scheme) validated by Pydantic
schemas and evaluated by a deterministic engine in `tempo_core.rules`. Every result is either
`NotEligible(reason)` or a **Proof Trace**: fact (with source) → rule (id and version) → citation
→ amount. Money is `Decimal`, rounded to the penny with `ROUND_HALF_UP`.

Models may *read* (extract facts) and *interpret* ambiguous wording (the Consensus Court votes on
eligibility), but the **amount always comes from the engine**.

## Consequences
- Adding an operator means adding one YAML file, which CI validates.
- Property tests pin the money logic: never negative, never more than the fare, never less for a
  longer delay.
- Packs carry `demo_values: true` until their bands are checked against the operator's published
  terms, and the explanation says so (the honesty rule).
- Any money claim without a Proof Trace is blocked by the `ProofRequired` policy.
