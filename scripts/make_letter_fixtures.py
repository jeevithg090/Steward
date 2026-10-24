"""Write the Read It To Me fixtures (SHIPPING §4.8, track 1b): two synthetic letters as PNGs,
the reading ReplayVision returns for each (fixtures/vision/<sha256>.json) and the LetterReading
each should produce (fixtures/letters/*.reading.json), which the web showcase copies.

    uv run python scripts/make_letter_fixtures.py

Everything here is made up: no real person, account or reference. The council-tax due date is
recorded at 0.7 confidence on purpose, so the demo reads it back once before trusting it.
"""

from __future__ import annotations

import hashlib
import io
import json
from datetime import date
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

from tempo_adapters.bank_holidays import from_file
from tempo_adapters.vision import to_facts
from tempo_core.letters import read_letter
from tempo_core.rules import RulePackRegistry
from tempo_ports.vision import DocumentKind

REPO = Path(__file__).resolve().parents[1]
VISION, LETTERS = REPO / "fixtures" / "vision", REPO / "fixtures" / "letters"
TODAY = date(2026, 10, 25)  # the readings don't depend on it unless a due date has passed
SIZE = (1000, 1400)
MARGIN, TOP = 90, 100  # amounts are written "GBP 23.40": pillow's bundled font has no "£"

Line = tuple[str, int]  # text, font size

WATER: list[Line] = [
    ("Thames Water", 44), ("SYNTHETIC LETTER FOR A DEMO", 18), ("", 18),
    ("3 October 2026", 24), ("Account: TW-00482913", 24), ("", 24),
    ("Dear Customer,", 28), ("", 20),
    ("Your account is in credit", 34), ("", 20),
    ("We have checked your bills for this year. You paid too much.", 24),
    ("Your account is now GBP 23.40 in credit.", 24), ("", 20),
    ("We will take this off your next bill.", 24),
    ("You do not need to do anything.", 24), ("", 20),
    ("Yours sincerely,", 24), ("Customer Accounts, Thames Water", 24),
]  # fmt: skip
COUNCIL: list[Line] = [
    ("Oxford City Council", 44), ("SYNTHETIC LETTER FOR A DEMO", 18), ("", 18),
    ("20 October 2026", 24), ("Reference: CT-7731902", 24), ("", 24),
    ("Council Tax Reminder", 34), ("", 20),
    ("Dear Customer,", 28), ("", 20),
    ("Our records show that your October instalment has not been paid.", 24),
    ("Amount due now: GBP 112.00", 30), ("", 20),
    ("Please pay by 10 November 2026.", 28), ("", 20),
    ("If you cannot pay, contact us before this date so we can", 24),
    ("agree a way forward.", 24), ("", 20),
    ("Revenues Team, Oxford City Council", 24),
]  # fmt: skip

FIXTURES: dict[str, tuple[str, list[Line], list[dict[str, Any]]]] = {
    "water_overpayment": (
        "thames_water_overpayment.png",
        WATER,
        [
            {"key": "sender", "value": "Thames Water", "confidence": 0.97},
            {"key": "kind", "value": "water_bill", "confidence": 0.93},
            {"key": "letter_date", "value": "2026-10-03", "confidence": 0.92},
            {"key": "amount_gbp", "value": "23.40", "confidence": 0.95},
            {"key": "direction", "value": "owed_to_you", "confidence": 0.9},
            {"key": "reference", "value": "TW-00482913", "confidence": 0.88},
        ],
    ),
    "council_tax_reminder": (
        "council_tax_reminder.png",
        COUNCIL,
        [
            {"key": "sender", "value": "Oxford City Council", "confidence": 0.96},
            {"key": "kind", "value": "council_tax", "confidence": 0.94},
            {"key": "letter_date", "value": "2026-10-20", "confidence": 0.9},
            {"key": "amount_gbp", "value": "112.00", "confidence": 0.93},
            {"key": "direction", "value": "you_owe", "confidence": 0.91},
            {"key": "due_date", "value": "2026-11-10", "confidence": 0.7},
            {"key": "reference", "value": "CT-7731902", "confidence": 0.86},
        ],
    ),
}


def render(lines: list[Line]) -> bytes:
    image = Image.new("RGB", SIZE, "white")
    draw = ImageDraw.Draw(image)
    y = TOP
    for text, size in lines:
        if text:
            draw.text((MARGIN, y), text, fill="black", font=ImageFont.load_default(size=size))
        y += int(size * 1.5)
    out = io.BytesIO()
    image.save(out, format="PNG", optimize=True)
    return out.getvalue()


def main() -> None:
    clocks = RulePackRegistry.from_directory(REPO / "skills").clocks
    holidays = from_file(REPO / "fixtures" / "govuk" / "bank-holidays.json")
    LETTERS.mkdir(exist_ok=True)
    for name, (filename, lines, facts) in FIXTURES.items():
        png = render(lines)
        digest = hashlib.sha256(png).hexdigest()
        (VISION / filename).write_bytes(png)
        answer = {"facts": facts}
        (VISION / f"{digest}.json").write_text(json.dumps(answer, indent=2) + "\n")
        reading = read_letter(
            to_facts(answer, kind=DocumentKind.OFFICIAL_LETTER, source=f"{filename}#vision"),
            today=TODAY, clocks=clocks, holidays=holidays,
        )  # fmt: skip
        golden = LETTERS / f"{name}.reading.json"
        golden.write_text(json.dumps(reading.model_dump(mode="json"), indent=2) + "\n")
        print(f"{filename}  sha256={digest}  ({len(png)} bytes)\n  -> {golden.relative_to(REPO)}")


if __name__ == "__main__":
    main()
