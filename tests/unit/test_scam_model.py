"""The shipped text model (docs/scam-shield.md §4): the same answer as the trainer, in pure Python."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from tempo_core.scam_model import MIN_WORDS, NORMALISER, ScamModel, Zones, normalise, tokens

ROOT = Path(__file__).resolve().parents[2]
MODEL = ScamModel.load(ROOT / "skills" / "scam-shield" / "model.json")
VECTORS = json.loads((ROOT / "fixtures" / "signals" / "model_vectors.json").read_text())


@pytest.mark.parametrize("case", VECTORS["cases"], ids=[c["text"][:30] for c in VECTORS["cases"]])
def test_the_model_reproduces_the_trainers_probabilities(case: dict[str, Any]) -> None:
    score = MODEL.score(case["text"], families=case["families"])
    assert abs(score.probability - case["probability"]) < 1e-3
    assert score.zone == case["zone"]


def test_the_model_file_carries_its_provenance_and_metrics() -> None:
    assert MODEL.normaliser == NORMALISER and VECTORS["model_version"] == MODEL.version
    licences = {d.licence for d in MODEL.datasets}
    assert "CC BY 4.0" in licences and any("made up" in lic for lic in licences)  # declared
    assert MODEL.metrics["auc"] > 0.98 and MODEL.metrics["precision_at_warn"] >= 0.95
    assert 0 < MODEL.zones.quiet < MODEL.zones.warn < 1


def test_normalisation_replaces_what_varies_and_keeps_what_matters() -> None:
    text = "HMRC: refund of £248.20 at http://hmrc-refunds-gov.uk/claim, code 482913, ring 0345 720 3040"
    assert normalise(text) == (
        "hmrc: refund of <money> at <url> <brandlook> , code <otp> , ring <phone>"
    )
    assert "<email>" in normalise("write to help@hsbc-secure.co today")


def test_tokens_include_families_and_link_findings() -> None:
    found = tokens("Claim now at bit.ly/x", families=["scam_urgency"])
    assert {
        "claim",
        "claim now",
        "<url>",
        "<shortlink>",
        "fam:scam_urgency",
        "link:shortener",
    } <= set(found)


def test_a_scam_text_scores_high_and_a_plain_one_low() -> None:
    scam = MODEL.score(
        "URGENT! You have won a £1000 prize. Call 09061701461 now to claim. 150p/min"
    )
    plain = MODEL.score("Running late, see you at the cafe in ten minutes x")
    assert scam.probability > 0.9 and scam.zone == "warn" and scam.top_words
    assert plain.probability < 0.2 and plain.zone == "quiet"


def test_a_tiny_message_can_hold_but_never_speak() -> None:
    assert MIN_WORDS == 3
    score = MODEL.score("87121")
    assert score.zone != "warn"


def test_zones_are_ordered() -> None:
    zones = Zones(warn=0.9, quiet=0.1, link=0.2)
    assert [zones.of(p) for p in (0.95, 0.5, 0.05)] == ["warn", "sandbox", "quiet"]


def test_an_old_model_file_is_refused(tmp_path: Path) -> None:
    stale = json.loads((ROOT / "skills" / "scam-shield" / "model.json").read_text())
    stale["normaliser"] = "v0"
    path = tmp_path / "model.json"
    path.write_text(json.dumps(stale))
    with pytest.raises(ValueError, match="make scam-train"):
        ScamModel.load(path)
