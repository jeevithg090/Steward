"""`make sync-voice`: push voice/**/*.yaml to ElevenLabs, creating or updating each agent.

Needs ELEVENLABS_API_KEY, VOICE_TOOL_SECRET, PUBLIC_URL (the Gateway as ElevenLabs sees it) and a
voice id for each agent (e.g. ELEVENLABS_VOICE_TEMPO). New agents print the .env line to add.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import httpx

from tempo_adapters.elevenlabs import ElevenLabsClient, load_agent_config, to_elevenlabs_payload
from tempo_adapters.settings import Settings

VOICE = Path(__file__).resolve().parent


async def main() -> int:
    settings = Settings()
    if settings.elevenlabs_api_key is None or settings.voice_tool_secret is None:
        print("Set ELEVENLABS_API_KEY and VOICE_TOOL_SECRET in .env first.")
        return 1
    async with httpx.AsyncClient() as http:
        client = ElevenLabsClient(http, api_key=settings.elevenlabs_api_key.get_secret_value())
        for path in sorted(VOICE.glob("**/*.yaml")):
            config = load_agent_config(path)
            voice_id = os.environ.get(config.voice.voice_id_env)
            if not voice_id:
                print(f"skip {config.id}: set {config.voice.voice_id_env}")
                continue
            payload = to_elevenlabs_payload(
                config,
                voice_id=voice_id,
                gateway_url=settings.public_url,
                tool_secret=settings.voice_tool_secret.get_secret_value(),
            )
            existing = os.environ.get(config.agent_id_env)
            agent_id = await client.save_agent(payload, existing)
            verb = "updated" if existing else "created"
            print(f"{verb} {config.id}: {config.agent_id_env}={agent_id}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
