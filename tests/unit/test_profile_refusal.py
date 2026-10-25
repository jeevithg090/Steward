"""Profile refusal before anything starts (plan.md §12.2): when a profile's `may` lacks what a
skill needs, the Gateway says so in plain words and starts nothing. Table-driven over the
starter profiles and the two mission skills."""

from __future__ import annotations

from pathlib import Path

import pytest

from tempo_core.capabilities import IN_PLAIN_WORDS
from tempo_core.profiles import ProfileCatalog, refusal
from tempo_core.readability import flesch_reading_ease
from tempo_gateway.engines import ENGINES, OFCOM, RAIL
from tempo_gateway.missions import MANIFESTS, NEEDS_UNKNOWN, profile_refusal

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ProfileCatalog.load(ROOT / "profiles", ROOT / "skills")
PAIRS = [(p.id, skill) for p in CATALOG.profiles for skill in (RAIL, OFCOM)]


def test_read_it_to_me_refuses_a_rail_claim_in_the_contract_words() -> None:
    assert profile_refusal(CATALOG, "read-it-to-me", RAIL) == (
        "Your profile, Read It To Me, doesn't let me file a claim or accept cash, so I haven't "
        "started. Choose another profile if you want me to file a claim."
    )


def test_the_commuter_can_claim_for_a_train_but_not_phone_a_broadband_company() -> None:
    assert profile_refusal(CATALOG, "commuter", RAIL) is None
    assert profile_refusal(CATALOG, "commuter", OFCOM) == (
        "Your profile, The Commuter, doesn't let me phone the company, so I haven't started. "
        "Choose another profile if you want me to phone the company."
    )


def test_no_profile_or_an_unknown_one_is_not_this_helpers_refusal() -> None:
    assert profile_refusal(CATALOG, None, RAIL) is None
    assert profile_refusal(None, "commuter", RAIL) is None
    assert profile_refusal(CATALOG, "nobody", RAIL) is None  # the caller's own 422


def test_a_skill_with_no_manifest_fails_closed() -> None:
    assert profile_refusal(CATALOG, "carer", "clawback.unknown") == NEEDS_UNKNOWN


def test_every_mission_engine_maps_to_a_manifest_that_names_its_workflow() -> None:
    workflows = {RAIL: "clawback_rail", OFCOM: "clawback_ofcom"}  # tempo_missions.<workflow>

    assert set(MANIFESTS) == set(ENGINES) == set(workflows)
    for skill_id, manifest_id in MANIFESTS.items():
        assert CATALOG.skills[manifest_id].mission == workflows[skill_id]


@pytest.mark.parametrize(("profile_id", "skill_id"), PAIRS)
def test_a_refusal_happens_exactly_when_may_lacks_a_need_and_reads_plainly(
    profile_id: str, skill_id: str
) -> None:
    profile = CATALOG.get(profile_id)
    assert profile is not None
    needs = CATALOG.skills[MANIFESTS[skill_id]].needs
    said = profile_refusal(CATALOG, profile_id, skill_id)

    assert (said is None) == set(needs).issubset(profile.may)
    if said is not None:
        assert said == refusal(profile, needs)
        assert flesch_reading_ease(said) >= 60, said
        assert "?," not in said  # "Am I Owed Anything?" reads as a name mid-sentence
        lacking = [IN_PLAIN_WORDS[n] for n in needs if n not in profile.may]
        assert all(words in said for words in lacking)


def test_refusal_is_none_when_every_need_is_allowed() -> None:
    carer = CATALOG.get("carer")
    assert carer is not None
    assert refusal(carer, ("claim", "call", "accept_cash", "escalate")) is None
    assert refusal(carer, ()) is None
