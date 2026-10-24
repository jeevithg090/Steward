import importlib

import pytest

pytestmark = pytest.mark.unit

PACKAGES = [
    "tempo_core",
    "tempo_ports",
    "tempo_adapters",
    "tempo_harness",
    "tempo_missions",
    "tempo_memory",
    "tempo_crypto",
]


@pytest.mark.parametrize("name", PACKAGES)
def test_packages_import(name: str) -> None:
    module = importlib.import_module(name)
    assert module.__doc__, f"{name} needs a docstring saying what it is for"
