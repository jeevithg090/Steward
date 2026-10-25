"""Speech out for the web app (plan.md §4.2): ElevenLabs with the Gateway's own key.

No `from __future__ import annotations`: FastAPI reads these annotations at runtime.

| Route | What (both behind the Mission Control bearer) |
|---|---|
| GET /voice/tts | `{"configured": bool}`: whether a key is set, so the browser can fall back |
| POST /voice/tts | text in, `audio/mpeg` out; 404 with no key, 502 when ElevenLabs fails |

Keys stay on the server: the browser never sees ELEVENLABS_API_KEY. The text is never logged;
the log line carries the persona, whether the clip came from the cache, and its size. An LRU of
200 clips, keyed by sha256(voice id | text), spares the same sentence a second round trip.
"""

import hashlib
from collections import OrderedDict
from typing import Any, Literal

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from tempo_adapters.settings import Settings

log = structlog.get_logger("tempo.tts")

API = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
MODEL = "eleven_multilingual_v2"
VOICE_SETTINGS = {"stability": 0.5, "similarity_boost": 0.75}
TIMEOUT = httpx.Timeout(20.0, connect=5.0)
CACHE_SIZE = 200
MAX_TEXT = 600
NOT_CONFIGURED = "voice is not configured"
UPSTREAM_FAILED = "the voice service didn't answer"

Persona = Literal["tempo", "negotiator", "analyst", "auditor", "contractor"]
# ElevenLabs' stock voices, used when no voice id is configured. Public ids, not secrets.
DEFAULT_VOICES: dict[str, str] = {
    "tempo": "21m00Tcm4TlvDq8ikWAM",
    "negotiator": "21m00Tcm4TlvDq8ikWAM",
    "analyst": "AZnzlk1XvdvUeBnXmlld",
    "auditor": "EXAVITQu4vr4xnSDxMaL",
    "contractor": "ErXwobaYiN019PkySvjV",
}


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT)
    persona: Persona = "tempo"
    voice: Literal["default", "low"] = "default"
    language: str = Field(default="en", pattern=r"^[a-z]{2}$")


def voice_id_for(settings: Settings, persona: str, voice: str) -> str:
    """`voice=low` → ELEVENLABS_VOICE_TEMPO_LOW, else ELEVENLABS_VOICE_TEMPO, else the persona's
    built-in default."""
    if voice == "low" and settings.elevenlabs_voice_tempo_low:
        return settings.elevenlabs_voice_tempo_low
    if settings.elevenlabs_voice_tempo:
        return settings.elevenlabs_voice_tempo
    return DEFAULT_VOICES[persona]


def clip_key(voice_id: str, text: str) -> str:
    return hashlib.sha256(f"{voice_id}|{text}".encode()).hexdigest()


class ClipCache:
    """The last `size` clips, least recently used first out."""

    def __init__(self, size: int = CACHE_SIZE) -> None:
        self._clips: OrderedDict[str, bytes] = OrderedDict()
        self._size = size

    def get(self, key: str) -> bytes | None:
        clip = self._clips.get(key)
        if clip is not None:
            self._clips.move_to_end(key)
        return clip

    def put(self, key: str, clip: bytes) -> None:
        self._clips[key] = clip
        self._clips.move_to_end(key)
        while len(self._clips) > self._size:
            self._clips.popitem(last=False)

    def __len__(self) -> int:
        return len(self._clips)


def tts_router(
    settings: Settings, web_caller: Any, http: httpx.AsyncClient | None = None
) -> APIRouter:
    router = APIRouter(prefix="/voice", dependencies=[Depends(web_caller)])
    client = http or httpx.AsyncClient(timeout=TIMEOUT)
    cache = ClipCache()
    key = settings.elevenlabs_api_key

    @router.get("/tts")
    async def configured() -> dict[str, bool]:
        """Whether the Gateway can speak; the browser uses its own voice when it can't."""
        return {"configured": key is not None}

    @router.post("/tts")
    async def speak(body: TtsRequest) -> Response:
        """One sentence to MP3, from the cache when it was said before."""
        if key is None:
            raise HTTPException(404, NOT_CONFIGURED)
        voice_id = voice_id_for(settings, body.persona, body.voice)
        clip_id = clip_key(voice_id, body.text)
        clip = cache.get(clip_id)
        cached = clip is not None
        if clip is None:
            clip = await _synthesise(client, key.get_secret_value(), voice_id, body.text)
            cache.put(clip_id, clip)
        log.info("tts", persona=body.persona, voice=body.voice, cached=cached, size=len(clip))
        return Response(
            content=clip, media_type="audio/mpeg",
            headers={"Cache-Control": "private, max-age=3600"},
        )  # fmt: skip

    return router


async def _synthesise(client: httpx.AsyncClient, api_key: str, voice_id: str, text: str) -> bytes:
    try:
        response = await client.post(
            API.format(voice_id=voice_id),
            headers={"xi-api-key": api_key, "accept": "audio/mpeg"},
            json={"text": text, "model_id": MODEL, "voice_settings": VOICE_SETTINGS},
        )
    except httpx.HTTPError as exc:
        log.warning("tts_failed", error_code=type(exc).__name__)
        raise HTTPException(502, UPSTREAM_FAILED) from None
    if response.status_code // 100 != 2:
        log.warning("tts_failed", status=response.status_code)
        raise HTTPException(502, UPSTREAM_FAILED)
    return response.content
