# Tempo agents: the helpers inside the Kairos app

The agents that work for a person from inside the app. First one: the **letter reader**, for the anxiety of an
official envelope. You photograph the paper; Kairos says, in your language and the way people speak it where
you live: *"This is a letter from the water company. It says you paid too much last month, so you don't owe
anything today."*

```
 Kairos app (iPhone) / tap-to-talk page (any phone)
        │ photo + language + dialect           X-Tempo-Phone-Key
        ▼
 voice/token_server.py  :8788  /voice/agents/*   checks the phone key, forwards      (public via ngrok)
        ▼
 agents/server.py       :8789  /agents/*          loopback only
        │
        ├─ document_interpreter/   understand ─▶ assess ─▶ explain ─▶ speak ─▶ remember ─▶ follow-up
        │        ▲ model: Gemini (the agents' model)  │ fallback: Ollama qwen3.5:4b on this Mac
        │        └ voice: Gemini TTS                  └ fallback: the phone's own voice
        └─ core/memory.py  ─▶ tempo-hub :8787  document.read + document.deadline (vault)  ─▶ Kairos can
                                                                                            answer "what's due?"
```

## Run

```bash
agents/set_gemini_key.sh     # once: copy the key in Google AI Studio, then run this (clipboard -> .env, cleared)
agents/run.sh                # the service on 127.0.0.1:8789
.venv/bin/python -m agents.cli --health
.venv/bin/python agents/samples/make_sample_letter.py
.venv/bin/python -m agents.cli agents/samples/water_credit.png --language te --dialect Telangana --play
.venv/bin/python -m pytest -q agents/tests
```

Without a Gemini key the service still works: the local `qwen3.5:4b` reads the photo and writes the
explanation, and the phone speaks it with its own voice. With the key, Gemini reads and speaks (100+ languages).

## Demo (3 minutes)

Sample letters are in `agents/samples/` (`make_sample_letter.py` renders them; fictional details).

1. **The pitch line.** Photograph `water_credit.png` (or show it on a screen and photograph that) with language
   **తెలుగు** and dialect *Telangana*. Kairos says, in Telugu: it's from the water company, you paid too much,
   nothing to pay this month. Tap **Hear it again**. Switch to English and read it again: same facts.
2. **A deadline becomes time.** Photograph `council_tax.png`. Kairos: £142 by the third of November. The hub now
   holds `document.deadline` with `due: 2026-11-03`. Start a voice call and ask *"what do I have to pay this
   week?"*: Kairos answers from the hub (the letter reader's device is a normal device, so its events are on the
   timeline; on the ElevenLabs channel vault data needs `device_admin.py vault <id> on`).
3. **The scam.** Photograph `scam_hmrc.png`. The warning card appears and Kairos says: don't pay, don't call
   that number, check with the real HMRC. The scam signals are code (gift cards, 48-hour threats, a non-official
   website, a mobile number for a government body), not just the model's opinion.
4. **Ask about it.** Type *"what if I can't pay by then?"* under the council letter: the answer comes only from
   the letter's own text (call the council, they can spread payments).
5. **No lock-in.** Stop the agents service, remove the Gemini key, start it again: the same photo is read by the
   Mac's own model and spoken by the phone's own voice (slower, and only when the Mac has memory for a second
   model).

## The pipeline, stage by stage

| Stage | File | What happens | Step shown on the phone |
|---|---|---|---|
| capture | app / page | photo taken, downscaled to ~1600 px, sent as base64 JSON | "Reading your letter…" |
| understand | `document_interpreter/schema.py`, `prompts.py` | the model fills one JSON schema: sender, type, summary, money, dates, deadline, actions, scam signs, transcript | "Looking at the photo", "It's a bill from Isis Water" |
| assess | `document_interpreter/safety.py` | fixed scam signals (gift cards, 48-hour threats, odd websites, mobile numbers for "HMRC") combined with the model's verdict; never the model alone | "Checking for anything suspicious" |
| explain | `prompts.py` | spoken words in the person's language and dialect, fixed order: who/what → main message → money → what to do by when → calm close; scam warning if needed | "Putting it into plain Telugu (Telangana)" |
| speak | `core/speech.py` | Gemini TTS → WAV; or `null` and the phone speaks | "Getting the voice ready" |
| remember | `core/memory.py` | `document.read` + one `document.deadline` per date to act by, class vault, in the hub | "Remembering what it said" |
| follow-up | `agent.follow_up` | "what if I can't pay?" answered only from the facts and transcript kept for the job | |

## API (as the phone sees it, via `/voice/agents/...`)

| Method | Path | Body → reply |
|---|---|---|
| POST | `/agents/document/interpret` | `{image (base64), mime, language: "te", dialect: "Telangana", reading_level: "simple", speak: true, wait: 55}` → job `{id, status, steps[], result}`; `result = {document, explanation{text, language, speech_lang}, audio{audio_b64, mime}|null, safety{level, reasons, notice}, memory, provider}` |
| GET | `/agents/jobs/{id}`, `/agents/jobs/latest` | the job (poll while `status: running`) |
| POST | `/agents/document/{id}/ask` | `{question, speak}` → `{answer, audio}` |
| GET | `/agents/health`, `/agents` | what's wired, which agents exist, language choices |
| POST | `/agents/{name}/run` | `{inputs, wait}` for any registered agent |

## Adding an agent

1. Make `agents/<your_agent>/agent.py` with a class that extends `core.registry.Agent`: set `name`, `title`,
   `description`, `input_schema`; implement `run(inputs, on_step, context)` (call `on_step("…")` for every stage
   so the phone can show it) and, if it makes sense, `follow_up(question, context, on_step)`.
2. Use `self.models.understand(...)` / `self.models.write(...)` from `core/llm.py` (Gemini, local fallback),
   `core/speech.py` to speak and `core/memory.py` to remember.
3. `registry.register(YourAgent(...))` in `server.create_app`. It's then at `POST /agents/<name>/run`, and
   listed by `GET /agents`.

## Privacy and safety

- Photos are processed and dropped: the job keeps only the extracted facts for follow-ups, for one hour.
- With a Gemini key, the photo and the explanation go to Google. Without one, nothing leaves the Mac.
- Document text is data, never instructions: both prompts say so and the facts are passed as JSON.
- Scam checks are code, not only the model's opinion. A medium/high risk adds a plain spoken warning.
- The service listens on loopback only; the phone path needs the phone key and goes through the tunnel.
- Memory in the hub is class vault: never spoken over the ElevenLabs channel unless the owner allows vault there.
- It's information, not legal or financial advice; the prompts say so and the UI shows it.
