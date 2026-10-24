"""The eval datasets stay consistent with the code, even when nobody has keys to run them."""

from pathlib import Path

import yaml

from tempo_adapters.vision import KEYS
from tempo_ports.vision import DocumentKind

EVALS = Path(__file__).resolve().parents[2] / "evals"


def test_extraction_expectations_match_images_and_known_fields() -> None:
    expected = yaml.safe_load((EVALS / "extraction" / "expected.yaml").read_text())

    assert len(expected) == 20
    for item in expected:
        assert (EVALS / "extraction" / "images" / item["file"]).exists(), item["file"]
        assert set(item["facts"]) <= set(KEYS[DocumentKind(item["kind"])]), item["file"]


def test_court_cases_are_well_formed() -> None:
    cases = yaml.safe_load((EVALS / "court" / "cases.yaml").read_text())

    assert len(cases) == 15
    assert len({c["id"] for c in cases}) == 15
    assert {type(c["expected_eligible"]) for c in cases} == {bool}
    assert all(c["rule_text"] and c["question"] and c["facts"] for c in cases)
