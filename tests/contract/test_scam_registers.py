"""Scam Shield's registers (S7.3) against recorded answers (fixtures/scam, synthetic)."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import httpx

from tempo_adapters.scam import Registers, WarningList, registers_from_fixtures
from tempo_core.scam import Level, assess

SCAM = Path(__file__).resolve().parents[2] / "fixtures" / "scam"
TODAY = date(2026, 10, 24)


async def test_a_known_clone_firm_is_flagged() -> None:
    registers = registers_from_fixtures(SCAM, today=TODAY)

    firm = await registers.check("Barclays Wealth Desk", phone="020 7946 0000")

    assert firm.on_warning_list is True
    assert assess("We can move your savings somewhere safer", firm).level is Level.LIKELY_SCAM


async def test_an_authorised_firm_passes_and_a_clone_of_it_does_not() -> None:
    registers = registers_from_fixtures(SCAM, today=TODAY)

    real = await registers.check(
        "Halifax", phone="0345 720 3040", website="https://www.halifax.co.uk/help"
    )
    clone = await registers.check("Halifax", phone="020 7946 0999")

    assert (real.fca_authorised, real.contact_matches_register, real.company_active) == (
        True,
        True,
        True,
    )
    assert assess("Your statement is ready", real).level is Level.NO_FLAGS
    assert clone.contact_matches_register is False
    assert assess("Your statement is ready", clone).level is Level.LIKELY_SCAM


async def test_a_new_company_not_on_the_fca_register_is_caution() -> None:
    firm = await registers_from_fixtures(SCAM, today=TODAY).check("Quick Refund Services Ltd")

    assert (firm.fca_authorised, firm.company_age_days) == (False, 14)
    assert assess("Claim your refund", firm).level is Level.CAUTION


async def test_companies_house_unreachable_gives_unknown_never_safe() -> None:
    def down(request: httpx.Request) -> httpx.Response:
        if "company-information" in request.url.host:
            raise httpx.ConnectError("no route", request=request)
        return httpx.Response(
            200,
            json={
                "Data": [{"Name": "Halifax", "Reference Number": "169628", "Status": "Authorised"}]
            },
        )

    registers = Registers(
        httpx.AsyncClient(transport=httpx.MockTransport(down)),
        warning_list=WarningList.from_file(SCAM / "fca_warning_list.json"),
        companies_house_key="k", fca_email="e", fca_key="k", today=TODAY,
    )  # fmt: skip

    firm = await registers.check("Halifax")

    assert firm.company_active is None
    assert assess("Your statement is ready", firm).level is Level.UNKNOWN


async def test_without_keys_nothing_is_claimed() -> None:
    registers = Registers(
        httpx.AsyncClient(), warning_list=WarningList(()), companies_house_key=None,
        fca_email=None, fca_key=None,
    )  # fmt: skip

    firm = await registers.check("Halifax")

    assert (firm.fca_authorised, firm.company_active) == (None, None)
    assert assess("Hello", firm).level is Level.UNKNOWN
