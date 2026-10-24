"""The TemporalPort contract (S3.8) on the in-process twin; Postgres runs it in integration."""

from __future__ import annotations

import pytest

from tempo_memory.temporal import InMemoryTemporal
from tempo_memory.temporal_contract import TemporalPortContract


class TestInMemoryTemporal(TemporalPortContract):
    @pytest.fixture
    def temporal(self) -> InMemoryTemporal:
        return InMemoryTemporal()
