"""Shared pytest configuration.

A test's first folder under tests/ is its marker (tests/unit/... is marked ``unit``), so
`make check` can select the fast layers without every file repeating ``pytestmark``.
"""

from pathlib import Path

import pytest

_TESTS_DIR = Path(__file__).parent
_LAYER_MARKERS = frozenset(
    {"unit", "contract", "policy", "workflow", "integration", "e2e", "eval", "live"}
)


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    for item in items:
        try:
            layer = item.path.relative_to(_TESTS_DIR).parts[0]
        except ValueError:
            continue
        if layer in _LAYER_MARKERS:
            item.add_marker(getattr(pytest.mark, layer))


@pytest.fixture(autouse=True)
def _no_database_url(monkeypatch: pytest.MonkeyPatch) -> None:
    """Tests never use DATABASE_URL: a Gateway built in a test is in memory unless the test
    says otherwise, and database tests use TEST_DATABASE_URL (tests/integration/conftest.py).
    Without this, an exported DATABASE_URL (CI sets one for migrations) would point every
    Gateway test at one shared database, and each would see the others' rows."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
