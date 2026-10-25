"""Every test runs without this computer's real keys or settings: the env files point nowhere, so a key added to
voice/.env or agents/.env (e.g. GEMINI_API_KEY) never turns a test into a paid API call."""
import os
import tempfile

_ABSENT = os.path.join(tempfile.mkdtemp(prefix="tempo-test-env-"), "absent.env")
os.environ["KAIROS_ENV_FILE"] = _ABSENT
os.environ["KAIROS_AGENTS_ENV_FILE"] = _ABSENT
for _name in list(os.environ):  # provider settings a developer's shell may export (e.g. after sourcing kairos.env)
    if _name.startswith(("TEMPO_LLM_", "BRIDGE_LLM_", "ELEVENLABS_", "GEMINI_", "KAIROS_")) or _name == "GOOGLE_API_KEY":
        if _name not in ("KAIROS_ENV_FILE", "KAIROS_AGENTS_ENV_FILE", "KAIROS_VOICE_COUNT_FILE"):
            os.environ.pop(_name)
os.environ["TEMPO_LLM_BASE_URL"] = "http://127.0.0.1:9"  # nothing listens: no model calls from tests
# scripts/reset_demo.py --yes deletes the voice page's daily call count: never the real voice/.voice_sessions.json
os.environ["KAIROS_VOICE_COUNT_FILE"] = os.path.join(os.path.dirname(_ABSENT), "voice_sessions.json")
