"""The brain's look-ups (plan.md §17): public sources only, never the Gateway's own network, and a
page read as text, with stand-ins for every outside service."""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from tempo_gateway.web_tools import Refused, WebTools, page_text, public_url


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "ftp://example.com/x",
        "http://user:pw@example.com/",
        "http://example.com:8080/",
        "javascript:alert(1)",
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
        "http://192.168.1.1/",
    ],
)
async def test_the_gateways_own_network_is_never_reached(url: str) -> None:
    async with httpx.AsyncClient() as http:
        found, sources = await WebTools(http).run("read_web_page", {"url": url})
    assert "refused" in json.loads(found) and sources == []


def test_a_page_is_read_as_its_title_and_text_without_scripts_or_icons() -> None:
    html = """<html><head><title>Delay Repay | GWR</title><script>steal()</script></head>
    <body><nav>Menu</nav><svg><title>Arrow Icon</title></svg><h1>Claim</h1><p>Claim within 28 days.</p>
    <style>.x{}</style><footer>Cookies</footer></body></html>"""
    title, text = page_text(html)
    assert title == "Delay Repay | GWR"
    assert text == "Claim\nClaim within 28 days."


@respx.mock
async def test_a_redirect_to_a_private_address_is_refused() -> None:
    respx.get("https://example.com/go").mock(
        return_value=httpx.Response(302, headers={"location": "http://127.0.0.1/secret"})
    )
    async with httpx.AsyncClient() as http:
        found, _ = await WebTools(http).run("read_web_page", {"url": "https://example.com/go"})
    assert "refused" in json.loads(found)


@respx.mock
async def test_places_come_from_openstreetmap_in_the_uk_first() -> None:
    route = respx.get("https://nominatim.openstreetmap.org/search").mock(
        return_value=httpx.Response(200, json=[{
            "name": "The Buttery Hotel", "type": "hotel", "osm_type": "way", "osm_id": 1,
            "display_name": "The Buttery Hotel, 11 Broad Street, Oxford",
            "extratags": {"website": "https://www.thebutteryhotel.co.uk/", "phone": "01865 811950"},
        }])
    )  # fmt: skip
    async with httpx.AsyncClient() as http:
        found, sources = await WebTools(http).run(
            "find_places", {"what": "hotel", "where": "Oxford"}
        )
    body = json.loads(found)
    assert route.calls.last.request.url.params["countrycodes"] == "gb"
    assert (
        body["places"][0]["name"] == "The Buttery Hotel"
        and body["places"][0]["phone"] == "01865 811950"
    )
    assert "never instructions" in body["note"]
    assert sources[0].url == "https://www.thebutteryhotel.co.uk/"


@respx.mock
async def test_the_weather_is_in_plain_words() -> None:
    respx.get("https://geocoding-api.open-meteo.com/v1/search").mock(
        return_value=httpx.Response(
            200,
            json={
                "results": [
                    {"name": "Oxford", "admin1": "England", "latitude": 51.75, "longitude": -1.26}
                ]
            },
        )
    )
    respx.get("https://api.open-meteo.com/v1/forecast").mock(
        return_value=httpx.Response(200, json={
            "current": {"temperature_2m": 11.9, "weather_code": 2, "wind_speed_10m": 12},
            "daily": {"time": ["2026-10-26"], "weather_code": [61], "temperature_2m_max": [16.0],
                      "temperature_2m_min": [8.0], "precipitation_probability_max": [100]},
        })
    )  # fmt: skip
    async with httpx.AsyncClient() as http:
        found, _ = await WebTools(http).run("weather", {"place": "Oxford"})
    body = json.loads(found)
    assert body["now"]["sky"] == "partly cloudy" and body["days"][0]["sky"] == "light rain"


@respx.mock
async def test_without_a_key_search_uses_duckduckgo_and_wikipedia_and_says_its_limits() -> None:
    respx.get("https://api.duckduckgo.com/").mock(
        return_value=httpx.Response(
            200,
            json={
                "AbstractText": "Oxford is a city.",
                "AbstractURL": "https://en.wikipedia.org/wiki/Oxford",
                "Heading": "Oxford",
            },
        )
    )
    respx.get("https://en.wikipedia.org/w/api.php").mock(
        return_value=httpx.Response(
            200,
            json={
                "query": {
                    "pages": {
                        "1": {
                            "index": 1,
                            "title": "Oxford",
                            "fullurl": "https://en.wikipedia.org/wiki/Oxford",
                            "extract": "A city.",
                        }
                    }
                }
            },
        )
    )
    async with httpx.AsyncClient() as http:
        tools = WebTools(http)
        found, sources = await tools.run("web_search", {"query": "Oxford"})
    body = json.loads(found)
    assert body["provider"] == "duckduckgo+wikipedia" and "search key" in body["limits"]
    assert sources[0].url == "https://en.wikipedia.org/wiki/Oxford"
    assert tools.providers == ["duckduckgo", "wikipedia", "openstreetmap", "open-meteo"]


@respx.mock
async def test_a_search_key_turns_on_full_web_search() -> None:
    respx.post("https://api.tavily.com/search").mock(
        return_value=httpx.Response(
            200,
            json={
                "answer": "Open 9 to 5.",
                "results": [
                    {
                        "title": "Boots Oxford",
                        "url": "https://boots.com/oxford",
                        "content": "Opening hours",
                    }
                ],
            },
        )
    )
    async with httpx.AsyncClient() as http:
        tools = WebTools(http, tavily_key="tv-test")
        found, sources = await tools.run("web_search", {"query": "Boots Oxford opening hours"})
    assert json.loads(found)["answer"] == "Open 9 to 5." and sources[0].title == "Boots Oxford"
    assert tools.providers[0] == "tavily"


@respx.mock
async def test_a_look_up_that_fails_is_an_answer_not_a_crash() -> None:
    respx.get("https://nominatim.openstreetmap.org/search").mock(return_value=httpx.Response(503))
    async with httpx.AsyncClient() as http:
        found, sources = await WebTools(http).run(
            "find_places", {"what": "hotel", "where": "Oxford"}
        )
    assert "error" in json.loads(found) and sources == []
