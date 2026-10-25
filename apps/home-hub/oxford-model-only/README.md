# oxford-model-only

The **local model** part of [Tempo](#what-tempo-is), the voice-first personal agent built at OxHack 2026
(Oxford, 24–25 Oct 2026). It covers:

- running an open model on a MacBook with Ollama, free, with no API key and no data leaving the laptop;
- a one-command health check;
- the benchmarks behind the model choice: speed, tool calling, 10 languages, prompt injection;
- a locked-down HTTPS tunnel so an ElevenLabs voice agent can ask the Tempo hub questions.

**No secrets are in this repo.** The API keys and tokens stay in git-ignored files on the hub machine (see
[What's not here](#whats-not-here)).

## Use the model (no key needed)

[Ollama](https://ollama.com) serves the model on this Mac in the OpenAI format:

| Setting | Value |
|---|---|
| Base URL | `http://localhost:11434/v1` |
| Model | `qwen2.5:7b` |
| API key | any placeholder, e.g. `ollama`. Ollama has no auth, so a local model has no real key |

To try it:

```bash
curl -s http://localhost:11434/v1/chat/completions -H "Authorization: Bearer ollama" -H "Content-Type: application/json" -d '{"model":"qwen2.5:7b","messages":[{"role":"user","content":"Hello!"}]}'
```

Or chat in the terminal:

```bash
ollama run qwen2.5:7b
```

**Ollama Cloud keys** are something different: keys from https://ollama.com/settings/keys reach
Ollama's hosted models at `https://ollama.com/v1`, and prompts go to Ollama's servers. See
[MODEL.md](MODEL.md#swapping-to-a-cloud-provider).

## Is it ready? One command

```bash
python3 scripts/model_check.py --warm
```

It checks:
- Ollama is running;
- the model is downloaded, loaded and pinned in memory;
- the first token comes back in well under a second;
- an OpenAI-format tool call round trip works;
- the Tempo hub's `/api/ask` answers with the model, not its fallback;
- something will restart Ollama;
- Ollama isn't reachable from the Wi-Fi.

It ends with `READY` or `NOT READY: …`. It uses only the standard library and runs on Python 3.9+.

## Connect an ElevenLabs voice agent to the hub

ElevenLabs runs in the cloud, so it needs a public HTTPS address for the hub. The voice agent never talks
to the model directly; it asks the **hub**, which looks up the person's data and asks the local model:

```
ElevenLabs agent --(webhook tool "ask_tempo", HTTPS + hub token)--> ngrok --> Tempo hub /api/ask --> SQLite events
                                                                                                --> qwen2.5:7b (Ollama, this Mac)
```

1. **Start the tunnel:**
   ```bash
   tunnel/start_tunnel.sh
   ```
   It uses the ngrok account already on the machine, whose free static domain keeps the URL the same
   across restarts. [`tunnel/elevenlabs-policy.yml`](tunnel/elevenlabs-policy.yml) makes **only**
   `POST /api/ask` and `GET /api/hello` public. Everything else gets 404 from ngrok and never reaches the
   hub: the web app, device sign-up, ingest, events and profile. Tested 24 Oct, including path and case
   tricks. The hub treats tunnelled requests as *not* on the home network, and `/api/ask` without a valid
   device token gives 401.
   - Bodies over 64 KB get 413 at ngrok.
   - The tunnel runs with **`--inspect=false`**, because ngrok's local inspector (`127.0.0.1:4040`) otherwise
     records every request, Authorization header included. Never open `:4040` on stage.
   - The script reuses an already-running tunnel only if it has the policy *and* inspection off; it
     replaces any other.
2. **Get a hub device token for ElevenLabs.** On the hub machine, from `tempo-hub/`, run:
   ```bash
   .venv/bin/python scripts/device_admin.py add-agent --name "ElevenLabs voice agent" --token-file <path>
   ```
   It writes the token to the file with mode 600 and never prints it. Agent tokens can only call
   `/api/ask` and `/api/me`, and never get vault data. Keep the token out of chat and git.
3. **In ElevenLabs:** create a workspace secret with the value `Bearer <token>`. Then add the webhook tool
   [`elevenlabs/ask_tempo_tool.json`](elevenlabs/ask_tempo_tool.json): set the URL to your tunnel domain
   and `secret_id` to the secret's ID. The agent sends the question in English and speaks the `answer` field in the user's language. Through the tunnel the hub
   answered in 3.8–15.3 s. The tool timeout is 30 s, above the hub's 25 s budget.

Stop the tunnel with `pkill -x ngrok` (this stops every ngrok agent on the Mac). The policy also limits `POST /api/ask` to 30 per minute per client IP (429).

## Results (M3 Pro, 36 GB, Ollama 0.40.4, 24 Oct 2026)

| | Result |
|---|---|
| Cold start (model not in memory) | first token 1.5 s |
| Warm first token | 50–235 ms |
| Generation | ~28–33 tokens/s (`qwen2.5:7b`) |
| Full hub question (tool call plus answer) | 1.8–5.4 s (`qwen2.5:7b`), 1.2–1.6 s (`llama3.2:3b`) |

The full write-up is in [MODEL.md](MODEL.md): which model when, a 10-language table, prompt-injection
tests, memory limits, cloud swap, and the demo-morning checklist. Raw outputs are in
[`results/`](results/).

## Layout

| Path | What |
|---|---|
| `MODEL.md` | setup, measurements, model choice, languages, security notes, emergency checklist |
| `scripts/model_check.py` | the health check (also copied into `tempo-hub/scripts/`) |
| `bench/` | benchmark scripts. `ttft.py` and `ask_test.py` talk to Ollama and the hub over HTTP; the others import `hub.model`, so run them from the `tempo-hub` folder with its venv |
| `results/` | raw JSONL from each benchmark run, simulated demo data only |
| `launchd/org.tempo.ollama.plist` | LaunchAgent template: Ollama at login, restart on crash (installed and crash-tested on the hub Mac, 24 Oct) |
| `tunnel/` | ngrok start script and the traffic policy that limits the public surface |
| `elevenlabs/ask_tempo_tool.json` | the ElevenLabs webhook tool definition (placeholders, no secrets) |

## What's not here

These stay on the hub machine and are never committed:
- the ElevenLabs API key (`tempo-hub/voice/.env`, git-ignored, chmod 600);
- the ngrok authtoken (ngrok's own config);
- hub device tokens and the ingest key (the hub's SQLite database);
- this Mac's ollama.com identity key (`~/.ollama/id_ed25519`).

## What Tempo is

Tempo is an open-source, voice-first personal agent. Your phones, watches and laptops sync their events to
a small hub you own; you ask questions by voice; and a local model answers from your own data. No paid API
keys are required, and no vendor lock-in.
