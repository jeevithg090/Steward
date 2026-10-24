# One-word commands for the whole team (build plan A5). Run `make` to list them.
.DEFAULT_GOAL := help
FAST_MARKERS := unit or contract or policy or workflow

# pytest exits 5 when a marker selects no tests yet; that is not a failure.
define pytest_marker
	uv run pytest -m "$(1)" $(2) || [ $$? -eq 5 ]
endef

.PHONY: help setup check fmt test-int e2e evals doctor local calibrate demo-dry-run demo-rehearsal db-migrate sync-voice seed

help: ## List the commands
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  make %-14s %s\n", $$1, $$2}'

setup: ## uv sync, pre-commit hooks, web deps, local services
	uv sync
	uv run pre-commit install
	@if [ -f apps/web/package.json ]; then cd apps/web && pnpm install; fi
	@if command -v docker >/dev/null 2>&1; then docker compose up -d; \
	else echo "Docker not found: skipping Postgres and Neo4j. Integration tests need them (CI provides both)."; fi

check: ## Lint, types and fast tests (< 60 s); run constantly
	uv run ruff check .
	uv run ruff format --check .
	uv run mypy
	$(call pytest_marker,$(FAST_MARKERS))

fmt: ## Auto-fix lint and formatting
	uv run ruff check --fix .
	uv run ruff format .

test-int: ## Integration tests (Postgres via TEST_DATABASE_URL or Docker)
	$(call pytest_marker,integration)

e2e: ## Playwright end-to-end tests
	@if [ ! -f tests/e2e/package.json ]; then echo "No e2e suite yet (it arrives with S5.1)."; exit 1; fi
	cd tests/e2e && pnpm playwright test

evals: ## LLM quality evals (costs tokens); appends to evals/report.md
	$(call pytest_marker,eval,-rs)

doctor: ## Check every key and service with one cheap live call
	uv run python scripts/doctor.py

local: ## Local mode: Postgres, Ollama and the Gateway on this machine (deploy/local)
	./deploy/local/install.sh

calibrate: ## Fit the delay model, hold out a week: docs/calibration.png and docs/backtest.md
	uv run python scripts/calibrate_delay_model.py

demo-dry-run: ## Scripted demo in replay mode, with a mid-mission restart and timings
	uv run python scripts/demo_dry_run.py

demo-rehearsal: ## Three dry runs in a row: all three must pass (build plan S6.4)
	@for run in 1 2 3; do echo "== rehearsal $$run"; uv run python scripts/demo_dry_run.py | tail -9 || exit 1; done

sync-voice: ## Push voice/**/*.yaml agent configs to ElevenLabs
	uv run python voice/sync.py

seed: ## Put the demo's people into a running Gateway (needs TEMPO_API_TOKEN)
	uv run python scripts/seed.py

db-migrate: ## Bring the database in DATABASE_URL up to the latest schema
	uv run alembic upgrade head
