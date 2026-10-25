# One-word commands for the whole team (build plan A5). Run `make` to list them.
.DEFAULT_GOAL := help
FAST_MARKERS := unit or contract or policy or workflow

# pytest exits 5 when a marker selects no tests yet; that is not a failure.
define pytest_marker
	uv run pytest -m "$(1)" $(2) || [ $$? -eq 5 ]
endef

.PHONY: help setup check fmt test-int e2e evals doctor local calibrate rights-backtest demo demo-gateway demo-dry-run demo-rehearsal db-migrate sync-voice seed new-skill validate-skills catalog showcase web-check ship-check deploy-web scam-train refresh-feeds

help: ## List the commands
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  make %-14s %s\n", $$1, $$2}'

setup: ## uv sync, pre-commit hooks, web deps, local services
	uv sync
	uv run pre-commit install
	@if [ -f apps/web/package.json ]; then cd apps/web && npm ci; fi
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

e2e: ## Playwright smoke: the chat door and every page, against a replay Gateway (tests/e2e)
	@if [ ! -f tests/e2e/package.json ]; then echo "No e2e suite yet (it arrives with S5.1)."; exit 1; fi
	cd tests/e2e && npm ci && npx playwright test

evals: ## LLM quality evals (costs tokens); appends to evals/report.md
	$(call pytest_marker,eval,-rs)

doctor: ## Check every key and service with one cheap live call
	uv run python scripts/doctor.py

local: ## Local mode: Postgres, Ollama and the Gateway on this machine (deploy/local)
	./deploy/local/install.sh

calibrate: ## Fit the delay model, hold out a week: docs/calibration.png and docs/backtest.md
	uv run python scripts/calibrate_delay_model.py

rights-backtest: ## Fit Rights Decay's curves from .data/, write docs/rights_*.md and the chart
	uv run --with openpyxl python scripts/rights_backtest.py

demo: ## One command: Gateway from a scratch folder on 8000, seeded, and the web app on 3000
	./scripts/demo.sh

demo-gateway: ## Just the Gateway, from a scratch folder, seeded
	./scripts/demo.sh --gateway-only

demo-dry-run: ## Scripted demo in replay mode, with a mid-mission restart and timings
	uv run python scripts/demo_dry_run.py

demo-rehearsal: ## Three dry runs in a row: all three must pass (build plan S6.4)
	@for run in 1 2 3; do echo "== rehearsal $$run"; uv run python scripts/demo_dry_run.py | tail -9 || exit 1; \
		uv run python scripts/demo_dry_run_ofcom.py | tail -8 || exit 1; done

sync-voice: ## Push voice/**/*.yaml agent configs to ElevenLabs
	uv run python voice/sync.py

seed: ## Put the demo's people into a running Gateway (needs TEMPO_API_TOKEN)
	uv run python scripts/seed.py

db-migrate: ## Bring the database in DATABASE_URL up to the latest schema
	uv run alembic upgrade head

# --- Shipping (SHIPPING.md): skills, profiles, the web showcase and deployment -------------------

new-skill: ## Scaffold a skill: make new-skill id=water-refund name="Water refunds" [needs=claim,accept_cash] [rules=fixed_amount|delay_repay|none]
	uv run python scripts/new_skill.py --id "$(id)" --name "$(name)" --needs "$(needs)" --rules "$(or $(rules),none)"

validate-skills: ## Check that every rule pack, skill manifest and profile loads and agrees
	uv run python scripts/validate_skills.py

catalog: ## Regenerate apps/web/src/showcase/catalog.json from profiles/ and skills/*/skill.yaml
	cd apps/web && npm run catalog

showcase: ## The web app on recorded data with no Gateway: http://localhost:3000
	cd apps/web && VITE_TEMPO_SHOWCASE=1 npm run dev

web-check: ## Typecheck, test and build the web app, in both modes
	cd apps/web && npm run typecheck && npm test && npm run build && VITE_TEMPO_SHOWCASE=1 npx vite build

ship-check: check validate-skills web-check ## Everything CI runs, locally

deploy-web: ## Deploy apps/web to Vercel from this machine (run `npx vercel login` once first)
	npx vercel --cwd apps/web --prod

# --- Scam Shield (docs/scam-shield.md): the text model and the public phishing lists ---------------

scam-train: ## Train Scam Shield's text model from two open SMS corpora; writes model.json and docs/scam_backtest.md
	uv run --with scikit-learn python -I scripts/scam_train.py

refresh-feeds: ## Refresh the cached phishing lists (URLhaus, OpenPhish) in fixtures/scam/feeds; keys optional
	uv run python scripts/refresh_threat_feeds.py
