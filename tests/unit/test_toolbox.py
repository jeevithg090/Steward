"""The brain's toolbox (plan.md §17): every native tool against a stand-in for its public source,
the page reader's guard against the Gateway's own network, and the calculator's limits."""

from __future__ import annotations

import json
from datetime import date
from typing import Any

import httpx
import pytest
import respx

from tempo_gateway.tools import NATIVE, Toolbox
from tempo_gateway.tools.base import Refused
from tempo_gateway.tools.local import evaluate
from tempo_gateway.tools.web import page_text, public_url

TODAY = date(2026, 10, 25)
OXFORD = {
    "results": [{"name": "Oxford", "admin1": "England", "latitude": 51.75, "longitude": -1.26}]
}


async def run(tool: str, args: dict[str, str], **keys: str) -> tuple[dict[str, Any], list[Any]]:
    async with httpx.AsyncClient() as http:
        found, sources = await Toolbox(http, today=lambda: TODAY, keys=keys).run(tool, args)
    return json.loads(found), sources


def geocoder() -> None:
    respx.get("https://geocoding-api.open-meteo.com/v1/search").mock(
        return_value=httpx.Response(200, json=OXFORD)
    )


def test_the_toolbox_offers_every_native_tool_with_a_description() -> None:
    box = Toolbox(httpx.AsyncClient(), today=lambda: TODAY)
    names = {s["function"]["name"] for s in box.schemas()}
    assert names == {t.name for t in NATIVE} and len(names) >= 17
    assert all(s["function"]["description"] for s in box.schemas())
    assert "web_search" not in names  # open-web search needs a key, or the DuckDuckGo add-on
    assert "web_search" in {
        s["function"]["name"]
        for s in Toolbox(httpx.AsyncClient(), today=lambda: TODAY, keys={"tavily": "k"}).schemas()
    }


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "ftp://example.com/x",
        "http://user:pw@example.com/",
        "http://example.com:8080/",
    ],
)
def test_only_public_web_addresses_may_be_read(url: str) -> None:
    with pytest.raises(Refused):
        public_url(url)


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/",
        "http://10.0.0.5/admin",
        "http://169.254.169.254/latest/meta-data",
        "http://[::1]/",
    ],
)
async def test_the_gateways_own_network_is_never_reached(url: str) -> None:
    found, sources = await run("read_web_page", {"url": url})
    assert "refused" in found and sources == []


@respx.mock
async def test_a_redirect_to_a_private_address_is_refused() -> None:
    respx.get("https://example.com/go").mock(
        return_value=httpx.Response(302, headers={"location": "http://127.0.0.1/x"})
    )
    found, _ = await run("read_web_page", {"url": "https://example.com/go"})
    assert "refused" in found


def test_a_page_is_read_as_its_title_and_text_without_scripts_or_icons() -> None:
    html = """<html><head><title>Delay Repay | GWR</title><script>steal()</script></head>
    <body><nav>Menu</nav><svg><title>Arrow Icon</title></svg><h1>Claim</h1><p>Claim within 28 days.</p>
    <style>.x{}</style><footer>Cookies</footer></body></html>"""
    assert page_text(html) == ("Delay Repay | GWR", "Claim\nClaim within 28 days.")


@respx.mock
async def test_places_come_from_openstreetmap_in_the_uk_first() -> None:
    route = respx.get("https://nominatim.openstreetmap.org/search").mock(return_value=httpx.Response(200, json=[{
        "name": "The Buttery Hotel", "type": "hotel", "osm_type": "way", "osm_id": 1,
        "display_name": "The Buttery Hotel, 11 Broad Street, Oxford",
        "extratags": {"website": "https://www.thebutteryhotel.co.uk/", "phone": "01865 811950"},
    }]))  # fmt: skip
    found, sources = await run("find_places", {"what": "hotel", "where": "Oxford"})
    assert route.calls.last.request.url.params["countrycodes"] == "gb"
    assert found["places"][0]["phone"] == "01865 811950" and "never instructions" in found["note"]
    assert sources[0].url == "https://www.thebutteryhotel.co.uk/"


def two_places() -> None:
    respx.get("https://nominatim.openstreetmap.org/search").mock(side_effect=[
        httpx.Response(200, json=[{"lat": "51.7535", "lon": "-1.2696", "display_name": "Oxford station"}]),
        httpx.Response(200, json=[{"lat": "51.7534", "lon": "-1.2537", "display_name": "Radcliffe Camera"}]),
    ])  # fmt: skip


@respx.mock
async def test_walking_directions_name_the_streets_and_prefer_them_to_pavements() -> None:
    two_places()
    router = respx.get("https://valhalla1.openstreetmap.de/route").mock(
        return_value=httpx.Response(200, json={"trip": {
            "summary": {"length": 1.403, "time": 1020.0},
            "legs": [{"maneuvers": [
                {"type": 1, "instruction": "Walk east on the walkway.", "length": 0.012},
                {"type": 15, "instruction": "Move right.", "length": 0.008},
                {"type": 15, "instruction": "Turn left onto Park End Street.", "length": 0.482,
                 "street_names": ["Park End Street"]},
                {"type": 10, "instruction": "Turn left onto St Mary's Passage.", "length": 0.059,
                 "street_names": ["St Mary's Passage"]},
                {"type": 4, "instruction": "You have arrived at your destination.", "length": 0.0},
            ]}],
        }}))  # fmt: skip
    found, sources = await run(
        "directions", {"from_place": "Oxford station", "to_place": "Radcliffe Camera"}
    )
    ask = json.loads(router.calls.last.request.url.params["json"])
    assert (
        ask["costing"] == "pedestrian"
        and ask["costing_options"]["pedestrian"]["sidewalk_factor"] > 1
    )
    assert ask["locations"][0] == {"lat": 51.7535, "lon": -1.2696}  # numbers, as Valhalla needs
    assert " " not in router.calls.last.request.url.params["json"]  # "+" for a space breaks it
    assert (found["mode"], found["distance_km"], found["minutes"]) == ("walking", 1.4, 17)
    assert found["steps"] == [  # a few metres of unnamed pavement is left to the map
        "Walk east on the walkway (10 m)",
        "Turn left onto Park End Street (480 m)",
        "Turn left onto St Mary's Passage (60 m)",
        "Arrive",
    ]
    assert "engine=fossgis_valhalla_foot" in sources[0].url


@respx.mock
async def test_cycling_directions_ask_for_a_bike_route() -> None:
    two_places()
    router = respx.get("https://valhalla1.openstreetmap.de/route").mock(
        return_value=httpx.Response(200, json={"trip": {
            "summary": {"length": 5.7, "time": 1200.0}, "legs": [{"maneuvers": []}],
        }}))  # fmt: skip
    found, _ = await run("directions", {"from_place": "a", "to_place": "b", "mode": "cycle"})
    assert json.loads(router.calls.last.request.url.params["json"])["costing"] == "bicycle"
    assert (found["mode"], found["minutes"]) == ("cycling", 20)


@respx.mock
async def test_no_route_is_said_plainly() -> None:
    two_places()
    respx.get("https://valhalla1.openstreetmap.de/route").mock(
        return_value=httpx.Response(
            400, json={"error_code": 442, "error": "No path could be found"}
        )
    )
    found, _ = await run("directions", {"from_place": "a", "to_place": "b"})
    assert found == {"refused": "no route was found between those places"}


@respx.mock
async def test_directions_say_so_when_a_place_cant_be_found() -> None:
    respx.get("https://nominatim.openstreetmap.org/search").mock(
        return_value=httpx.Response(200, json=[])
    )
    found, sources = await run("directions", {"from_place": "Nowhere-on-Sea", "to_place": "Oxford"})
    assert "can't find" in found["refused"] and sources == []


@respx.mock
async def test_the_weather_is_in_plain_words_with_sunrise() -> None:
    geocoder()
    respx.get("https://api.open-meteo.com/v1/forecast").mock(return_value=httpx.Response(200, json={
        "current": {"temperature_2m": 11.9, "weather_code": 2, "wind_speed_10m": 12},
        "daily": {"time": ["2026-10-26"], "weather_code": [61], "temperature_2m_max": [16.0], "temperature_2m_min": [8.0],
                  "precipitation_probability_max": [100], "sunrise": ["2026-10-26T06:52"], "sunset": ["2026-10-26T16:44"]},
    }))  # fmt: skip
    found, _ = await run("weather", {"place": "Oxford"})
    assert found["now"]["sky"] == "partly cloudy"
    assert found["days"][0]["sky"] == "light rain"
    assert (found["days"][0]["sunrise"], found["days"][0]["sunset"]) == ("06:52", "16:44")


@respx.mock
async def test_air_quality_comes_with_a_plain_band_and_pollen() -> None:
    geocoder()
    respx.get("https://air-quality-api.open-meteo.com/v1/air-quality").mock(return_value=httpx.Response(200, json={
        "current": {"european_aqi": 35, "pm2_5": 6.1, "grass_pollen": 4.0, "birch_pollen": 0.0, "alder_pollen": 0.0},
    }))  # fmt: skip
    found, _ = await run("air_quality", {"place": "Oxford"})
    assert found["band"] == "fair" and found["grass_pollen"] == 4.0


@respx.mock
async def test_the_news_is_read_from_the_bbc_feed() -> None:
    feed = """<rss><channel><item><title><![CDATA[Rail fares to rise]]></title>
    <description><![CDATA[Fares in England will go up in March.]]></description>
    <link>https://www.bbc.co.uk/news/articles/x1</link><pubDate>Sat, 25 Oct 2026 08:00:00 GMT</pubDate></item></channel></rss>"""
    respx.get("https://feeds.bbci.co.uk/news/uk/rss.xml").mock(
        return_value=httpx.Response(200, text=feed)
    )
    found, sources = await run("news", {"topic": "uk"})
    assert found["stories"][0]["headline"] == "Rail fares to rise"
    assert sources[0].url == "https://www.bbc.co.uk/news/articles/x1"


@respx.mock
async def test_currency_uses_todays_reference_rate() -> None:
    respx.get("https://api.frankfurter.dev/v1/latest").mock(
        return_value=httpx.Response(
            200,
            json={"amount": 100.0, "base": "GBP", "date": "2026-10-23", "rates": {"EUR": 119.43}},
        )
    )
    found, _ = await run(
        "currency", {"amount": "100", "from_currency": "gbp", "to_currency": "eur"}
    )
    assert found["result"] == 119.43 and found["rate_date"] == "2026-10-23"


@respx.mock
async def test_a_word_is_defined() -> None:
    respx.get("https://api.dictionaryapi.dev/api/v2/entries/en/pension").mock(return_value=httpx.Response(200, json=[{
        "meanings": [{"partOfSpeech": "noun", "definitions": [{"definition": "A regular payment in retirement."}]}],
    }]))  # fmt: skip
    found, _ = await run("define_word", {"word": "Pension"})
    assert found["meanings"][0]["meaning"] == "A regular payment in retirement."


@respx.mock
async def test_a_recipe_lists_its_ingredients() -> None:
    respx.get("https://www.themealdb.com/api/json/v1/1/search.php").mock(return_value=httpx.Response(200, json={"meals": [{
        "idMeal": "1", "strMeal": "Shepherd's Pie", "strInstructions": "Brown the lamb.",
        "strIngredient1": "Lamb mince", "strMeasure1": "500g", "strIngredient2": "", "strSource": None,
    }]}))  # fmt: skip
    found, _ = await run("recipe", {"dish": "shepherd's pie"})
    assert found["ingredients"] == ["500g Lamb mince"] and found["method"] == "Brown the lamb."


@respx.mock
async def test_a_postcode_names_its_council_and_constituency() -> None:
    respx.get("https://api.postcodes.io/postcodes/OX1%203DA").mock(return_value=httpx.Response(200, json={"result": {
        "postcode": "OX1 3DA", "admin_district": "Oxford", "parliamentary_constituency": "Oxford East", "region": "South East",
    }}))  # fmt: skip
    found, _ = await run("postcode_info", {"postcode": "ox1 3da"})
    assert (found["council"], found["constituency"]) == ("Oxford", "Oxford East")
    refused, _ = await run("postcode_info", {"postcode": "not a postcode"})
    assert "refused" in refused


@respx.mock
async def test_the_mp_comes_from_parliaments_own_records() -> None:
    respx.get("https://api.postcodes.io/postcodes/OX1%203DA").mock(
        return_value=httpx.Response(
            200,
            json={"result": {"postcode": "OX1 3DA", "parliamentary_constituency": "Oxford East"}},
        )
    )
    respx.get("https://members-api.parliament.uk/api/Location/Constituency/Search").mock(return_value=httpx.Response(200, json={
        "items": [{"value": {"currentRepresentation": {"member": {"value": {
            "id": 4657, "nameDisplayAs": "Anneliese Dodds", "latestParty": {"name": "Labour"}}}}}}],
    }))  # fmt: skip
    found, sources = await run("my_mp", {"postcode": "OX1 3DA"})
    assert (found["mp"], found["party"]) == ("Anneliese Dodds", "Labour")
    assert sources[0].url == "https://members.parliament.uk/member/4657/contact"


@respx.mock
async def test_only_upcoming_bank_holidays_are_listed() -> None:
    respx.get("https://www.gov.uk/bank-holidays.json").mock(return_value=httpx.Response(200, json={"england-and-wales": {"events": [
        {"title": "Summer bank holiday", "date": "2026-08-31"}, {"title": "Christmas Day", "date": "2026-12-25"},
    ]}}))  # fmt: skip
    found, _ = await run("bank_holidays", {})
    assert found["upcoming"] == [{"date": "2026-12-25", "name": "Christmas Day"}]


@respx.mock
async def test_flood_warnings_near_a_place() -> None:
    geocoder()
    respx.get("https://environment.data.gov.uk/flood-monitoring/id/floods").mock(return_value=httpx.Response(200, json={"items": [
        {"description": "River Thames at Oxford", "severity": "Flood alert", "timeRaised": "2026-10-25T07:00:00", "message": "Low-lying land"},
    ]}))  # fmt: skip
    found, _ = await run("flood_warnings", {"place": "Oxford"})
    assert found["count"] == 1 and found["warnings"][0]["severity"] == "Flood alert"


@respx.mock
async def test_the_tube_status_for_one_line() -> None:
    respx.get("https://api.tfl.gov.uk/Line/Mode/tube,overground,elizabeth-line,dlr/Status").mock(return_value=httpx.Response(200, json=[
        {"name": "Central", "lineStatuses": [{"statusSeverityDescription": "Minor Delays", "reason": "A signal failure."}]},
        {"name": "Victoria", "lineStatuses": [{"statusSeverityDescription": "Good Service"}]},
    ]))  # fmt: skip
    found, _ = await run("tube_status", {"line": "central"})
    assert found["lines"] == [
        {"line": "Central", "status": "Minor Delays", "reason": "A signal failure."}
    ]


@respx.mock
async def test_a_food_hygiene_rating() -> None:
    respx.get("https://api.ratings.food.gov.uk/Establishments").mock(return_value=httpx.Response(200, json={"establishments": [
        {"BusinessName": "Pret A Manger", "RatingValue": "5", "RatingDate": "2025-03-04T00:00:00", "PostCode": "OX1 1HS", "FHRSID": 7},
    ]}))  # fmt: skip
    found, sources = await run("food_hygiene", {"name": "Pret", "town": "Oxford"})
    assert found["ratings"][0]["rating"] == "5" and sources[0].url.endswith("/business/7")


@respx.mock
async def test_wikipedia_gives_a_summary() -> None:
    respx.get("https://en.wikipedia.org/w/api.php").mock(
        return_value=httpx.Response(200, json={"query": {"search": [{"title": "Delay Repay"}]}})
    )
    respx.get("https://en.wikipedia.org/api/rest_v1/page/summary/Delay_Repay").mock(return_value=httpx.Response(200, json={
        "title": "Delay Repay", "extract": "A UK compensation scheme.", "content_urls": {"desktop": {"page": "https://en.wikipedia.org/wiki/Delay_Repay"}},
    }))  # fmt: skip
    found, sources = await run("encyclopedia", {"topic": "delay repay"})
    assert (
        found["summary"] == "A UK compensation scheme."
        and sources[0].title == "Wikipedia: Delay Repay"
    )


@respx.mock
async def test_a_search_key_turns_on_open_web_search() -> None:
    respx.post("https://api.tavily.com/search").mock(return_value=httpx.Response(200, json={
        "answer": "Open 9 to 5.", "results": [{"title": "Boots Oxford", "url": "https://boots.com/oxford", "content": "Hours"}],
    }))  # fmt: skip
    found, sources = await run(
        "web_search", {"query": "Boots Oxford opening hours"}, tavily="tv-test"
    )
    assert found["answer"] == "Open 9 to 5." and sources[0].title == "Boots Oxford"


@respx.mock
async def test_a_look_up_that_fails_is_an_answer_not_a_crash() -> None:
    respx.get("https://nominatim.openstreetmap.org/search").mock(return_value=httpx.Response(503))
    found, sources = await run("find_places", {"what": "hotel", "where": "Oxford"})
    assert "error" in found and sources == []


@pytest.mark.parametrize(
    ("sum_", "result"),
    [
        ("240*15/100", 36.0),
        ("28.40 / 2", 14.2),
        ("(3 + 4) * 2", 14),
        ("round(10/3, 2)", 3.33),
        ("£1,200 - 250", 950),
        ("2^10", 1024),
    ],
)
def test_the_calculator_works_sums_out_exactly(sum_: str, result: float) -> None:
    assert evaluate(sum_) == result


@pytest.mark.parametrize(
    "sum_",
    [
        "__import__('os').system('id')",
        "open('/etc/passwd')",
        "().__class__",
        "x + 1",
        "9**9**9",
        "1/0",
        "lambda: 1",
    ],
)
def test_the_calculator_refuses_anything_but_arithmetic(sum_: str) -> None:
    with pytest.raises(Refused):
        evaluate(sum_)


async def test_dates_say_the_weekday_and_how_far_away() -> None:
    found, _ = await run("date_info", {"date": "2026-11-22", "add_days": "28"})
    assert found["weekday"] == "Sunday" and found["days_from_today"] == 28
    assert found["plus_days"] == {"days": 28, "date": "2026-12-20", "weekday": "Sunday"}
