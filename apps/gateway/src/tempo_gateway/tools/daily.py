"""Everyday look-ups: the weather and sunrise, air quality and pollen, the news, exchange rates,
what a word means, and a recipe. Open public sources, no keys."""

from __future__ import annotations

import html
import re
from urllib.parse import quote

from .base import Context, Refused, Result, Source, Tool, geocode, need, text, where

# Open-Meteo's weather codes, in plain words (WMO 4677, as Open-Meteo documents them).
SKY = {
    0: "clear sky",
    1: "mainly clear",
    2: "partly cloudy",
    3: "overcast",
    45: "fog",
    48: "freezing fog",
    51: "light drizzle",
    53: "drizzle",
    55: "heavy drizzle",
    61: "light rain",
    63: "rain",
    65: "heavy rain",
    71: "light snow",
    73: "snow",
    75: "heavy snow",
    80: "light showers",
    81: "showers",
    82: "heavy showers",
    95: "thunderstorm",
    96: "thunderstorm with hail",
}
NEWS = {
    "top": "news",
    "uk": "news/uk",
    "world": "news/world",
    "business": "news/business",
    "politics": "news/politics",
    "health": "news/health",
    "technology": "news/technology",
    "science": "news/science_and_environment",
    "entertainment": "news/entertainment_and_arts",
    "sport": "sport",
}
_ITEM = re.compile(r"<item>(.*?)</item>", re.DOTALL)
_TAG = {
    tag: re.compile(rf"<{tag}>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</{tag}>", re.DOTALL)
    for tag in ("title", "link", "description", "pubDate")
}
MAX_FEED = 400_000


async def weather(ctx: Context, args: dict[str, str]) -> Result:
    """Now and the next three days, with sunrise and sunset, for a place by name (UK first)."""
    spot = await geocode(ctx, need(args, "place", "which place"))
    forecast = await ctx.get_json(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": spot["latitude"],
            "longitude": spot["longitude"],
            "timezone": "auto",
            "current": "temperature_2m,weather_code,wind_speed_10m",
            "forecast_days": 4,
            "daily": (
                "weather_code,temperature_2m_max,temperature_2m_min,"
                "precipitation_probability_max,sunrise,sunset"
            ),
        },
    )
    now, daily = forecast["current"], forecast["daily"]
    days = [
        {
            "date": d,
            "sky": SKY.get(code, "mixed"),
            "high_c": hi,
            "low_c": lo,
            "rain_chance_pct": rain,
            "sunrise": rise[-5:],
            "sunset": fall[-5:],
        }
        for d, code, hi, lo, rain, rise, fall in zip(
            daily["time"],
            daily["weather_code"],
            daily["temperature_2m_max"],
            daily["temperature_2m_min"],
            daily["precipitation_probability_max"],
            daily["sunrise"],
            daily["sunset"],
            strict=False,
        )
    ]
    result = {
        "provider": "open-meteo",
        "place": where(spot),
        "days": days,
        "now": {
            "temp_c": now["temperature_2m"],
            "sky": SKY.get(now["weather_code"], "mixed"),
            "wind_kmh": now.get("wind_speed_10m"),
        },
    }
    return result, [Source(f"Open-Meteo forecast for {spot['name']}", "https://open-meteo.com/")]


async def air_quality(ctx: Context, args: dict[str, str]) -> Result:
    """Air quality and pollen today for a place (Open-Meteo, European scale)."""
    spot = await geocode(ctx, need(args, "place", "which place"))
    found = await ctx.get_json(
        "https://air-quality-api.open-meteo.com/v1/air-quality",
        params={
            "latitude": spot["latitude"],
            "longitude": spot["longitude"],
            "timezone": "auto",
            "current": (
                "european_aqi,pm2_5,nitrogen_dioxide,ozone,grass_pollen,birch_pollen,alder_pollen"
            ),
        },
    )
    now = found["current"]
    aqi = now.get("european_aqi")
    band = (
        None
        if aqi is None
        else next(
            b
            for limit, b in (
                (20, "good"),
                (40, "fair"),
                (60, "moderate"),
                (80, "poor"),
                (100, "very poor"),
                (10**6, "extremely poor"),
            )
            if aqi <= limit
        )
    )
    return {
        "provider": "open-meteo",
        "place": where(spot),
        "european_aqi": aqi,
        "band": band,
        "pm2_5": now.get("pm2_5"),
        "grass_pollen": now.get("grass_pollen"),
        "birch_pollen": now.get("birch_pollen"),
        "alder_pollen": now.get("alder_pollen"),
        "pollen_units": "grains per cubic metre",
    }, [
        Source(
            f"Open-Meteo air quality for {spot['name']}",
            "https://open-meteo.com/en/docs/air-quality-api",
        )
    ]


async def news(ctx: Context, args: dict[str, str]) -> Result:
    """The latest BBC News headlines for a topic."""
    topic = (args.get("topic") or "top").strip().lower()
    path = NEWS.get(topic, "news")
    feed = (await ctx.get_text(f"https://feeds.bbci.co.uk/{path}/rss.xml"))[:MAX_FEED]
    items = []
    for raw in _ITEM.findall(feed)[:8]:
        part = {
            tag: html.unescape(m.group(1).strip()) if (m := rx.search(raw)) else ""
            for tag, rx in _TAG.items()
        }
        items.append(
            {
                "headline": part["title"],
                "summary": part["description"][:220],
                "link": part["link"],
                "published": part["pubDate"][:22],
            }
        )
    if not items:
        raise Refused("the BBC feed had no stories just now")
    return {"provider": "bbc news", "topic": topic if topic in NEWS else "top", "stories": items}, [
        Source(s["headline"], s["link"]) for s in items[:3] if s["link"]
    ]


async def currency(ctx: Context, args: dict[str, str]) -> Result:
    """An amount in another currency at today's European Central Bank rate."""
    base = need(args, "from_currency", "which currency", 3).upper()
    target = need(args, "to_currency", "which currency to change into", 3).upper()
    try:
        amount = float(args.get("amount") or 1)
    except ValueError:
        raise Refused("the amount must be a number") from None
    found = await ctx.get_json(
        "https://api.frankfurter.dev/v1/latest",
        params={"amount": amount, "base": base, "symbols": target},
    )
    if target not in found.get("rates", {}):
        raise Refused(f"no rate for {base} to {target}")
    return {
        "provider": "european central bank (frankfurter)",
        "amount": amount,
        "from": base,
        "to": target,
        "result": found["rates"][target],
        "rate_date": found.get("date"),
    }, [Source("ECB reference rates (Frankfurter)", "https://frankfurter.dev/")]


async def define_word(ctx: Context, args: dict[str, str]) -> Result:
    """What an English word means, with an example."""
    word = need(args, "word", "which word", 40).lower()
    found = await ctx.get_json(f"https://api.dictionaryapi.dev/api/v2/entries/en/{quote(word)}")
    if not isinstance(found, list) or not found:
        raise Refused(f"no definition found for {word!r}")
    meanings = [
        {
            "part_of_speech": m.get("partOfSpeech"),
            "meaning": (m.get("definitions") or [{}])[0].get("definition"),
            "example": (m.get("definitions") or [{}])[0].get("example"),
        }
        for m in found[0].get("meanings", [])[:3]
    ]
    link = f"https://en.wiktionary.org/wiki/{quote(word)}"
    return {"word": word, "meanings": meanings}, [Source(f"Definition of “{word}”", link)]


async def recipe(ctx: Context, args: dict[str, str]) -> Result:
    """A recipe for a dish: ingredients and method (TheMealDB)."""
    dish = need(args, "dish", "which dish", 60)
    found = await ctx.get_json(
        "https://www.themealdb.com/api/json/v1/1/search.php", params={"s": dish}
    )
    meals = found.get("meals") or []
    if not meals:
        raise Refused(f"no recipe found for {dish!r}")
    m = meals[0]
    ingredients = [
        f"{(m.get(f'strMeasure{i}') or '').strip()} {m[f'strIngredient{i}'].strip()}".strip()
        for i in range(1, 21)
        if (m.get(f"strIngredient{i}") or "").strip()
    ]
    link = m.get("strSource") or f"https://www.themealdb.com/meal/{m['idMeal']}"
    return {
        "dish": m.get("strMeal"),
        "ingredients": ingredients,
        "method": (m.get("strInstructions") or "")[:1800],
    }, [Source(m.get("strMeal") or dish, link)]


WEATHER = Tool(
    "weather",
    "The weather now and for the next three days in a place, with sunrise and sunset.",
    {"place": text("the town or area")},
    ("place",),
    weather,
    lambda a: f"Checked the weather for {a.get('place', '')}",
    "open-meteo",
)
AIR = Tool(
    "air_quality",
    "Air quality and pollen levels today in a place (for asthma or hay fever).",
    {"place": text("the town or area")},
    ("place",),
    air_quality,
    lambda a: f"Checked air quality and pollen in {a.get('place', '')}",
    "open-meteo",
)
NEWS_TOOL = Tool(
    "news",
    "The latest BBC News headlines.",
    {"topic": text("one of: " + ", ".join(NEWS))},
    (),
    news,
    lambda a: f"Read the BBC's {a.get('topic') or 'top'} headlines",
    "bbc news",
)
CURRENCY = Tool(
    "currency",
    "Change an amount from one currency into another at today's rate.",
    {
        "amount": text("the amount, e.g. 100"),
        "from_currency": text("3-letter code, e.g. GBP"),
        "to_currency": text("3-letter code, e.g. EUR"),
    },
    ("from_currency", "to_currency"),
    currency,
    lambda a: (
        f"Checked the {a.get('from_currency', '').upper()} to "
        f"{a.get('to_currency', '').upper()} rate"
    ),
    "frankfurter",
)
DEFINE = Tool(
    "define_word",
    "What an English word means.",
    {"word": text("the word")},
    ("word",),
    define_word,
    lambda a: f"Looked up the word “{a.get('word', '')}”",
    "dictionaryapi.dev",
)
RECIPE = Tool(
    "recipe",
    "A recipe for a dish, with ingredients and method.",
    {"dish": text("the dish")},
    ("dish",),
    recipe,
    lambda a: f"Found a recipe for {a.get('dish', '')}",
    "themealdb",
)
