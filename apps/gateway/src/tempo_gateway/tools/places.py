"""Places: what's in a town and how to get there (OpenStreetMap), and how clean a food business is
(the Food Standards Agency's hygiene ratings)."""

from __future__ import annotations

import json
from typing import Any

import httpx

from .base import Context, Refused, Result, Source, Tool, need, text


async def find_places(ctx: Context, args: dict[str, str]) -> Result:
    """Places such as hotels, pharmacies or cafés in a town, from OpenStreetMap (UK first)."""
    what, where = (
        need(args, "what", "what kind of place", 80),
        need(args, "where", "which town", 80),
    )
    found: list[dict[str, Any]] = []
    for countries in ("gb", None):  # the UK first; anywhere else only if the UK has none
        params: dict[str, Any] = {
            "q": f"{what} in {where}",
            "format": "jsonv2",
            "limit": 8,
            "extratags": 1,
            "addressdetails": 1,
        }
        if countries:
            params["countrycodes"] = countries
        found = await ctx.get_json("https://nominatim.openstreetmap.org/search", params=params)
        if found:
            break
    places = []
    for item in found[:8]:
        tags = item.get("extratags") or {}
        places.append(
            {
                "name": item.get("name") or item.get("display_name", "").split(",")[0],
                "kind": item.get("type"),
                "address": item.get("display_name", ""),
                "website": tags.get("website") or tags.get("contact:website"),
                "phone": tags.get("phone") or tags.get("contact:phone"),
                "stars": tags.get("stars"),
                "opening_hours": tags.get("opening_hours"),
                "wheelchair": tags.get("wheelchair"),
                "map": f"https://www.openstreetmap.org/{item.get('osm_type')}/{item.get('osm_id')}",
            }
        )
    sources = [Source(p["name"], p["website"] or p["map"]) for p in places[:4]]
    return {"provider": "openstreetmap", "places": places, "count": len(places)}, sources


async def food_hygiene(ctx: Context, args: dict[str, str]) -> Result:
    """A food business's hygiene rating (0 to 5) from the Food Standards Agency."""
    name, town = need(args, "name", "the business's name", 80), need(args, "town", "which town", 60)
    found = await ctx.get_json(
        "https://api.ratings.food.gov.uk/Establishments",
        params={"name": name, "address": town, "pageSize": 5},
        headers={"x-api-version": "2"},
    )
    rows = found.get("establishments", [])
    if not rows:
        raise Refused(f"no rating found for {name!r} in {town}")
    ratings = [
        {
            "name": r.get("BusinessName"),
            "rating": r.get("RatingValue"),
            "rated_on": (r.get("RatingDate") or "")[:10],
            "address": ", ".join(
                x for x in (r.get("AddressLine1"), r.get("AddressLine2"), r.get("PostCode")) if x
            ),
            "page": f"https://ratings.food.gov.uk/business/{r.get('FHRSID')}",
        }
        for r in rows
    ]
    return {
        "provider": "food standards agency",
        "ratings": ratings,
        "scale": "0 (urgent improvement) to 5 (very good)",
    }, [Source(f"Food hygiene rating: {ratings[0]['name']}", str(ratings[0]["page"]))]


FIND_PLACES = Tool(
    "find_places",
    "Find places such as hotels, pharmacies, cafés, GPs or banks in a town (OpenStreetMap).",
    {"what": text("the kind of place, e.g. hotel"), "where": text("the town or area, e.g. Oxford")},
    ("what", "where"),
    find_places,
    lambda a: f"Looked up {a.get('what', 'places')} in {a.get('where', '')} on OpenStreetMap",
    "openstreetmap",
)
FOOD_HYGIENE = Tool(
    "food_hygiene",
    "A restaurant, café or takeaway's food hygiene rating (0 to 5), UK only.",
    {"name": text("the business's name"), "town": text("the town")},
    ("name", "town"),
    food_hygiene,
    lambda a: f"Checked the food hygiene rating of {a.get('name', '')}",
    "food standards agency",
)


# Valhalla, the router openstreetmap.org itself offers (run by FOSSGIS): it names the streets, and
# walking prefers named streets to the separately mapped pavements, which have no names.
VALHALLA = "https://valhalla1.openstreetmap.de/route"
PROFILES = {
    "walk": "foot",
    "walking": "foot",
    "foot": "foot",
    "bike": "bicycle",
    "cycle": "bicycle",
    "cycling": "bicycle",
    "drive": "car",
    "driving": "car",
    "car": "car",
}
MODE = {"foot": "walking", "bicycle": "cycling", "car": "driving"}
COSTING = {
    "foot": {"costing": "pedestrian", "costing_options": {"pedestrian": {"sidewalk_factor": 2}}},
    "bicycle": {"costing": "bicycle"},
    "car": {"costing": "auto"},
}
MAX_STEPS = 16
NO_ROUTE = {170, 171, 442, 443}  # Valhalla: too far, no path, or a place it can't reach


def _code(response: httpx.Response) -> int | None:
    try:
        code = response.json().get("error_code")
    except ValueError:
        return None
    return code if isinstance(code, int) else None


async def _locate(ctx: Context, place: str) -> dict[str, Any]:
    for countries in ("gb", None):
        params: dict[str, Any] = {"q": place, "format": "jsonv2", "limit": 1}
        if countries:
            params["countrycodes"] = countries
        found = await ctx.get_json("https://nominatim.openstreetmap.org/search", params=params)
        if found:
            spot: dict[str, Any] = found[0]
            return spot
    raise Refused(f"OpenStreetMap can't find {place!r}")


def _far(km: float) -> str:
    return f"{km:.1f} km" if km >= 1 else f"{max(10, round(km * 1000, -1)):.0f} m"


def _steps(maneuvers: list[dict[str, Any]]) -> list[str]:
    """The router's own instructions with their distances. A few metres along an unnamed pavement
    or a crossing is left to the map, so the steps stay short."""
    steps = []
    for m in maneuvers:
        said = m.get("instruction", "").rstrip(".")
        if m.get("type") in (4, 5, 6):  # arrived
            steps.append("Arrive")
        elif m.get("street_names") or m.get("length", 0) >= 0.02 or not steps:
            steps.append(f"{said} ({_far(m.get('length', 0))})")
    return steps


async def directions(ctx: Context, args: dict[str, str]) -> Result:
    """Walking, cycling or driving directions between two places, on OpenStreetMap."""
    start, end = need(args, "from_place", "where from"), need(args, "to_place", "where to")
    profile = PROFILES.get((args.get("mode") or "walk").strip().lower(), "foot")
    a, b = await _locate(ctx, start), await _locate(ctx, end)
    ask = {
        "locations": [{"lat": float(p["lat"]), "lon": float(p["lon"])} for p in (a, b)],
        **COSTING[profile],
        "units": "kilometers",
        "language": "en-GB",
    }
    try:
        # Compact: Valhalla can't read a JSON query with its spaces sent as "+".
        found = await ctx.get_json(
            VALHALLA, params={"json": json.dumps(ask, separators=(",", ":"))}
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 400 and _code(exc.response) in NO_ROUTE:
            raise Refused("no route was found between those places") from None
        raise
    trip = found["trip"]
    steps = _steps([m for leg in trip["legs"] for m in leg["maneuvers"]])
    link = (
        f"https://www.openstreetmap.org/directions?engine=fossgis_valhalla_{profile}"
        f"&route={a['lat']},{a['lon']};{b['lat']},{b['lon']}"
    )
    km = trip["summary"]["length"]
    return {
        "provider": "openstreetmap (fossgis valhalla)",
        "mode": MODE[profile],
        "from": a.get("display_name", start),
        "to": b.get("display_name", end),
        "distance_km": round(km, 1),
        "distance_miles": round(km / 1.609, 1),
        "minutes": round(trip["summary"]["time"] / 60),
        "steps": steps[:MAX_STEPS],
        "more_steps_on_the_map": max(0, len(steps) - MAX_STEPS),
        "map": link,
    }, [Source(f"OpenStreetMap {MODE[profile]} directions", link)]


DIRECTIONS = Tool(
    "directions",
    "Walking, cycling or driving directions, distance and time between two places.",
    {
        "from_place": text("where from, e.g. Oxford railway station"),
        "to_place": text("where to"),
        "mode": text("walk, bike or drive (default walk)"),
    },
    ("from_place", "to_place"),
    directions,
    lambda a: (
        f"Worked out the {MODE[PROFILES.get((a.get('mode') or 'walk').lower(), 'foot')]} route "
        "on OpenStreetMap"
    ),
    "openstreetmap",
)
