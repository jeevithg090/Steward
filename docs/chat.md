# The chat: `POST /chat` and `/voice/tts`

*The contract is `plan.md` §4.1–4.3. The router is `tempo_core/intent.py` (pure, mypy-strict),
the route is `tempo_gateway/chat.py`, speech out is `tempo_gateway/tts.py`, the vectors are
`fixtures/chat/intents.json`, and the tests are `tests/unit/test_intent.py`,
`tests/unit/test_chat_plain.py`, `tests/unit/test_profile_refusal.py`,
`tests/policy/test_claims_guard.py`, `tests/integration/test_gateway_chat.py`,
`tests/integration/test_passkey_parity.py`, `tests/integration/test_one_claim_at_once.py` and
`tests/integration/test_gateway_tts.py`.*

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
unknown one is refused with 422, exactly as `/missions` refuses it, and a known one that can't
run the skill is refused in plain words (below). `slots` is what the client already knows from
earlier turns.

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
 "actions": null, "suggestions": ["£28.40"],
 "simulated": ["company", "rail data", "jurors", "vision"]}
```

`simulated` is the same list `/health` shows. `actions` are links into the web app
(`#/missions/:id`, `#/shield`, `#/memory`, `#/owed`, `#/profiles`, `#/read`). `suggestions` (at
most four, each at most 120 characters) are things the person could say next; the web shows them
as chips that send the text (see "Suggestions" below). Every fixed
sentence the chat can say scores Flesch ≥ 60 (`tests/unit/test_intent.py`); a reply that quotes
the engine (the consent ask's summary, a mission's message) is the engine's own, Flesch-checked
in `tests/unit/test_plain_language.py`. Each turn publishes `{"type": "chat_turn", "intent",
"user_id"}` on the event bus; the text is never published and never logged.

### Intents and what each does

| Intent | Words that open it (in rule order) | What the Gateway does | Reply carries |
|---|---|---|---|
| `stop` | "stop", "stop everything", "please stop", "cancel everything" | stops every mission of this person | `mission` |
| `approve` / `decline` | a bare yes/no ("yes", "ok go ahead", "no thanks"); a sentence starting with yes/no **only while a consent ask is pending** | answers the newest pending ask with a `SignedApproval` (scopes `file_claim`, `device_sig` the bearer's caller id); nothing pending → "Nothing is waiting for your answer." **With a passkey** (`mesh.has_passkey(user_id)`), a yes answers nothing: the reply is "Please confirm with Face ID or your fingerprint on this device." with the pending `ask` echoed for the web to sign. A no still declines (see "One rule for yes" below) | `mission`, `ask`; `suggestions` when the yes finds the claim already paid |
| `scam_check` | a link, "scam", "fraud", "is this real", "got a text", "someone rang", or a pasted message with pressure words (one strong: "safe account", "one-time code", "tax refund", "account locked"; or two weak: "urgent", "within 24 hours", "parcel", "fee") | `shield.check(text, language, user_id, source="web")` | `verdict` (zone, level, say, reasons, links, …) |
| `memory_forget` | "forget …", "erase …", "delete …" | `memory.forget(user_id, target)` | – |
| `memory_recall` | "remember", "what do you know about me" | `say_recalled(memory.recall(user_id))` | `memories` |
| `ledger` | "how much have you got back", "ledger", "hours back" | `summarise(repo.ledger_entries())` | `ledger`, `suggestions` |
| `letter` | "letter", "read this", "photo", "camera" | nothing: the camera button posts to `/letters/read` | action `#/read` |
| `missed_visit` | "engineer", "missed visit", "appointment", "didn't turn up", "nobody came", a provider name | a profile that can't run `clawback-ofcom` → its plain refusal, nothing starts; all facts → the live mission for the same visit if there is one, else `service.start_ofcom(StartOfcom)`; else one question | `mission`, `ask` or `needs` |
| `rail_delay` | "train", "late", "delay", "cancelled", a station, a CRS code, a time | a profile that can't run `clawback-uk-rail` → its plain refusal, nothing starts; all five facts → the live mission for the same journey if there is one, else `service.start(StartMission)`; else one question, in the order origin, destination, date, departure, fare. The fare is never guessed. A journey the rail records don't have → the plain fail-safe (below) | `mission`, `ask` or `needs` |
| `entitlement` | "owed", "benefit", "pension credit", "attendance allowance", "PIP" | nothing: the page asks the ten questions | action `#/owed` |
| `profiles` | "profile", "who do you work for" | lists the installed profiles by name | action `#/profiles` |
| `help` | "help", "what can you do", or an empty text | one plain paragraph naming the doors | `suggestions` |
| `smalltalk` | anything else | the canned line; or one model sentence that passed the word rules | `suggestions` |

"The train never came" is a `rail_delay`: the weak visit words ("never came", "didn't turn up")
give way when a train is in the sentence. A sentence with no door words of its own ("28.40",
"19 October") continues whichever flow the echoed `slots` belong to.

### A profile that can't run the skill

The skill a mission belongs to is its manifest (`MANIFESTS` in `tempo_gateway/missions.py`:
`clawback.uk-rail-delay-repay` → `skills/clawback-uk-rail`, `clawback.ofcom-missed-appointment`
→ `skills/clawback-ofcom`). When the turn's `profile_id` names a profile whose `may` lacks
anything in that manifest's `needs`, nothing starts, and the refusal comes before any question,
so nobody answers four questions to hear no. The words come from
`tempo_core.profiles.refusal`, which uses the guards' own verb phrases (`IN_PLAIN_WORDS`):

> Your profile, Read It To Me, doesn't let me file a claim or accept cash, so I haven't started.
> Choose another profile if you want me to file a claim.

The reply has `mission: null`, the action `{"label": "Show my profiles", "href": "#/profiles"}`,
the chip "Show me my profiles", and the merged `slots` (the facts stay, for another profile).
`POST /missions` and `POST /missions/ofcom` refuse the same way with **422** `{"detail": "<the
same sentence>"}`, and the voice tool `create_mission` answers `{"mission_id": null, "say": …}`.

Behind that, the workflows' own claim path is guarded too: `MissionService` wraps the claims port
in `tempo_harness.GuardedClaims`, which runs `CapabilityGuard` and `BudgetGuard` on every
`file_claim`. A mission started on `MissionService` directly under "Read It To Me" is still asked
about, but the claim is denied at the tool, nothing reaches the company, and the mission fails
safe with "This profile doesn't let me file a claim, so I stopped." An amount above the
profile's `limits.max_gbp_per_claim` is still asked about, and the ask's summary ends "This is
above your profile's limit of £250.00, so I'm asking you first."; the signed yes to that ask is
what lets the claim through. Which profile each mission runs under (and whether its ask named
the limit) is written atomically to `missions.json` beside the checkpoint folders and read back
by `recover()`, so a restart keeps the guard; if that file can't be read, the recovered
missions' claims are refused ("I can't find the profile this claim runs under, so I stopped.")
rather than run unguarded.

### Never the same claim twice

Before a `rail_delay` or `missed_visit` mission starts, the Gateway looks for this person's live
mission for the same thing (`MissionService.duplicate_of`, keyed by `mission_key`): a journey is
its origin, destination, date and departure as HHMM; a missed visit is the provider, ignoring
case and spacing, and the day. If there is one, that mission and its ask come back instead of a
second claim:

| The earlier mission is | Reply |
|---|---|
| `awaiting_consent` | "I'm already on this one. It needs your OK." with its `ask` |
| `verified` | "I already claimed this one." then its outcome message, and the chip "How much have you got back for me?" |
| `completed` | "I've already dealt with this one." then its outcome message |
| anything else still live (`running`, `waiting`, …) | "I'm already on this one. I'm waiting for the money." |

One that was declined or failed safe claimed nothing, so the same journey starts afresh. The key
is saved with the profile in `missions.json`, so this holds after a restart too. `POST /missions`
and `POST /missions/ofcom` follow the same rule: the existing mission comes back with **200**
instead of **201**, and the voice tool `create_mission` returns the existing mission's id. A
photographed card (`POST /missions/ofcom/read`) that reads as the same visit returns the same
mission too.

**At the same instant, too.** Every one of those doors starts through
`MissionService.start_once`, which holds one `asyncio.Lock` per person and claim
(`(user_id, mission_key)`) from the check until the mission has started. Two identical turns
sent together, through the same door or two different ones, make one mission: the second waits
until the first has started (its consent ask, or its plan), then gets that mission back ("I'm
already on this one. It needs your OK.", or **200**). Someone else's identical journey, and any other claim of
the same person, never waits on that lock. The lock lives in the Gateway process, as the asks
and timers do; the Gateway runs as one process. `tests/integration/test_one_claim_at_once.py`
fires the turns concurrently against a store that takes a moment per call, as Postgres does
(the in-memory store never yields, which hides the race), and its control test shows the old
check-then-start claims twice under that store.

### One rule for yes, on every door

Once a person has a passkey (`mesh.has_passkey(user_id)`), **only the passkey says yes**. A no and
a STOP are taken on every door, because ending a claim binds nobody (STOP already declines the
waiting ask on every door).

| Door | A yes, with a passkey | A no, with a passkey |
|---|---|---|
| `POST /chat` | nothing answered; "Please confirm with Face ID or your fingerprint on this device." and the `ask` echoed | declines |
| `POST /approvals/{id}` (bearer) | **403** "approve with your passkey on one of your devices" | declines (200) |
| SMS `YES` / `NO` | nothing answered; the reply below, and the device is woken | declines |
| voice `record_consent` | nothing answered; `state: awaiting_consent`, the `say` below, and the device is woken | declines |
| `/mesh/approvals/{id}` (signed) | answers | answers |

The SMS and phone words (`tempo_gateway/app.py:signed_yes_needed`, Flesch 93 to 98, checked in
`tests/unit/test_plain_language.py`):

> Tempo: You set up Face ID, so I can't take a yes by text. Open Tempo on your device and say yes
> with Face ID or your fingerprint. I've sent your device a reminder. Text NO or STOP to say no.

> You set up Face ID, so I can't take a yes on a call. Open Tempo on your device and say yes with
> Face ID or your fingerprint. I've sent your device a reminder. You can still say no here.

"I've sent your device a reminder." is there only when `mesh.notify` woke a device (the push
says only `{"type": "sync"}`); a failed push never fails the reply. A device without a passkey
changes nothing: until Face ID is added, a yes by text or by phone is still the person's answer.

### A journey the rail records don't have

When a started `rail_delay` mission comes back declined because the train isn't in the rail
records, the reply is built from the person's own facts, never the engine's message:

> I couldn't find the 08:12 from Oxford to Paddington on 24 October in the rail records.
> This demo only has trains from 22 and 23 October.

The second sentence and the chip with the recorded journey come in replay mode only. The
merged `slots` stay, so "it was on 23 October" next turn fixes the date and starts again. No
reply ever carries a Python repr: `readable()` takes an engine message's brackets off when they
hold one, and falls back to "I had to stop here. Mission Control shows what happened." if a repr
is still there. The replay adapter says which journey in words too ("no recorded journey for the
08:12 from Oxford to Paddington on 24 October 2026").

### Suggestions

| After | Chips |
|---|---|
| `help`, `smalltalk` | "My 08:12 train from Oxford to Paddington was 38 minutes late on 23 October. It cost £28.40.", "The Broadbandly engineer did not come on 19 October. No one rang.", "Is this a scam? HMRC: You are due a tax refund of 248.20 GBP. Claim within 24 hours at http://hmrc-refunds-gov.uk/claim", "Am I owed anything?" |
| the fail-safe above (replay mode) | the late-train sentence |
| the fare question, for the recorded demo journey (replay mode) | "£28.40" |
| a profile refusal | "Show me my profiles" |
| a yes that finds the claim paid (`verified`) | "How much have you got back for me?", "What do you remember about me?" |
| `ledger` | "What do you remember about me?", "Am I owed anything?" |

They live in `SUGGESTIONS` in `chat.py`. Each one reads at Flesch 60 or more except the pasted
scam text, which is a quote (`QUOTED`), and each opens the door it promises with the facts it
needs (`tests/unit/test_chat_plain.py`).

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
  journeys run and fail safe in plain words, with the recorded journey as a chip.
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
- The refusal sentence names the profile as it is written; a long community profile name or a
  long pair of station names can read below Flesch 60. The starter profiles and the demo
  journey are tested.
