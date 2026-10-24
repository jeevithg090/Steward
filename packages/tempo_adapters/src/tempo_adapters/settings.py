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
    payment_check_after_s: int = 7 * 24 * 3600  # how long the Watchdog waits before each check

    # Modes
    tempo_mode: Literal["live", "replay"] = "replay"
    tempo_demo: bool = False
    tempo_hooks: Literal["agent_hooks", "fallback"] = "agent_hooks"
    tempo_deploy: Literal["local", "cloud-standard", "cloud-private", "cloud-confidential"] = (
        "cloud-standard"
    )
    tempo_temporal: Literal["sql", "graphiti"] = "sql"

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
    voice_tool_secret: SecretStr | None = None

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

    # Vision
    gemini_api_key: SecretStr | None = None
    gemini_model: str = "gemini-flash-latest"  # (check) the Flash model your key can use

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

    # Web Push
    vapid_public_key: str | None = None
    vapid_private_key: SecretStr | None = None
    vapid_subject: str | None = None

    # RunPod private inference
    runpod_api_key: SecretStr | None = None
    runpod_endpoint_id: str | None = None

    @property
    def cortex_base_url(self) -> str | None:
        """OpenAI-compatible Cortex REST base URL, or None until the account is set."""
        if not self.snowflake_account:
            return None
        return f"https://{self.snowflake_account}.snowflakecomputing.com/api/v2/cortex/v1"
