"""The UK: what a postcode is in (council, ward, constituency), who the MP is, bank holidays, flood
warnings near a place, and how the London Tube is running. All official or open public data."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import quote

from .base import Context, Refused, Result, Source, Tool, geocode, need, text, where

_POSTCODE = re.compile(r"^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$")
REGIONS = {
    "england": "england-and-wales",
    "wales": "england-and-wales",
    "scotland": "scotland",
    "northern ireland": "northern-ireland",
}


async def _postcode(ctx: Context, raw: str) -> dict[str, Any]:
    postcode = " ".join(raw.upper().split())
    if not _POSTCODE.match(postcode):
        raise Refused(f"{raw!r} doesn't look like a UK postcode")
    found = await ctx.get_json(f"https://api.postcodes.io/postcodes/{quote(postcode)}")
    result: dict[str, Any] = found["result"]
    return result


async def postcode_info(ctx: Context, args: dict[str, str]) -> Result:
    """Where a UK postcode is: council, ward, constituency, region, NHS area."""
    p = await _postcode(ctx, need(args, "postcode", "which postcode", 10))
    info = {
        "postcode": p["postcode"],
        "council": p.get("admin_district"),
        "ward": p.get("admin_ward"),
        "county": p.get("admin_county"),
        "constituency": p.get("parliamentary_constituency"),
        "region": p.get("region"),
        "country": p.get("country"),
        "nhs_area": p.get("nhs_ha"),
        "latitude": p.get("latitude"),
        "longitude": p.get("longitude"),
    }
    return info, [
        Source(
            f"postcodes.io: {p['postcode']}",
            f"https://postcodes.io/postcodes/{quote(p['postcode'])}",
        )
    ]


async def my_mp(ctx: Context, args: dict[str, str]) -> Result:
    """The Member of Parliament for a postcode, from UK Parliament's own records."""
    p = await _postcode(ctx, need(args, "postcode", "their postcode", 10))
    seat = p.get("parliamentary_constituency")
    found = await ctx.get_json(
        "https://members-api.parliament.uk/api/Location/Constituency/Search",
        params={"searchText": seat, "take": 1},
    )
    items = found.get("items", [])
    member = (
        (items[0]["value"].get("currentRepresentation") or {}).get("member", {}).get("value")
        if items
        else None
    )
    if not member:
        raise Refused(f"no current MP found for {seat}")
    page = f"https://members.parliament.uk/member/{member['id']}/contact"
    return {
        "constituency": seat,
        "mp": member.get("nameDisplayAs"),
        "party": (member.get("latestParty") or {}).get("name"),
        "contact_page": page,
        "how_to_write": (
            "Write to them at the House of Commons, London SW1A 0AA, or through the contact page."
        ),
    }, [Source(f"UK Parliament: {member.get('nameDisplayAs')}", page)]


async def bank_holidays(ctx: Context, args: dict[str, str]) -> Result:
    """The next bank holidays, from GOV.UK (England and Wales unless another nation is named)."""
    nation = REGIONS.get((args.get("nation") or "england").strip().lower(), "england-and-wales")
    found = await ctx.get_json("https://www.gov.uk/bank-holidays.json")
    today = ctx.today().isoformat()
    upcoming = [
        {"date": e["date"], "name": e["title"]}
        for e in found[nation]["events"]
        if e["date"] >= today
    ][:6]
    return {"nation": nation, "upcoming": upcoming}, [
        Source("GOV.UK bank holidays", "https://www.gov.uk/bank-holidays")
    ]


async def flood_warnings(ctx: Context, args: dict[str, str]) -> Result:
    """Flood warnings in force within 15 km of a place in England (the Environment Agency)."""
    spot = await geocode(ctx, need(args, "place", "which place"))
    found = await ctx.get_json(
        "https://environment.data.gov.uk/flood-monitoring/id/floods",
        params={"lat": spot["latitude"], "long": spot["longitude"], "dist": 15},
    )
    warnings = [
        {
            "area": item.get("description"),
            "severity": item.get("severity"),
            "raised": (item.get("timeRaised") or "")[:16],
            "message": (item.get("message") or "")[:300],
        }
        for item in found.get("items", [])[:6]
    ]
    link = "https://check-for-flooding.service.gov.uk/"
    return {
        "place": where(spot),
        "warnings": warnings,
        "count": len(warnings),
        "covers": "England only",
    }, [Source("GOV.UK: check for flooding", link)]


async def tube_status(ctx: Context, args: dict[str, str]) -> Result:
    """How the London Underground, Overground, Elizabeth line and DLR are running now (TfL)."""
    found = await ctx.get_json(
        "https://api.tfl.gov.uk/Line/Mode/tube,overground,elizabeth-line,dlr/Status"
    )
    wanted = (args.get("line") or "").strip().lower()
    lines = []
    for line in found:
        if wanted and wanted not in line.get("name", "").lower():
            continue
        status = (line.get("lineStatuses") or [{}])[0]
        lines.append(
            {
                "line": line.get("name"),
                "status": status.get("statusSeverityDescription"),
                "reason": (status.get("reason") or "")[:240] or None,
            }
        )
    if wanted and not lines:
        raise Refused(f"TfL has no line called {wanted!r}")
    return {"lines": lines}, [
        Source("TfL status updates", "https://tfl.gov.uk/tube-dlr-overground/status/")
    ]


POSTCODE = Tool(
    "postcode_info",
    "Where a UK postcode is: its council, ward, constituency, region and NHS area.",
    {"postcode": text("a UK postcode, e.g. OX1 3DA")},
    ("postcode",),
    postcode_info,
    lambda a: f"Looked up the postcode {a.get('postcode', '').upper()}",
    "postcodes.io",
)
MY_MP = Tool(
    "my_mp",
    "Who the person's Member of Parliament is (from their postcode), and how to contact them.",
    {"postcode": text("their UK postcode")},
    ("postcode",),
    my_mp,
    lambda a: "Found the MP for that postcode",
    "uk parliament",
)
BANK_HOLIDAYS = Tool(
    "bank_holidays",
    "The next UK bank holidays.",
    {"nation": text("England, Wales, Scotland or Northern Ireland (default England)")},
    (),
    bank_holidays,
    lambda a: "Checked the bank holidays on GOV.UK",
    "gov.uk",
)
FLOODS = Tool(
    "flood_warnings",
    "Flood warnings in force near a place in England.",
    {"place": text("the town or area")},
    ("place",),
    flood_warnings,
    lambda a: f"Checked flood warnings near {a.get('place', '')}",
    "environment agency",
)
TUBE = Tool(
    "tube_status",
    "How the London Tube, Overground, Elizabeth line and DLR are running right now.",
    {"line": text("one line's name, or leave empty for all")},
    (),
    tube_status,
    lambda a: "Checked the London lines with TfL",
    "tfl",
)
