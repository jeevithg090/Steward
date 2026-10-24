# Vision fixtures

**Synthetic.** `sample_ticket.png` is a 1×1 placeholder image; `<sha256>.json` is the reading
`ReplayVision` returns for it (a Gemini-style `{"facts": [...]}` answer). To replay a real demo
photo, run it once through `GeminiVision` and save the answer as `<sha256-of-the-photo>.json`.
The fare's confidence (0.72) is deliberately below 0.8, so the demo asks one question about it.

`missed_visit_card.png` is a made-up "sorry we missed you" card from the simulated Broadbandly
(Rights Decay, R8); its reading is the JSON named after its SHA-256. The date's confidence
(0.74) is deliberately below 0.8, so Tempo reads it back once before planning. The same image is
in `apps/web/public/demo/` so Mission Control can send it.

`thames_water_overpayment.png` and `council_tax_reminder.png` are made-up letters for Read It To
Me (`POST /letters/read`), drawn by `scripts/make_letter_fixtures.py`; their readings are the JSON
files named after their SHA-256, and the `LetterReading` each should produce is in
`fixtures/letters/`. See `fixtures/letters/README.md`.
