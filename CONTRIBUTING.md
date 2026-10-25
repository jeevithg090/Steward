# Contributing to Tempo

Tempo is Apache-2.0 and built in the open. The shortest way in is a use case, not code:
[docs/add-a-usecase.md](docs/add-a-usecase.md) takes you from "my train operator isn't covered"
to a pull request in about ten minutes, with one YAML file. This page covers everything else.

## Setup

```bash
brew install uv gitleaks     # or see https://docs.astral.sh/uv/ and https://github.com/gitleaks/gitleaks
make setup                   # uv sync, pre-commit hooks, web deps, Docker services if present
cp .env.example .env         # then fill in your keys; .env is gitignored
make doctor                  # one cheap call per service
```

Everything runs with no keys in replay mode (`TEMPO_MODE=replay`, the default). A
`DATABASE_URL` in `.env` is used by every local Gateway, `make seed` and `make db-migrate` run,
so point it at a database you are happy to write to (see [docs/deploy.md](docs/deploy.md)).

## Coding standards

1. **Types everywhere.** `mypy --strict` must pass for `tempo_core`, `tempo_harness`,
   `tempo_memory`, `tempo_crypto` and `tempo_passport` (the `packages` list in `pyproject.toml`).
2. **Small modules (≤300 lines) and functions (≤40 lines).** Each module has one responsibility.
3. **No business logic in adapters or the Gateway.** They translate, then call application services.
4. **Every I/O call has a timeout.** Retry only idempotent calls, with exponential backoff and at
   most 2 attempts.
5. **Idempotency keys** on every binding action (`file_claim`, `phone_company`) and every webhook.
6. **Errors** are typed exceptions in `tempo_core.errors`. Never swallow one. Map them to
   user-friendly text in exactly one place.
7. **No PII in logs.** Allowlisted fields only (`LOG_KEYS` in `tempo_adapters/telemetry.py`);
   phone numbers are hashed; evidence is referenced by ID. `tests/integration/test_canary.py`
   checks it end to end.
8. **Money is `Decimal`; time is timezone-aware UTC** (`datetime.now(tz=UTC)`). Display in
   Europe/London.
9. **Secrets** live only in `.env` or the platform's environment. `.env.example` documents them.
   gitleaks blocks commits that contain one.
10. **Feature flags:** `TEMPO_MODE=live|replay` and `TEMPO_DEMO=1` toggle Replay adapters and the
    honesty badge.
11. **Plain words.** Everything Tempo says to a person scores Flesch ≥ 60, checked by
    `tests/unit/test_plain_language.py`; add new message families there.
12. **Docstrings** on public functions say *why*, not *what*.
13. **ADRs** (`docs/adr/`, half a page each) for every irreversible decision.

The architecture rules behind these are in [docs/architecture.md](docs/architecture.md); the
security rules are in [docs/security.md](docs/security.md).

## Tests

| Marker | What it tests | Runs on |
|---|---|---|
| `unit` | Domain logic, including Hypothesis property tests | pre-commit + every push |
| `contract` | Adapters against recorded fixtures (respx) | every push |
| `policy` | Harness interceptors, table-driven | every push |
| `workflow` | MAF workflows with fakes: pause, resume, crash, restore, timers | every push |
| `integration` | Gateway + Postgres: API, webhooks, signatures, idempotency | every push (CI services) |
| `e2e` | Playwright: Mission Control, passkey approval, latency | merges to `main` (GitLab), by hand (`make e2e`) |
| `eval` | LLM quality (costs tokens) | `make evals`, every 3–4 h |
| `live` | One real call per vendor | `make doctor`, before the demo |

A test's marker is the first folder under `tests/` (for example `tests/unit/test_rules.py` is
`unit`). `make check` runs lint, types and the fast markers in under 60 s: run it constantly.
`make ship-check` adds the skill and profile validator and the web app in both modes; it is
what CI runs.

## Branches and merge requests (GitLab first)

- The project lives on GitLab: <https://gitlab.com/na-group4693543/Tempo>. Its pipeline
  (`.gitlab-ci.yml`) is the one that gates `main`.
- **Trunk-based** with short-lived branches named after the build step or the skill, e.g.
  `s1.2-rights-engine` or `skill-water-refunds`. Merge at least every 2 hours.
- `main` is protected: merges only through a merge request with a **green pipeline** and all
  threads resolved.
- Keep many small commits on branches.
- Fill in the MR template: what and why (with the spec or `SHIPPING.md` section), the Delta
  thread, and the checklist (`demo_values` / `last_verified`, Flesch ≥ 60, no PII in logs, tests
  by marker, `make check`).
- One **Delta thread per build step** (for example "S1.2 Rights Engine"): brainstorm, build and
  test there, and link it in the MR.

**GitHub mirror.** <https://github.com/jeevithg090/Tempo> carries the same `main`, with its own
Actions workflow (`.github/workflows/ci.yml`), issue and PR templates and Dependabot, so people
who live on GitHub can fork, open a pull request and get the same checks. A pull request accepted
there is pushed to GitLab by a maintainer (`git push gitlab main`); [docs/github-setup.md](docs/github-setup.md)
covers the mirror.

**Pairing live in one checkout.** Two sessions sharing a working tree commit with
`git commit --no-verify` and run `make check` by hand: the pre-commit hooks stash every unstaged
file while they run, and a write made in that window can be lost.

## Two sessions, one checkout

Sometimes two people (or two coding sessions) share one working tree while pairing live. The
pre-commit hooks stash and restore every unstaged file, which cuts the ground from under whoever
is mid-edit. The rule, from `SHIPPING.md` §3:

- Only when pairing live in one checkout, commit with `git commit --no-verify` and **run
  `make check` by hand before you push** (`make ship-check` if you touched skills, profiles or
  the web app). Say so in the pull request.
- Never otherwise. On your own branch the hooks run, and gitleaks is the last thing between a
  pasted key and the public internet.
- Each person edits only the files they own for that stretch, and new files are preferred to
  edits of shared ones.

## Add a use case

A new operator is one rule pack; a new skill is a folder with a `skill.yaml`; a new mission is
Python that copies `tempo_missions.clawback_ofcom`; a profile composes skills for a kind of
person. Each path, the schema fields, the honesty rule and a ten-minute walkthrough that ends in
a pull request are in [docs/add-a-usecase.md](docs/add-a-usecase.md). If you'd rather describe
the use case and let someone else write the YAML, open a **New use case** issue; the form asks
for exactly what the pack needs.

## Owners

See [CODEOWNERS](CODEOWNERS). On GitHub it requests reviews automatically and branch protection
requires a code owner's approval; on GitLab Free it documents ownership and reviewers are
assigned by hand.

## Conduct and security

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) (Contributor Covenant 2.1) applies everywhere the
project happens. Vulnerabilities go through [SECURITY.md](SECURITY.md), never a public issue.
