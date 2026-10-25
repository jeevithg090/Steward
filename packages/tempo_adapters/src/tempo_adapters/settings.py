"""Runtime settings, read from the environment and `.env` (documented in `.env.example`).

Secrets are `SecretStr`, so they never appear in reprs, logs or error messages.
"""

from __future__ import annotations

from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", env_ignore_empty=True, extra="ignore"
    )

    # Gateway
    tempo_api_token: SecretStr | None = None  # Mission Control's bearer token until passkeys (S5.2)
    public_url: str = "http://localhost:8000"  # the URL Twilio and ElevenLabs call (for signatures)
    elevenlabs_webhook_secret: SecretStr | None = None
    checkpoint_dir: str = "checkpoints"
    web_origins: str = "http://localhost:3000"  # Mission Control's origins, comma-separated
    payment_check_after_s: int = 7 * 24 * 3600  # how long the Watchdog waits before each check

    # Modes
    tempo_mode: Literal["live", "replay"] = "replay"
    tempo_demo: bool = False
    tempo_hooks: Literal["agent_hooks", "fallback"] = "agent_hooks"
    tempo_deploy: Literal[
        "local", "cloud-standard", "cloud-private", "cloud-confidential", "cloud-gpu", "cloud-apis"
    ] = "cloud-standard"
    # The model-backed parts (jurors, small talk, reading photos): live or recorded. Unset, they
    # follow TEMPO_MODE; `live` with TEMPO_MODE=replay is the GPU demo (plan.md §13): real model,
    # recorded rail data, company and registers, and /health says exactly that.
    tempo_models: Literal["live", "replay"] | None = None
    tempo_temporal: Literal["sql", "graphiti"] = "sql"
    tempo_region: str | None = None  # where the data actually lives (e.g. us-east-1); shown as is
    image_digest: str | None = None  # set by the deploy: the running image (Privacy Proof panel)
    tempo_memory: Literal["sql", "mem0"] = "sql"  # personal memory: our pgvector table, or Mem0
    memory_dir: str = "memory"  # Mem0's local files (history, embedded Qdrant without Postgres)

    # Snowflake Cortex
    snowflake_account: str | None = None
    snowflake_pat: SecretStr | None = None
    cortex_fast_model: str = "claude-haiku-5-5"

    # ElevenLabs
    elevenlabs_api_key: SecretStr | None = None
    elevenlabs_agent_inbound_id: str | None = None
    elevenlabs_agent_negotiator_id: str | None = None
    elevenlabs_arena_staller_id: str | None = None
    elevenlabs_arena_injector_id: str | None = None
    elevenlabs_arena_lowballer_id: str | None = None
    elevenlabs_arena_verifier_id: str | None = None  # the company line that checks mandates
    voice_tool_secret: SecretStr | None = None
    elevenlabs_voice_tempo: str | None = None  # Tempo's voice (voice library id)
    elevenlabs_voice_tempo_low: str | None = None  # a lower-pitched Tempo, for hearing loss

    # Twilio
    twilio_account_sid: str | None = None
    twilio_auth_token: SecretStr | None = None
    twilio_number: str | None = None

    # Rail data
    rtt_token: SecretStr | None = None
    rtt_base_url: str = "https://data.rtt.io"
    hsp_base_url: str | None = None
    hsp_api_key: SecretStr | None = None
    hsp_user: str | None = None
    hsp_pass: SecretStr | None = None

    # Scam Shield registers, phishing lists and the link sandbox (docs/scam-shield.md)
    companies_house_api_key: SecretStr | None = None
    fca_api_email: str | None = None
    fca_api_key: SecretStr | None = None
    scam_feeds_dir: str | None = (
        None  # refreshed lists (make refresh-feeds); else fixtures/scam/feeds
    )
    urlhaus_auth_key: SecretStr | None = None
    phishtank_api_key: SecretStr | None = None
    scam_sandbox: Literal["replay", "live"] | None = None  # None: live when TEMPO_MODE=live

    # Vision
    gemini_api_key: SecretStr | None = None
    gemini_model: str = "gemini-flash-latest"  # (check) the Flash model your key can use
    # cloud-apis (plan.md §13.5): three different Gemini checkpoints judge; small talk uses the
    # first. Measured 25 Oct 2026 with six Court questions at once on the free tier: all 6/6, the
    # slowest 1.3 s, 4.7 s and 17.2 s. gemini-3-flash-preview and gemini-3.5-flash hit 429 there.
    gemini_juror_models: str = (
        "gemini-3.5-flash-lite,gemini-3.1-flash-lite-preview,gemini-3.1-flash-lite"
    )
    # With NVIDIA's key (build.nvidia.com), its model takes the second seat on its own rate limit.
    # Measured 25 Oct 2026 on the real Court question, six at once: all right, 2.9 to 6.3 s, and it
    # rejected a 10-minute delay. NVIDIA_MODELS="" keeps the Court on Gemini alone.
    nvidia_api_key: SecretStr | None = None
    nvidia_models: str = "nvidia/nemotron-3.5-bolt-e4b"
    # The chat's brain (plan.md §16): a language model holds the conversation and acts only
    # through Tempo's tools. "auto" uses NVIDIA's model when NVIDIA_API_KEY is set and the models
    # are live. Nemotron 3 Ultra, measured 25 Oct 2026: it understood "London" mid-claim, said
    # kindly that a plumber isn't something Tempo can claim for, and called the claim tool with
    # every fact right, in 3 to 6 s.
    chat_brain: Literal["auto", "nvidia", "off"] = "auto"
    nvidia_brain_model: str = "nvidia/nemotron-3-ultra-550b-a55b"
    brain_timeout_s: float = 25.0  # per model call; a look-up turn makes two (1 to 17 s each)
    # The brain's look-ups (plan.md §17): OpenStreetMap, Open-Meteo, DuckDuckGo and Wikipedia need
    # no key. A Tavily or Brave key turns on full web search (news, prices, opening hours).
    web_tools: bool = True
    addons: bool = True  # the MCP add-ons in addons/tools.yaml (started with uvx)
    tavily_api_key: SecretStr | None = None
    brave_api_key: SecretStr | None = None
    openrouter_api_key: SecretStr | None = None
    # Opt-in: an OpenRouter model takes the second seat (e.g. dots-studio/dots-3-note-preview:free:
    # correct, but 17.7 s and about 50 free requests a day; raise JUROR_TIMEOUT_S to 35 with it).
    openrouter_models: str = ""
    juror_timeout_s: float = (
        20.0  # the Consensus Court's per-juror limit; an absent juror is flagged
    )
    # How long the third juror gets once two agree. Live on 25 Oct 2026 the two Gemini jurors agreed
    # in 1 to 3 s and NVIDIA's in 3 to 6 s: at 2 s a correct third model was cut off most times.
    juror_grace_s: float = 5.0

    # Tracing
    langfuse_host: str = "https://cloud.langfuse.com"
    langfuse_public_key: str | None = None
    langfuse_secret_key: SecretStr | None = None

    # Databases
    database_url: SecretStr | None = None
    neo4j_uri: str | None = None
    neo4j_http_url: str = "http://localhost:7474"
    neo4j_user: str = "neo4j"
    neo4j_password: SecretStr | None = None

    # Tempo Mesh (passkeys are bound to this domain; use your PWA's host when deployed)
    mesh_rp_id: str = "localhost"
    mesh_file: str = "mesh.json"  # devices and their public keys; never secrets

    # Agent Passport: the Gateway's Ed25519 seed, for mandates from a spoken yes (P2)
    mandate_signing_key: SecretStr | None = None

    # Web Push
    vapid_public_key: str | None = None
    vapid_private_key: SecretStr | None = None
    vapid_subject: str | None = None

    # Local mode (Ollama) and Confidential mode
    ollama_base_url: str = "http://localhost:11434/v1"
    ollama_model: str = "qwen3:8b"  # (check) a small tool-calling model you have pulled
    confidential_base_url: str | None = None

    # RunPod private inference
    runpod_api_key: SecretStr | None = None
    runpod_endpoint_id: str | None = None

    @property
    def cortex_base_url(self) -> str | None:
        """OpenAI-compatible Cortex REST base URL, or None until the account is set."""
        if not self.snowflake_account:
            return None
        return f"https://{self.snowflake_account}.snowflakecomputing.com/api/v2/cortex/v1"
