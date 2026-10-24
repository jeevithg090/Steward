"""Tempo domain core.

Pure Python with no I/O: models, the Rights Engine, the Consent Ledger, the mission state
machine, the Arbiter and the Time Ledger. Nothing here imports adapters, vendors or network code,
so every decision about money, eligibility and consent is deterministic and unit-tested."""
