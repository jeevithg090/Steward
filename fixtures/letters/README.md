# Letter fixtures (Read It To Me, SHIPPING §4.8)

**Synthetic.** Two made-up letters, drawn by `scripts/make_letter_fixtures.py` with pillow into
`fixtures/vision/`:

| Photo | Recorded reading (`ReplayVision`) | Expected `LetterReading` |
|---|---|---|
| `thames_water_overpayment.png` | `fixtures/vision/<sha256>.json`: paid too much, £23.40 credit, nothing to do | `water_overpayment.reading.json` |
| `council_tax_reminder.png` | `fixtures/vision/<sha256>.json`: £112.00 due 21 days after the letter; the due date is read at 0.7 confidence on purpose, so Tempo reads it back once | `council_tax_reminder.reading.json` |

The `*.reading.json` files are golden: `tests/unit/test_letters.py` and
`tests/integration/test_letters_routes.py` compare `POST /letters/read` against them, and the web
showcase copies them. They were computed with `today = 2026-10-25`; nothing in them depends on
the day unless a due date has passed.

To change a letter, edit the script and run `uv run python scripts/make_letter_fixtures.py`, then
delete the old `<sha256>.json` it no longer refers to. No real person, account or reference
appears anywhere here.
