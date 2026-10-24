# Contributing to Tempo

## Setup

```bash
brew install uv gitleaks     # or see https://docs.astral.sh/uv/ and https://github.com/gitleaks/gitleaks
make setup                   # uv sync, pre-commit hooks, web deps, Docker services if present
cp .env.example .env         # then fill in your keys; .env is gitignored
make doctor                  # one cheap call per service
```

## Coding standards

1. **Types everywhere.** `mypy --strict` must pass for `tempo_core` and `tempo_harness`.
2. **Small modules (≤300 lines) and functions (≤40 lines).** Each module has one responsibility.
3. **No business logic in adapters or the Gateway.** They translate, then call application services.
4. **Every I/O call has a timeout.** Retry only idempotent calls, with exponential backoff and at
   most 2 attempts.
5. **Idempotency keys** on every binding action (`file_claim`, `phone_company`) and every webhook.
6. **Errors** are typed exceptions in `tempo_core.errors`. Never swallow one. Map them to
   user-friendly text in exactly one place.
7. **No PII in logs.** Allowlisted fields only; phone numbers are hashed; evidence is referenced by ID.
8. **Money is `Decimal`; time is timezone-aware UTC** (`datetime.now(tz=UTC)`). Display in
   Europe/London.
9. **Secrets** live only in `.env` or the platform's environment. `.env.example` documents them.
   gitleaks blocks commits that contain one.
10. **Feature flags:** `TEMPO_MODE=live|replay` and `TEMPO_DEMO=1` toggle Replay adapters and the
    honesty badge.
11. **Docstrings** on public functions say *why*, not *what*.
12. **ADRs** (`docs/adr/`, half a page each) for every irreversible decision.

The architecture rules behind these are in [docs/architecture.md](docs/architecture.md).

## Tests

| Marker | What it tests | Runs on |
|---|---|---|
| `unit` | Domain logic, including Hypothesis property tests | pre-commit + every push |
| `contract` | Adapters against recorded fixtures (respx) | every push |
| `policy` | Harness interceptors, table-driven | every push |
| `workflow` | MAF workflows with fakes: pause, resume, crash, restore, timers | every push |
| `integration` | Gateway + Postgres: API, webhooks, signatures, idempotency | every push (CI services) |
| `e2e` | Playwright: Mission Control, passkey approval, latency | merges to `main`, every 2 h |
| `eval` | LLM quality (costs tokens) | `make evals`, every 3–4 h |
| `live` | One real call per vendor | `make doctor`, before the demo |

A test's marker is the first folder under `tests/` (for example `tests/unit/test_rules.py` is
`unit`). `make check` runs lint, types and the fast markers in under 60 s: run it constantly.

## Branches and merge requests

- **Trunk-based** with short-lived branches named after the build step, e.g.
  `s1.2-rights-engine`. Merge at least every 2 hours.
- `main` is protected: merges only through a merge request with a **green pipeline** and all
  threads resolved.
- Keep many small commits on branches. MLH's checks look at commit history.
- Fill in the MR template: what and why (with the spec section), the Delta thread, and the
  checklist.
- One **Delta thread per build step** (e.g. "S1.2 Rights Engine"): brainstorm, build and test there,
  and link it in the MR.

## Owners

See [CODEOWNERS](CODEOWNERS). On GitLab Free it documents ownership; assign reviewers by hand.
