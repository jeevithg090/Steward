# The chat: `POST /chat` and `/voice/tts`

*The contract is `plan.md` §4.1–4.3. The router is `tempo_core/intent.py` (pure, mypy-strict),
the route is `tempo_gateway/chat.py`, speech out is `tempo_gateway/tts.py`, the vectors are
`fixtures/chat/intents.json`, and the tests are `tests/unit/test_intent.py`,
`tests/integration/test_gateway_chat.py` and `tests/integration/test_gateway_tts.py`.*

## The idea

Free text from the web app goes to one route. **The router is code, not a model**: rules decide
which door the sentence is for and pull the facts out of it; the same `MissionService`,
`ShieldService` and `Memory` the SMS and voice doors use do the work, so the web says what the
phone says. A model may write one thing only, a small-talk sentence, and only when a chat key is
configured outside replay mode, under word rules that forbid numbers, money, links and promises
of action. Nothing a model says can set an amount or start a claim.

The server is stateless about conversations. When a fact is missing the reply asks **one**
question and echoes the merged `slots`; the client sends them back with the next turn, and the
answer ("28.40", "Oxford", "19 October") fills the slot that was asked.

## `POST /chat` (bearer)

Request (`ChatTurn`, `extra="forbid"`):

```json
{"user_id": "u_margaret", "display_name": "Margaret",
 "text": "my 08:12 Oxford to Paddington was 38 min late yesterday",
 "profile_id": null, "language": "en", "slots": {}}
```

`text` is at most 2000 characters (422 above that). `profile_id` names a Tempo Profile; an
unknown one is refused with 422, exactly as `/missions` refuses it. `slots` is what the client
already knows from earlier turns.

Response (`ChatReply`):

```json
{"intent": "rail_delay",
 "reply": "Your 08:12 from Oxford to Paddington on 24 October. What did the ticket cost?",
 "say": "…the same, or shorter, for the voice…",
 "slots": {"origin_crs": "OXF", "destination_crs": "PAD", "travel_date": "2026-10-24",
           "departure": "08:12", "fare_gbp": null, "delay_minutes": "38", "operator": null,
           "event_date": null, "notice_hours": null, "account_ref": null, "forget_target": null},
 "needs": [{"field": "fare_gbp", "question": "What did the ticket cost?"}],
 "mission": null, "ask": null, "verdict": null, "memories": null, "ledger": null, "flags": null,
 "actions": null,
 "simulated": ["company", "rail data", "jurors", "vision"]}
```

`simulated` is the same list `/health` shows. `actions` are links into the web app
(`#/missions/:id`, `#/shield`, `#/memory`, `#/owed`, `#/profiles`, `#/read`). Every fixed
sentence the chat can say scores Flesch ≥ 60 (`tests/unit/test_intent.py`); a reply that quotes
the engine (the consent ask's summary, a mission's message) is the engine's own, Flesch-checked
in `tests/unit/test_plain_language.py`. Each turn publishes `{"type": "chat_turn", "intent",
"user_id"}` on the event bus; the text is never published and never logged.

### Intents and what each does

| Intent | Words that open it (in rule order) | What the Gateway does | Reply carries |
|---|---|---|---|
| `stop` | "stop", "stop everything", "please stop", "cancel everything" | stops every mission of this person | `mission` |
| `approve` / `decline` | a bare yes/no ("yes", "ok go ahead", "no thanks"); a sentence starting with yes/no **only while a consent ask is pending** | answers the newest pending ask with a `SignedApproval` (scopes `file_claim`, `device_sig` the bearer's caller id); nothing pending → "Nothing is waiting for your answer." | `mission`, `ask` |
| `scam_check` | a link, "scam", "fraud", "is this real", "got a text", "someone rang", or a pasted message with pressure words (one strong: "safe account", "one-time code", "tax refund", "account locked"; or two weak: "urgent", "within 24 hours", "parcel", "fee") | `shield.check(text, language, user_id, source="web")` | `verdict` (zone, level, say, reasons, links, …) |
| `memory_forget` | "forget …", "erase …", "delete …" | `memory.forget(user_id, target)` | – |
| `memory_recall` | "remember", "what do you know about me" | `say_recalled(memory.recall(user_id))` | `memories` |
| `ledger` | "how much have you got back", "ledger", "hours back" | `summarise(repo.ledger_entries())` | `ledger` |
| `letter` | "letter", "read this", "photo", "camera" | nothing: the camera button posts to `/letters/read` | action `#/read` |
| `missed_visit` | "engineer", "missed visit", "appointment", "didn't turn up", "nobody came", a provider name | all facts → `service.start_ofcom(StartOfcom)`; else one question | `mission`, `ask` or `needs` |
| `rail_delay` | "train", "late", "delay", "cancelled", a station, a CRS code, a time | all five facts → `service.start(StartMission)`; else one question, in the order origin, destination, date, departure, fare. The fare is never guessed. | `mission`, `ask` or `needs` |
| `entitlement` | "owed", "benefit", "pension credit", "attendance allowance", "PIP" | nothing: the page asks the ten questions | action `#/owed` |
| `profiles` | "profile", "who do you work for" | lists the installed profiles by name | action `#/profiles` |
| `help` | "help", "what can you do", or an empty text | one plain paragraph naming the doors | – |
| `smalltalk` | anything else | the canned line; or one model sentence that passed the word rules | – |

"The train never came" is a `rail_delay`: the weak visit words ("never came", "didn't turn up")
give way when a train is in the sentence. A sentence with no door words of its own ("28.40",
"19 October") continues whichever flow the echoed `slots` belong to.

### Slots

| Slot | From | Example |
|---|---|---|
| `origin_crs`, `destination_crs` | the station table, by name, alias or CRS; "X to Y", "from X", "to Y", then order of mention. "Reading", "Bath" and "Victoria" count only with a capital, after from/to, or alone | `OXF`, `PAD` |
| `travel_date` / `event_date` | ISO, "today", "yesterday", "on 23 October", "October 21", "23/10", "last Friday". No year → the most recent one that has already happened | `2026-10-23` |
| `departure` | `08:12`, `8.12`, `8am`, `8:12pm`; the time after "the" or before "train" wins | `08:12` |
| `fare_gbp` | `£28.40`, "28 pounds", "cost 28.40"; a bare number when the fare is the one thing missing | `28.40` |
| `delay_minutes` | "38 minutes late", "delayed by 40 min", "an hour late" (60), "half an hour late" (30) | `38` |
| `operator` | the provider table (below) | `Broadbandly` |
| `notice_hours` | "2 hours notice", "gave me 48 hours", "no notice" (0) | `2` |
| `account_ref` | "account ref TT-88412" | `TT-88412` |
| `forget_target` | the words after "forget" | `my address` |

`extract(text, today=…, intent=…)` keeps only the slots that belong to the intent: a "£248.20"
in a pasted scam text is not a fare. Without `intent` every slot is returned and a date is the
visit's when the sentence has a provider or visit word, else the journey's.

### Adding a station or a provider

- **A station:** add its usual name and CRS code to `STATIONS` in `tempo_core/intent.py`
  (one entry per code; `station_name` reads it back), and any other spellings to `ALIASES`.
  If the name is also an ordinary word, add it to `_AMBIGUOUS`. Then add a vector to
  `fixtures/chat/intents.json`. Replay mode only has recorded journeys for OXF→PAD on
  2026-10-22 07:58 and 2026-10-23 08:12, 09:12 and 17:42 (`fixtures/rail/replay/`); other
  journeys run and fail safe with the Gateway's own message.
- **A provider:** add it to `PROVIDERS` with a regex. Use `(?i:…)` for a distinctive name;
  keep a short name case-sensitive (`\bBT\b`) or require a suffix (`now broadband`) so the word
  stays a word in a sentence. Add a vector.

### The vector file, shared with the web app

`fixtures/chat/intents.json` is `{"today": "YYYY-MM-DD", "vectors": [{"text", "intent",
"slots"}]}`. `today` fixes the relative dates ("yesterday", "last Friday"). Each vector's
`slots` are the non-null slots `extract(text, today, intent=classify(text))` returns, so a port
must filter by intent the same way. The Python test (`tests/unit/test_intent.py`) and the web
app's TypeScript port of the table (showcase mode runs the same rules in the browser) both
assert every vector. A new rule needs a vector; a vector that moves needs both ports to agree.

## `GET /voice/tts` and `POST /voice/tts` (bearer)

The browser never holds the ElevenLabs key. `GET` returns `{"configured": bool}` so the web app
can fall back to the browser's own voice. `POST {text ≤ 600, persona: tempo | negotiator |
analyst | auditor | contractor = tempo, voice: default | low = default, language = "en"}`
returns `audio/mpeg`.

- Voice id: `voice=low` → `ELEVENLABS_VOICE_TEMPO_LOW`; else `ELEVENLABS_VOICE_TEMPO`; else a
  built-in default per persona (`DEFAULT_VOICES` in `tts.py`, ElevenLabs' stock voices).
- Model `eleven_multilingual_v2`, stability 0.5, similarity boost 0.75.
- An in-memory LRU of 200 clips, keyed by `sha256(voice_id | text)`.
- **404** `{"detail": "voice is not configured"}` without `ELEVENLABS_API_KEY`; **502** when
  ElevenLabs answers anything but 2xx or does not answer. Failures are not cached.
- The text is never logged: the log line has the persona, `cached` and the clip's size.

## `/health`

`"chat": {"llm": "replay" | "off" | "<kind>"}` says what phrases small talk: `replay` in replay
mode, `off` when no chat model is configured, else the deployment mode's model kind (`ollama`,
`cortex`, `runpod-vllm`, `tee-vllm`). `build_chat_llm` in `tempo_gateway/main.py` builds it from
`chat_client` and catches `NotConfigured`.

## Honest limits

- The rules are English. Other languages reach Scam Shield (its warning speaks six languages)
  but the router's words are English.
- Dates are read as London calendar dates; a time is the timetabled departure, never validated
  against the timetable here (the rail port does that).
- Small talk is canned in replay mode and whenever no chat key is set.
