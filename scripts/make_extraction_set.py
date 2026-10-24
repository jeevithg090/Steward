"""Build the synthetic extraction eval set (S6.1): 12 ticket images and 8 letters, with answers.

Deterministic, so re-running produces the same files. Writes evals/extraction/images/*.png and
evals/extraction/expected.yaml. Everything here is invented; no real tickets or letters.
"""

from __future__ import annotations

from pathlib import Path

import yaml
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[1] / "evals" / "extraction"

TICKETS = [
    ("Oxford", "London Paddington", "2026-10-23", "08:12", "28.40", "Off-Peak Day Single"),
    ("Reading", "Oxford", "2026-10-21", "17:42", "14.10", "Anytime Day Single"),
    ("London Marylebone", "Oxford", "2026-10-19", "19:05", "32.00", "Off-Peak Return"),
    ("Bristol Temple Meads", "London Paddington", "2026-10-18", "07:30", "68.90", "Anytime Single"),
    ("Didcot Parkway", "Swindon", "2026-10-17", "12:16", "9.80", "Off-Peak Day Return"),
    ("Banbury", "Birmingham Moor Street", "2026-10-16", "09:48", "12.60", "Super Off-Peak Single"),
    ("Oxford", "Bicester Village", "2026-10-15", "10:01", "6.20", "Off-Peak Day Single"),
    ("London Paddington", "Cardiff Central", "2026-10-14", "18:15", "45.50", "Advance Single"),
    ("Slough", "London Paddington", "2026-10-13", "08:41", "11.30", "Anytime Day Return"),
    ("Oxford", "Manchester Piccadilly", "2026-10-12", "06:58", "54.00", "Advance Single"),
    ("Exeter St Davids", "Plymouth", "2026-10-11", "14:22", "10.40", "Off-Peak Single"),
    ("Cheltenham Spa", "Oxford", "2026-10-10", "16:35", "24.70", "Off-Peak Day Return"),
]
LETTERS = [
    ("Oxford City Council", "CTR-48213", "2026-11-21", "126.50", "Council Tax reduction review"),
    ("HM Revenue and Customs", "HMRC-7Q2X9", "2026-12-05", "312.00", "Self Assessment reminder"),
    ("Thames Water", "TW-559104", "2026-11-14", "88.25", "Bill correction"),
    ("Openreach", "OR-30018", "2026-11-02", "32.31", "Missed engineer appointment"),
    ("DVLA", "DV-882651", "2026-11-30", "55.00", "Vehicle tax due"),
    ("Department for Work and Pensions", "DWP-PIP-4471", "2026-11-24", "0.00", "PIP decision"),
    ("British Gas", "BG-9920-17", "2026-11-09", "41.80", "Missed appointment payment"),
    ("Royal Mail", "RM-AB123456", "2026-11-03", "3.50", "Fee to pay"),
]


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    return ImageFont.load_default(size=size)


def _ticket(
    path: Path, origin: str, destination: str, day: str, time: str, fare: str, kind: str
) -> None:
    image = Image.new("RGB", (900, 420), "#fdf6e3")
    draw = ImageDraw.Draw(image)
    draw.rectangle((10, 10, 890, 410), outline="#c2410c", width=6)
    lines = [
        ("NATIONAL RAIL  ·  STANDARD CLASS", 26),
        (kind.upper(), 34),
        (f"FROM  {origin.upper()}", 30),
        (f"TO    {destination.upper()}", 30),
        (f"DATE  {day}    DEP {time}", 30),
        (f"PRICE GBP {fare}", 34),  # the default font has no £ glyph
        ("Synthetic eval ticket - not valid for travel", 18),
    ]
    y = 30
    for text, size in lines:
        draw.text((40, y), text, fill="#1f2937", font=_font(size))
        y += size + 22
    image.save(path, optimize=True)


def _letter(
    path: Path, sender: str, reference: str, deadline: str, amount: str, subject: str
) -> None:
    image = Image.new("RGB", (850, 1000), "white")
    draw = ImageDraw.Draw(image)
    body = [
        (sender, 34),
        (f"Our reference: {reference}", 24),
        ("", 24),
        (subject, 30),
        ("", 24),
        ("Dear Margaret,", 24),
        (f"Please respond by {deadline}.", 24),
        (f"Amount: GBP {amount}", 24),
        ("If you have questions, contact us quoting the reference above.", 22),
        ("", 22),
        ("Synthetic eval letter - not a real document", 18),
    ]
    y = 60
    for text, size in body:
        draw.text((60, y), text, fill="#111827", font=_font(size))
        y += size + 28
    image.save(path, optimize=True)


def main() -> None:
    images = OUT / "images"
    images.mkdir(parents=True, exist_ok=True)
    expected = []
    for i, (origin, destination, day, time, fare, kind) in enumerate(TICKETS, 1):
        name = f"ticket_{i:02d}.png"
        _ticket(images / name, origin, destination, day, time, fare, kind)
        expected.append(
            {
                "file": name,
                "kind": "ticket",
                "facts": {
                    "origin": origin,
                    "destination": destination,
                    "travel_date": day,
                    "departure_time": time,
                    "fare_gbp": fare,
                    "ticket_type": kind,
                },
            }
        )
    for i, (sender, reference, deadline, amount, subject) in enumerate(LETTERS, 1):
        name = f"letter_{i:02d}.png"
        _letter(images / name, sender, reference, deadline, amount, subject)
        expected.append(
            {
                "file": name,
                "kind": "letter",
                "facts": {
                    "sender": sender,
                    "reference": reference,
                    "deadline": deadline,
                    "amount_gbp": amount,
                },
            }
        )
    header = "# Synthetic extraction eval set (S6.1). Built by scripts/make_extraction_set.py.\n"
    (OUT / "expected.yaml").write_text(
        header + yaml.safe_dump(expected, sort_keys=False, allow_unicode=True)
    )
    print(f"wrote {len(expected)} images to {images}")


if __name__ == "__main__":
    main()
