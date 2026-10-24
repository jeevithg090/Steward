# Agent Passport: red team

Ten attacks on Margaret's signed mandate and two honest calls, each checked by the code a company's agent runs on the JSON it is handed (`tempo_passport.check_envelope`). Tempo's own Harness runs the same check (`MandateGuard`) before every binding tool. The passkey signatures are real ES256 WebAuthn assertions from a software passkey.

**10/10 attacks refused. 2/2 honest calls allowed.**

| # | Attack | Reason code | Refused |
|---|---|---|---|
| 1 | Forged signature: vouchers added to her mandate, her signature kept | `bad_signature` | yes |
| 2 | Expired: the mandate used the day after it ran out | `expired` | yes |
| 3 | Not yet valid: used before its start time | `not_yet_valid` | yes |
| 4 | Replayed challenge at issue time: an old assertion on a new, bigger mandate | `bad_signature` | yes |
| 5 | Amount above max: £99 when she allowed £32.31 | `amount_above_max` | yes |
| 6 | Voucher instead of cash | `action_not_allowed` | yes |
| 7 | Out-of-scope matter: her mobile contract | `action_not_allowed` | yes |
| 8 | Wrong counterparty: her Broadbandly mandate shown to another company | `wrong_counterparty` | yes |
| 9 | Revoked mid-call: STOP after the first check | `revoked` | yes |
| 10 | Wrong key: a self-signed mandate posing as the Gateway | `bad_key` | yes |

| Honest call | Reason code | Allowed |
|---|---|---|
| Make the claim she signed for | `ok` | yes |
| Accept £32.31 in cash, the amount she signed for | `ok` | yes |

Honest notes: the key is self-certifying tonight (the mandate carries its own public key; a directory or attestation issuer is the roadmap). A landline mandate is signed by the Gateway (`gateway-attested`), not by a passkey (`device-biometric`). Sign counts are not checked, because a third party sees one assertion; the window, the nonce and revocation bound replay instead.

**The attack this table can't show.** Because the key is self-certifying, a fresh mandate signed with a forger's *own* passkey passes this offline check. The Gateway closes it: a company asks Tempo about the mandate id *and its digest*, and Tempo answers "active" only for the exact mandate it issued, so the forgery is refused as `status_unreachable` (tests/integration/test_mandates.py, `test_a_well_signed_mandate_tempo_did_not_issue_is_refused`).

Regenerate: `TEMPO_UPDATE_DOCS=1 uv run pytest tests/policy/test_passport_redteam.py`.

## Latency

`scripts/bench_passport.py`: the same signed mandate checked 1,000 times on one laptop (Darwin arm64, Python 3.12.14). Not a CI gate.

| Call | p50 (ms) | p99 (ms) |
|---|---|---|
| `verify`: signature, window and revocation | 0.064 | 0.096 |
| `check_envelope`: read the JSON, verify, then check the request | 0.071 | 0.098 |
