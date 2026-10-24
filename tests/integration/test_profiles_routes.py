"""Profile and skill routes (SHIPPING §4.5) on a Gateway built in memory: the bearer, the
catalogue, share → import round trip, and every refusal a pasted code can earn. Nothing is
persisted by an import."""

from __future__ import annotations

import base64
import json
from collections.abc import Iterator
from pathlib import Path
from typing import Annotated, Any

import pytest
from fastapi import Header, HTTPException
from fastapi.testclient import TestClient

from tempo_adapters.settings import Settings
from tempo_core.profiles import ProfileCatalog
from tempo_gateway.app import create_app
from tempo_gateway.main import build_service
from tempo_gateway.profiles import profiles_router

TOKEN = "mission-control-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
ORIGIN = "https://tempo.example.test"
ROOT = Path(__file__).resolve().parents[2]
CATALOG = ProfileCatalog.load(ROOT / "profiles", ROOT / "skills")
STARTERS = [
    "am-i-owed", "carer", "commuter", "hard-of-hearing", "new-to-the-uk", "read-it-to-me",
    "take-your-time",
]  # fmt: skip


def web_caller(authorization: Annotated[str | None, Header()] = None) -> str:
    """The test's stand-in for create_app's bearer dependency (same contract, same 401)."""
    if authorization != f"Bearer {TOKEN}":
        raise HTTPException(401, "a valid bearer token is required")
    return "web:test"


@pytest.fixture
def gateway(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_mode="replay", tempo_api_token=TOKEN,
        web_origins=f"{ORIGIN}, http://localhost:3000",
        checkpoint_dir=str(tmp_path / "checkpoints"), payment_check_after_s=0,
    )  # fmt: skip
    service, bus = build_service(settings)
    app = create_app(service, settings, bus)
    origin = settings.web_origins.split(",")[0].strip()
    app.include_router(profiles_router(CATALOG, web_caller, web_origin=origin))
    with TestClient(app) as client:
        yield client


def code_of(data: dict[str, Any]) -> str:
    raw = json.dumps(data, sort_keys=True, separators=(",", ":")).encode()
    return "tp1." + base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def decode(code: str) -> dict[str, Any]:
    body = code.removeprefix("tp1.")
    data: dict[str, Any] = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    return data


def test_every_route_needs_the_bearer(gateway: TestClient) -> None:
    gets = ["/skills", "/profiles", "/profiles/commuter", "/profiles/commuter/share"]

    assert [gateway.get(path).status_code for path in gets] == [401] * 4
    assert gateway.post("/profiles/import", json={"code": "tp1.x"}).status_code == 401
    assert gateway.get("/skills", headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_the_catalogue_lists_the_public_profiles_and_the_skills(gateway: TestClient) -> None:
    profiles = gateway.get("/profiles", headers=AUTH).json()["profiles"]
    skills = gateway.get("/skills", headers=AUTH).json()["skills"]

    assert [p["id"] for p in profiles] == STARTERS
    assert all(p["share"]["public"] for p in profiles)
    assert all(p["jobs"] and p["skills"][0]["jobs"] for p in profiles)
    assert sorted(s["id"] for s in skills) == sorted(CATALOG.skills)
    assert {s["id"]: s["needs"] for s in skills}["clawback-uk-rail"] == ["claim", "accept_cash"]


def test_detail_is_the_view_and_an_unknown_id_is_404(gateway: TestClient) -> None:
    r = gateway.get("/profiles/commuter", headers=AUTH)
    missing = gateway.get("/profiles/nobody", headers=AUTH)

    assert r.status_code == 200
    view = r.json()
    rail, decay = CATALOG.skills["clawback-uk-rail"], CATALOG.skills["rights-decay"]
    assert [s["id"] for s in view["skills"]] == ["clawback-uk-rail", "rights-decay"]
    assert view["jobs"] == [*rail.jobs, *decay.jobs]
    assert view["limits"] == {"max_gbp_per_claim": "250.00", "max_user_questions": 2,
                              "max_llm_gbp_per_mission": "0.20", "mandate_days": 7}  # fmt: skip
    assert view["access"]["language"] == "en" and view["time_value_gbp_h"] == "18.00"
    assert missing.status_code == 404 and missing.json() == {"detail": "no profile has this id"}


def test_share_then_import_round_trips(gateway: TestClient) -> None:
    share = gateway.get("/profiles/commuter/share", headers=AUTH).json()
    detail = gateway.get("/profiles/commuter", headers=AUTH).json()

    imported = gateway.post("/profiles/import", json={"code": share["code"]}, headers=AUTH)

    assert share["code"].startswith("tp1.")
    assert share["url"] == f"{ORIGIN}/profiles/import#p={share['code']}"
    assert imported.status_code == 200 and imported.json() == detail


def test_a_tampered_code_is_refused_with_a_reason(gateway: TestClient) -> None:
    code = gateway.get("/profiles/commuter/share", headers=AUTH).json()["code"]
    narrower = code_of(decode(code) | {"may": ["escalate"]})
    damaged = code[:-6] + "!!!!!!"

    r1 = gateway.post("/profiles/import", json={"code": narrower}, headers=AUTH)
    r2 = gateway.post("/profiles/import", json={"code": damaged}, headers=AUTH)
    r3 = gateway.post("/profiles/import", json={"code": "tp1.bm90IGpzb24"}, headers=AUTH)

    assert r1.status_code == 422
    assert r1.json()["detail"] == (
        "skill 'clawback-uk-rail' needs claim, accept_cash, which profile 'commuter' does not "
        "allow in `may`"
    )
    assert r2.status_code == 422 and "don't belong" in r2.json()["detail"]
    assert r3.status_code == 422 and r3.json()["detail"].startswith("the share code doesn't hold")


def test_an_oversize_code_is_413_before_anything_is_decoded(gateway: TestClient) -> None:
    r = gateway.post("/profiles/import", json={"code": "tp1." + "a" * 5000}, headers=AUTH)

    assert r.status_code == 413
    assert r.json() == {"detail": "a share code is at most 4096 bytes"}


def test_a_code_may_allow_more_than_a_skill_needs_but_never_less(gateway: TestClient) -> None:
    base = decode(gateway.get("/profiles/commuter/share", headers=AUTH).json()["code"])
    wider = base | {
        "id": "my-commuter", "may": ["claim", "accept_cash", "escalate", "accept_voucher"],
        "may_not": ["call", "discuss_other_accounts", "change_contract"],
    }  # fmt: skip
    narrower = base | {"id": "my-commuter", "may": ["claim", "escalate"]}

    ok = gateway.post("/profiles/import", json={"code": code_of(wider)}, headers=AUTH)
    refused = gateway.post("/profiles/import", json={"code": code_of(narrower)}, headers=AUTH)

    assert ok.status_code == 200 and "accept_voucher" in ok.json()["may"]
    assert refused.status_code == 422 and "needs accept_cash" in refused.json()["detail"]


def test_an_import_never_persists(gateway: TestClient) -> None:
    base = decode(gateway.get("/profiles/commuter/share", headers=AUTH).json()["code"])
    mine = base | {"id": "my-commuter", "share": {"public": True, "author": "me"}}

    imported = gateway.post("/profiles/import", json={"code": code_of(mine)}, headers=AUTH)

    assert imported.status_code == 200
    assert gateway.get("/profiles/my-commuter", headers=AUTH).status_code == 404
    assert len(gateway.get("/profiles", headers=AUTH).json()["profiles"]) == len(STARTERS)


def test_a_private_profile_is_hidden_from_the_list_but_not_from_its_link() -> None:
    public = CATALOG.get("commuter")
    assert public is not None
    private = public.model_copy(
        update={"id": "just-me", "share": public.share.model_copy(update={"public": False})}
    )
    router = profiles_router(ProfileCatalog([private, public], CATALOG.skills), web_caller,
                             web_origin=ORIGIN)  # fmt: skip
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        listed = client.get("/profiles", headers=AUTH).json()["profiles"]
        detail = client.get("/profiles/just-me", headers=AUTH)

    assert [p["id"] for p in listed] == ["commuter"]
    assert detail.status_code == 200 and detail.json()["share"]["public"] is False
