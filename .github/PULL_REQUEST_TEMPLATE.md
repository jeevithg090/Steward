## What and why

<!-- One paragraph. Which beat of the story does this touch (SHIPPING.md §1), or which use case
     (docs/add-a-usecase.md)? Link the issue. -->

## How to see it

<!-- The command or page a reviewer runs, in replay mode with no keys:
     `make demo-dry-run`, `make showcase`, `uv run pytest tests/unit/test_rules.py`, ... -->

## Honesty checklist

- [ ] **Demo values.** Any new or changed rule pack, clock or figure keeps `demo_values: true` until
      a person has checked the published source; a pack with `demo_values: false` says `last_verified`
      (`packages/tempo_core/src/tempo_core/rules/schema.py`).
- [ ] **Plain words.** Every sentence Tempo says to a person scores Flesch ≥ 60; new message
      families are added to `tests/unit/test_plain_language.py`.
- [ ] **No PII in logs or traces.** New log lines use only the allowlisted keys in
      `packages/tempo_adapters/src/tempo_adapters/telemetry.py` (`LOG_KEYS`); if you touched logging
      or tracing, `tests/integration/test_canary.py` still passes.
- [ ] **Tests by marker.** New tests sit in the folder that names their marker
      (`tests/unit`, `contract`, `policy`, `workflow`, `integration`, `e2e`).
- [ ] **`make check` is green** locally (`make ship-check` if you touched skills, profiles or
      `apps/web`).
- [ ] **Replay mode works** with no keys and no network (`TEMPO_MODE=replay`, the default).
- [ ] **Docs follow the code:** README status table, an ADR for an irreversible decision, the skill's
      `skill.yaml` if its jobs or `needs` changed, `docs/security.md` if a guard changed.
- [ ] **No secrets.** The gitleaks hook ran. If you committed with `--no-verify` while pairing in one
      checkout (CONTRIBUTING.md), say so here and confirm you ran `make check` by hand.

## Demo impact

<!-- Which hero beat changes, or "none". -->
