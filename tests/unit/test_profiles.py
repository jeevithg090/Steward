"""Tempo Profiles (SHIPPING §4.3): the starters load and cross-check against the manifests, the
derived view is what the web shows, and a share code is accepted for one reason and refused for
every other, always with ProfileInvalid and a plain reason."""

from __future__ import annotations

import base64
import contextlib
import json
import re
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
import yaml
from hypothesis import given, settings
from hypothesis import strategies as st
from pydantic import ValidationError

from tempo_core.profiles import (
    MAX_SHARE_BYTES,
    Profile,
    ProfileCatalog,
    ProfileInvalid,
    check_against_skills,
    from_share_code,
    share_code,
)
from tempo_core.skills import SkillManifest, plain_reasons

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ProfileCatalog.load(ROOT / "profiles", ROOT / "skills")
SKILLS = CATALOG.skills
STARTERS = [
    "am-i-owed", "carer", "commuter", "hard-of-hearing", "new-to-the-uk", "read-it-to-me",
    "take-your-time",
]  # fmt: skip
JARGON = (
    "Remuneration eligibility determination necessitates comprehensive documentation verification."
)
B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"


def commuter(**overrides: Any) -> dict[str, Any]:
    profile = CATALOG.get("commuter")
    assert profile is not None
    return profile.model_dump(mode="json") | overrides


def limits(**overrides: Any) -> dict[str, Any]:
    return commuter()["limits"] | overrides


def access(**overrides: Any) -> dict[str, Any]:
    return commuter()["access"] | overrides


def encode(text: str | bytes) -> str:
    raw = text.encode("utf-8") if isinstance(text, str) else text
    return "tp1." + base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def code_of(data: dict[str, Any]) -> str:
    return encode(json.dumps(data))


# --- Loading and the view ---------------------------------------------------------------------


def test_the_starters_load_in_id_order_and_are_public() -> None:
    assert [p.id for p in CATALOG.profiles] == STARTERS
    assert CATALOG.public() == CATALOG.profiles
    assert CATALOG.get("nobody") is None
    assert sorted(SKILLS) == sorted(CATALOG.skills)


def test_the_view_lists_the_skills_and_the_union_of_their_jobs_in_order() -> None:
    profile = CATALOG.get("commuter")
    assert profile is not None

    view = CATALOG.view(profile)

    assert [s.id for s in view.skills] == ["clawback-uk-rail", "rights-decay"]
    assert view.skills[0].name == "Delay Repay for UK trains"
    assert view.jobs == SKILLS["clawback-uk-rail"].jobs + SKILLS["rights-decay"].jobs
    assert view.limits.max_gbp_per_claim == Decimal("250.00")
    shown = view.model_dump(mode="json")
    assert shown["time_value_gbp_h"] == "18.00" and shown["limits"]["max_gbp_per_claim"] == "250.00"
    assert shown["may_not"] == ["accept_voucher", "call", "discuss_other_accounts",
                                "change_contract", "share_personal_data"]  # fmt: skip


def test_a_job_two_skills_share_is_said_once() -> None:
    a = SKILLS["scam-shield"]
    b = a.model_copy(update={"id": "scam-shield-two", "jobs": (a.jobs[1], "Ring you back")})
    profile = Profile.model_validate(commuter(skills=["scam-shield", "scam-shield-two"]))

    view = ProfileCatalog([profile], {a.id: a, b.id: b}).view(profile)

    assert view.jobs == (*a.jobs, "Ring you back")


def test_money_is_decimal_and_must_be_quoted() -> None:
    profile = CATALOG.get("carer")
    assert profile is not None
    assert isinstance(profile.limits.max_gbp_per_claim, Decimal)
    assert isinstance(profile.time_value_gbp_h, Decimal)

    with pytest.raises(ValidationError) as err:
        Profile.model_validate(commuter(limits=limits(max_gbp_per_claim=250.0)))

    assert "limits.max_gbp_per_claim: write money as a quoted string" in plain_reasons(err.value)


@pytest.mark.parametrize(
    ("change", "reason"),
    [
        ({"may": ["claim", "accept_voucher"], "may_not": ["accept_voucher"]}, "accept_voucher can't be both allowed and refused"),
        ({"may": ["fly"]}, "may: unknown capability fly"),
        ({"may_not": ["claim", "claim"]}, "may_not: each capability may appear once"),
        ({"limits": limits(mandate_days=8)}, "limits.mandate_days: Input should be less than or equal to 7"),
        ({"limits": limits(mandate_days=0)}, "limits.mandate_days: Input should be greater than or equal to 1"),
        ({"limits": limits(max_user_questions=11)}, "limits.max_user_questions"),
        ({"limits": limits(max_gbp_per_claim="-1")}, "limits.max_gbp_per_claim: Input should be greater than or equal to 0"),
        ({"limits": limits(max_llm_gbp_per_mission=0.2)}, "limits.max_llm_gbp_per_mission: write money as a quoted string"),
        ({"access": access(language="fr")}, "access.language: no voice preset for 'fr'; the codes are cy, en, hi, pa, pl, ur"),
        ({"access": access(pace="fast")}, "access.pace: Input should be"),
        ({"access": access(voice="loud")}, "access.voice: Input should be"),
        ({"summary": JARGON}, "summary: reads at Flesch"),
        ({"skills": []}, "skills: Tuple should have at least 1 item"),
        ({"skills": ["clawback-uk-rail", "clawback-uk-rail"]}, "skills: each one may appear once"),
        ({"channels": ["web", "web"]}, "channels: each one may appear once"),
        ({"channels": ["fax"]}, "channels.0: Input should be"),
        ({"status": "draft"}, "status: Input should be"),
        ({"time_value_gbp_h": "0"}, "time_value_gbp_h: Input should be greater than 0"),
        ({"time_value_gbp_h": 18.0}, "time_value_gbp_h: write money as a quoted string"),
        ({"share": {"public": True}}, "share.author: Field required"),
        ({"id": "The Commuter"}, "id: String should match pattern"),
        ({"colour": "blue"}, "colour: Extra inputs are not permitted"),
    ],
)  # fmt: skip
def test_a_bad_profile_says_what_is_wrong(change: dict[str, Any], reason: str) -> None:
    with pytest.raises(ValidationError) as err:
        Profile.model_validate(commuter(**change))

    assert reason in plain_reasons(err.value), plain_reasons(err.value)


def test_a_profile_is_frozen() -> None:
    profile = CATALOG.get("commuter")
    assert profile is not None
    with pytest.raises(ValidationError):
        profile.may = ("claim", "accept_voucher")  # type: ignore[misc]


# --- Cross-checks against the manifests -------------------------------------------------------


def test_every_skill_must_have_a_manifest() -> None:
    profile = Profile.model_validate(commuter(skills=["clawback-uk-rail", "teleport"]))

    with pytest.raises(ProfileInvalid, match="turns on 'teleport', but no skill has that manifest"):
        check_against_skills(profile, SKILLS)


def test_a_profile_must_allow_what_its_skills_need() -> None:
    profile = Profile.model_validate(commuter(may=["escalate"]))

    with pytest.raises(ProfileInvalid, match="'clawback-uk-rail' needs claim, accept_cash"):
        check_against_skills(profile, SKILLS)
    with pytest.raises(ProfileInvalid, match="needs claim, accept_cash"):
        ProfileCatalog([profile], SKILLS)


def test_a_profile_may_allow_more_than_its_skills_need() -> None:
    wider = Profile.model_validate(
        commuter(may=["claim", "accept_cash", "escalate", "accept_voucher"],
                 may_not=["call", "discuss_other_accounts", "change_contract"])
    )  # fmt: skip

    check_against_skills(wider, SKILLS)  # no error: a profile widens, a manifest only requires


def test_two_profiles_cannot_share_an_id() -> None:
    profile = CATALOG.get("commuter")
    assert profile is not None
    with pytest.raises(ProfileInvalid, match="two profiles share the id 'commuter'"):
        ProfileCatalog([profile, profile], SKILLS)


def test_loading_names_the_file(tmp_path: Path) -> None:
    profiles = tmp_path / "profiles"
    profiles.mkdir()
    (profiles / "mine.yaml").write_text(yaml.safe_dump(commuter()))
    with pytest.raises(
        ProfileInvalid, match=re.escape("mine.yaml: id 'commuter' must equal the file name")
    ):
        ProfileCatalog.load(profiles, ROOT / "skills")

    (profiles / "mine.yaml").write_text(yaml.safe_dump(commuter(id="mine", summary=JARGON)))
    with pytest.raises(ProfileInvalid, match=re.escape("mine.yaml: summary: reads at Flesch")):
        ProfileCatalog.load(profiles, ROOT / "skills")

    with pytest.raises(ProfileInvalid, match="no profiles folder"):
        ProfileCatalog.load(tmp_path / "nowhere", ROOT / "skills")


# --- Share codes -------------------------------------------------------------------------------


def test_the_share_code_is_canonical_json_behind_the_prefix() -> None:
    profile = CATALOG.get("commuter")
    assert profile is not None

    code = share_code(profile)

    assert code.startswith("tp1.") and "=" not in code and re.fullmatch(f"[{B64}]+", code[4:])
    body = base64.urlsafe_b64decode(code[4:] + "=" * (-len(code[4:]) % 4))
    data = json.loads(body)
    assert body == json.dumps(data, sort_keys=True, separators=(",", ":")).encode()
    assert data["limits"]["max_gbp_per_claim"] == "250.00" and data["id"] == "commuter"
    assert len(code.encode()) <= MAX_SHARE_BYTES


@pytest.mark.parametrize("profile", CATALOG.profiles, ids=lambda p: str(p.id))
def test_every_starter_round_trips(profile: Profile) -> None:
    code = share_code(profile)

    back = from_share_code(code, SKILLS)

    assert back == profile
    assert share_code(back) == code


def test_a_code_may_widen_but_never_drop_what_a_skill_needs() -> None:
    wider = code_of(commuter(may=["claim", "accept_cash", "escalate", "accept_voucher"],
                             may_not=["call", "discuss_other_accounts", "change_contract"]))  # fmt: skip
    narrower = code_of(commuter(may=["claim", "escalate"]))

    assert "accept_voucher" in from_share_code(wider, SKILLS).may
    with pytest.raises(ProfileInvalid, match="needs accept_cash"):
        from_share_code(narrower, SKILLS)


@pytest.mark.parametrize(
    ("code", "reason"),
    [
        ("tp1." + "a" * (MAX_SHARE_BYTES - 3), "this share code is too long: over 4096 bytes"),
        ("tp2.abc", "this is not a Tempo profile code: it should start with tp1."),
        ("", "this is not a Tempo profile code"),
        ("tp1.ab$c", "characters that don't belong in it"),
        ("tp1.a", "the share code is damaged and can't be read"),
        (encode(b"\xff\xfe\xfd"), "the share code is damaged and can't be read"),
        (encode("not json"), "the share code doesn't hold a profile"),
        (encode("[" * 3000), "the share code doesn't hold a profile"),
        (encode("[1, 2]"), "a profile is a set of named fields"),
        (encode('{"id": "x"}'), "name: Field required"),
        (code_of(commuter(skills=["teleport"])), "no skill has that manifest"),
        (code_of(commuter(limits=limits(mandate_days=30))), "limits.mandate_days"),
        (code_of(commuter(may=["claim", "call"], may_not=["call"])), "both allowed and refused"),
    ],
)
def test_a_bad_code_is_refused_with_a_plain_reason(code: str, reason: str) -> None:
    with pytest.raises(ProfileInvalid, match=re.escape(reason)):
        from_share_code(code, SKILLS)


@settings(max_examples=150, deadline=None)
@given(st.text())
def test_any_text_raises_only_profile_invalid(text: str) -> None:
    with contextlib.suppress(ProfileInvalid):
        from_share_code(text, SKILLS)


@settings(max_examples=150, deadline=None)
@given(st.one_of(st.text(alphabet=B64), st.binary().map(lambda b: encode(b)[4:])))
def test_any_body_behind_the_prefix_raises_only_profile_invalid(body: str) -> None:
    with contextlib.suppress(ProfileInvalid):
        from_share_code("tp1." + body, SKILLS)


@settings(max_examples=150, deadline=None)
@given(st.data())
def test_a_damaged_starter_code_is_refused_or_is_a_profile(data: st.DataObject) -> None:
    profile = data.draw(st.sampled_from(CATALOG.profiles))
    code = share_code(profile)
    at = data.draw(st.integers(min_value=4, max_value=len(code) - 1))
    swap = data.draw(st.sampled_from(B64))
    damaged = code[:at] + swap + code[at + 1 :]

    try:
        back = from_share_code(damaged, SKILLS)
    except ProfileInvalid:
        return
    assert isinstance(back, Profile)  # a lucky edit is still a fully checked profile
    assert all(need in back.may for s in back.skills for need in SKILLS[s].needs)


def test_a_manifest_mapping_is_what_the_catalog_hands_out() -> None:
    assert all(isinstance(m, SkillManifest) for m in SKILLS.values())
    with pytest.raises(TypeError):
        SKILLS["x"] = SKILLS["scam-shield"]  # type: ignore[index]
