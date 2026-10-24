# Vision fixtures

**Synthetic.** `sample_ticket.png` is a 1×1 placeholder image; `<sha256>.json` is the reading
`ReplayVision` returns for it (a Gemini-style `{"facts": [...]}` answer). To replay a real demo
photo, run it once through `GeminiVision` and save the answer as `<sha256-of-the-photo>.json`.
The fare's confidence (0.72) is deliberately below 0.8, so the demo asks one question about it.
