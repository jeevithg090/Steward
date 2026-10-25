# Benchmarks

All results in `../results/` come from these scripts (24 Oct 2026, MacBook Pro M3 Pro, Ollama 0.40.4) against
the hub's simulated demo data.

| Script | What it does | How to run |
|---|---|---|
| `ttft.py` | time to first token over Ollama's native `/api/chat` | `python3 ttft.py qwen2.5:7b` |
| `ask_test.py` | 7 realistic questions through the hub's real `POST /api/ask` | `python3 ask_test.py <file.json with {"device_token": ...}>` |
| `lang_test.py` | the train question in 10 languages through the hub's tool loop (`hub.model.ask`); `--hint` adds the proposed prompt | from `tempo-hub/`: `.venv/bin/python ../oxford-model-only/bench/lang_test.py qwen2.5:7b [--hint]` |
| `prompt_test.py`, `full_test.py` | proposed prompt (language + injection rules) on the pre-19:00 hub code; `full_test.py` takes extra request fields as JSON | same, e.g. `full_test.py qwen3.5:4b '{"max_tokens":300,"reasoning_effort":"none"}'` |
| `current_code_test.py` | the **current** hub code, unchanged, optionally with extra request fields | `current_code_test.py qwen2.5:7b '{"max_tokens":300}'` |
| `current_code_test_searchfix.py` | the same, plus the proposed `search_events` fallback, patched **in memory** | same |
| `current_code_test_full_fix.py` | the same, plus the firmer English-keywords sentence in `RULES` | same |

The hub-importing scripts never edit hub files: every change is a monkeypatch inside the test process.
They read the hub's SQLite database through `hub.db`, so run them on the hub machine.
