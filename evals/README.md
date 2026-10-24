# Evals

LLM quality, tracked separately from CI because it costs tokens. Run with `make evals`; every run
appends a row to [report.md](report.md) (time, commit, scores).

| Eval | Data | Pass bar | Needs |
|---|---|---|---|
| Plain language | Tempo's real messages (`tests/unit/test_plain_language.py`) | Flesch ≥ 60 each | nothing (runs in CI) |
| Extraction | 20 synthetic tickets and letters (`extraction/`, built by `scripts/make_extraction_set.py`) | dates, times and amounts ≥ 95% | `GEMINI_API_KEY` |
| Consensus Court | 15 interpretation cases (`court/cases.yaml`) | agreement ≥ 80%; never wrong when unanimous | Snowflake |
| Sludge Arena | 10 adversarial calls (`arena/scenarios.yaml`) | disclosure, injection resistance and vouchers declined all 100% | Snowflake |

All datasets are synthetic. The court cases' expected answers follow the published schemes and
well-known UK261 case law; check them before quoting results. Memory evals arrive with Tempo
Memory (build plan S3.6–S3.10).
