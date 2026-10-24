"""Who is this firm, really? (build plan S7.3)

- Companies House (check): GET /search/companies?q=..., HTTP basic auth with the API key as
  the user name. Gives status (active, dissolved) and the incorporation date.
- FCA Financial Services Register API (check): GET /Search?q=...&type=firm, then
  /Firm/{FRN}/Address for the phone and website, with X-AUTH-EMAIL and X-AUTH-KEY headers.
- FCA Warning List: a cached copy (the list of firms the FCA warns about), matched by name,
  phone or website.

Any failure leaves that check as None ("couldn't check"), which Scam Shield reports as
unknown, never as fine.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import httpx

from tempo_core.scam import FirmCheck

CH_BASE = "https://api.company-information.service.gov.uk"
FCA_BASE = "https://register.fca.org.uk/services/V0.1"
SUFFIXES = re.compile(r"\b(plc|ltd|limited|llp|uk|group)\b\.?", re.I)


def normal_name(name: str) -> str:
    return " ".join(SUFFIXES.sub(" ", re.sub(r"[^\w\s]", " ", name.casefold())).split())


def normal_phone(phone: str) -> str:
    digits = re.sub(r"\D", "", phone)
    return "44" + digits[1:] if digits.startswith("0") else digits


def normal_site(site: str) -> str:
    host = re.sub(r"^https?://", "", site.strip().casefold()).split("/")[0]
    return host.removeprefix("www.")


@dataclass(frozen=True)
class WarningList:
    firms: tuple[dict[str, Any], ...]

    @classmethod
    def from_file(cls, path: Path) -> WarningList:
        return cls(tuple(json.loads(path.read_text(encoding="utf-8"))["firms"]))

    def matches(self, name: str, phone: str | None, website: str | None) -> bool:
        for firm in self.firms:
            if normal_name(firm["name"]) == normal_name(name):
                return True
            if phone and normal_phone(phone) in {normal_phone(p) for p in firm.get("phones", [])}:
                return True
            if website and normal_site(website) in {
                normal_site(w) for w in firm.get("websites", [])
            }:
                return True
        return False


class Registers:
    def __init__(
        self,
        http: httpx.AsyncClient,
        *,
        warning_list: WarningList,
        companies_house_key: str | None,
        fca_email: str | None,
        fca_key: str | None,
        today: date | None = None,
    ) -> None:
        self.http, self.warning_list, self.today = http, warning_list, today or date.today()
        self.ch_key, self.fca_email, self.fca_key = companies_house_key, fca_email, fca_key

    async def check(
        self, name: str, *, phone: str | None = None, website: str | None = None
    ) -> FirmCheck:
        authorised, contact = await self._fca(name, phone, website)
        active, age = await self._companies_house(name)
        return FirmCheck(
            name=name, on_warning_list=self.warning_list.matches(name, phone, website),
            fca_authorised=authorised, contact_matches_register=contact,
            company_active=active, company_age_days=age,
        )  # fmt: skip

    async def _fca(
        self, name: str, phone: str | None, website: str | None
    ) -> tuple[bool | None, bool | None]:
        if not (self.fca_email and self.fca_key):
            return None, None
        headers = {"X-AUTH-EMAIL": self.fca_email, "X-AUTH-KEY": self.fca_key}
        try:
            found = await self._get(
                f"{FCA_BASE}/Search", {"q": name, "type": "firm"}, headers=headers
            )
            firm = next(
                (
                    f
                    for f in found.get("Data") or []
                    if normal_name(f.get("Name", "")) == normal_name(name)
                ),
                None,
            )
            if firm is None or firm.get("Status") != "Authorised":
                return False, None
            if not (phone or website):
                return True, None
            address = await self._get(
                f"{FCA_BASE}/Firm/{firm['Reference Number']}/Address", headers=headers
            )
        except (httpx.HTTPError, ValueError):
            return None, None
        phones = {normal_phone(a.get("Phone Number", "")) for a in address.get("Data") or []}
        sites = {normal_site(a.get("Website Address", "")) for a in address.get("Data") or []}
        matches = (phone is None or normal_phone(phone) in phones) and (
            website is None or normal_site(website) in sites
        )
        return True, matches

    async def _companies_house(self, name: str) -> tuple[bool | None, int | None]:
        if not self.ch_key:
            return None, None
        try:
            query = {"q": name, "items_per_page": "5"}
            found = await self._get(f"{CH_BASE}/search/companies", query, auth=(self.ch_key, ""))
        except (httpx.HTTPError, ValueError):
            return None, None
        company = next(
            (
                c
                for c in found.get("items") or []
                if normal_name(c.get("title", "")) == normal_name(name)
            ),
            None,
        )
        if company is None:
            return None, None  # not found by that name: can't say
        created = date.fromisoformat(company["date_of_creation"])
        return company.get("company_status") == "active", (self.today - created).days

    async def _get(self, url: str, params: dict[str, str] | None = None, **kwargs: Any) -> Any:
        response = await self.http.get(url, params=params, timeout=10, **kwargs)
        response.raise_for_status()
        return response.json()


def registers_from_fixtures(folder: Path, *, today: date) -> Registers:
    """Replay mode: the recorded register answers in fixtures/scam (synthetic, labelled)."""
    files = {p.stem: json.loads(p.read_text()) for p in folder.glob("*.json")}

    def answer(request: httpx.Request) -> httpx.Response:
        query = normal_name(request.url.params.get("q", "")).replace(" ", "_")
        if request.url.path.endswith("/Address"):
            key = f"fca_address_{request.url.path.split('/')[-2]}"
        elif "fca" in request.url.host:
            key = f"fca_search_{query}"
        else:
            key = f"ch_search_{query}"
        default = {"Data": []} if "fca" in request.url.host else {"items": []}
        return httpx.Response(200, json=files.get(key, default))

    http = httpx.AsyncClient(transport=httpx.MockTransport(answer))
    return Registers(
        http, warning_list=WarningList.from_file(folder / "fca_warning_list.json"),
        companies_house_key="replay", fca_email="replay", fca_key="replay", today=today,
    )  # fmt: skip
