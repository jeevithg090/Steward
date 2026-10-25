"""Text to speech for the agents.

    Gemini TTS (same key as the model)  -> WAV bytes, 24 kHz mono 16-bit. 100+ languages, auto-detected.
    None                                -> the phone speaks the text itself (iOS AVSpeechSynthesizer / web
                                           speechSynthesis). Free, offline, always available.

synthesize() never raises: it returns None when it can't, and the phone falls back to its own voice.
"""
from __future__ import annotations

import base64
import struct
import time
from typing import Optional

from .config import Settings


def pcm_to_wav(pcm: bytes, rate: int = 24000, channels: int = 1, bits: int = 16) -> bytes:
    byte_rate = rate * channels * bits // 8
    header = struct.pack("<4sI4s4sIHHIIHH4sI", b"RIFF", 36 + len(pcm), b"WAVE", b"fmt ", 16, 1, channels,
                         rate, byte_rate, channels * bits // 8, bits, b"data", len(pcm))
    return header + pcm


def _rate_from_mime(mime: str) -> int:
    for part in (mime or "").split(";"):
        part = part.strip().lower()
        if part.startswith("rate="):
            try:
                return int(part[5:])
            except ValueError:
                pass
    return 24000


class GeminiSpeech:
    def __init__(self, api_key: str, model: str, voice: str, timeout: float = 45.0):
        from google import genai
        from google.genai import types
        self._types = types
        self.client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=int(timeout * 1000)))
        self.model, self.voice = model, voice

    def _via_generate(self, text: str, language: Optional[str]) -> tuple[bytes, str]:
        t = self._types
        speech = {"voice_config": t.VoiceConfig(prebuilt_voice_config=t.PrebuiltVoiceConfig(voice_name=self.voice))}
        if language:
            speech["language_code"] = language
        cfg = t.GenerateContentConfig(response_modalities=["AUDIO"], speech_config=t.SpeechConfig(**speech))
        resp = self.client.models.generate_content(model=self.model, contents=text, config=cfg)
        for cand in resp.candidates or []:
            for part in (cand.content.parts if cand.content else []) or []:
                blob = getattr(part, "inline_data", None)
                if blob and blob.data:
                    data = blob.data if isinstance(blob.data, (bytes, bytearray)) else base64.b64decode(blob.data)
                    mime = (blob.mime_type or "").lower()
                    if "wav" in mime or data[:4] == b"RIFF":
                        return bytes(data), "audio/wav"
                    return pcm_to_wav(bytes(data), rate=_rate_from_mime(mime)), "audio/wav"
        raise RuntimeError("no audio in the reply")

    def _via_interactions(self, text: str) -> tuple[bytes, str]:
        """The newer Interactions API shape from the 2026 docs; used if generate_content refuses the TTS model."""
        inter = self.client.interactions.create(
            model=self.model,
            input=[{"type": "user_input", "content": [{"type": "text", "text": text}]}],
            response_format={"type": "audio"},
            generation_config={"speech_config": [{"voice": self.voice}]},
        )
        data = base64.b64decode(inter.output_audio.data)
        return (data, "audio/wav") if data[:4] == b"RIFF" else (pcm_to_wav(data), "audio/wav")

    def synthesize(self, text: str, language: Optional[str] = None) -> Optional[dict]:
        t0 = time.time()
        errors = []
        for fn in (lambda: self._via_generate(text, language), lambda: self._via_interactions(text)):
            try:
                data, mime = fn()
                return {"audio_b64": base64.b64encode(data).decode(), "mime": mime, "provider": "gemini",
                        "model": self.model, "voice": self.voice, "seconds": round(time.time() - t0, 1)}
            except Exception as e:  # noqa: BLE001
                errors.append(f"{type(e).__name__}: {str(e)[:120]}")
        print("tts failed: " + " | ".join(errors), flush=True)  # no text, no key
        return None


class Speech:
    """Picks Gemini TTS when a key is set; otherwise tells the phone to speak."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self._gemini: Optional[GeminiSpeech] = None
        if settings.gemini_enabled:
            try:
                self._gemini = GeminiSpeech(settings.gemini_api_key, settings.tts_model, settings.tts_voice)
            except Exception as e:  # noqa: BLE001
                print(f"gemini tts unavailable: {type(e).__name__}", flush=True)

    @property
    def available(self) -> str:
        return "gemini" if self._gemini else "device"

    def synthesize(self, text: str, language: Optional[str] = None) -> Optional[dict]:
        if not text or not self._gemini:
            return None
        # Spoken text only: never read a reference number longer than a phone number aloud as one blob.
        return self._gemini.synthesize(text[:3000], language)
