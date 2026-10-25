"""One model interface, two providers.

    Gemini (google-genai)  - primary: the user's choice for the agents. Reads photos, writes in any language.
    Ollama (qwen3.5:4b)    - fallback on this Mac: no key, no data leaving the laptop. Vision-capable.

Every provider implements:
    understand(images, prompt, schema, system) -> dict     photo(s) + instructions -> JSON matching `schema`
    write(prompt, system) -> str                           text in, text out (explanations, answers)
Chain([...]) tries providers in order and remembers which one answered (result["_provider"] / .last_provider).
Nothing here logs prompts or images: they are photos of people's letters.
"""
from __future__ import annotations

import base64
import io
import json
import re
import time
import urllib.error
import urllib.request
from typing import Any, List, Optional, Sequence

from .config import Settings

Image = tuple  # (bytes, mime)


class ModelError(RuntimeError):
    pass


def prepare_image(data: bytes, mime: str = "image/jpeg", max_side: int = 1600) -> Image:
    """Downscale, fix EXIF rotation and re-encode as JPEG. Smaller uploads to the model, same readable text.
    Falls back to the original bytes if Pillow can't read them (then the model gets what the phone sent)."""
    try:
        from PIL import Image as PILImage, ImageOps
        im = PILImage.open(io.BytesIO(data))
        im = ImageOps.exif_transpose(im)
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        w, h = im.size
        if max(w, h) > max_side:
            s = max_side / max(w, h)
            im = im.resize((max(1, int(w * s)), max(1, int(h * s))))
        out = io.BytesIO()
        im.save(out, format="JPEG", quality=85, optimize=True)
        return out.getvalue(), "image/jpeg"
    except Exception:
        return data, mime or "image/jpeg"


def _json_from_text(text: str) -> dict:
    """Models sometimes wrap JSON in ``` fences or prose; take the first {...} block."""
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.S)
    try:
        return json.loads(text)
    except ValueError:
        m = re.search(r"\{.*\}", text, flags=re.S)
        if not m:
            raise ModelError("The model didn't return JSON.")
        return json.loads(m.group(0))


class Provider:
    name = "none"

    def understand(self, images: Sequence[Image], prompt: str, schema: dict, system: str = "") -> dict:
        raise NotImplementedError

    def write(self, prompt: str, system: str = "", max_tokens: int = 700) -> str:
        raise NotImplementedError


class GeminiProvider(Provider):
    name = "gemini"

    def __init__(self, api_key: str, model: str, fast_model: Optional[str] = None, timeout: float = 60.0):
        from google import genai  # imported here so the local fallback works without the package
        from google.genai import types
        self._genai, self._types = genai, types
        self.client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=int(timeout * 1000)))
        self.model = model
        self.fast_model = fast_model or model

    def _config(self, system: str, json_schema: Optional[dict], max_tokens: int, low_thinking: bool):
        t = self._types
        kw: dict[str, Any] = {"temperature": 0.2, "max_output_tokens": max_tokens}
        if system:
            kw["system_instruction"] = system
        if json_schema is not None:
            kw["response_mime_type"] = "application/json"
            kw["response_json_schema"] = json_schema
        if low_thinking:
            kw["thinking_config"] = t.ThinkingConfig(thinking_level="low")
        return t.GenerateContentConfig(**kw)

    def _generate(self, model: str, contents: list, system: str, json_schema: Optional[dict], max_tokens: int) -> str:
        last: Exception | None = None
        # Not every model takes thinking_level or response_json_schema; retry with the plainer config.
        for low_thinking, use_schema in ((True, True), (False, True), (False, False)):
            try:
                cfg = self._config(system, json_schema if use_schema else None, max_tokens, low_thinking)
                if json_schema is not None and not use_schema:
                    contents = list(contents) + ["Reply with JSON only, matching this JSON schema:\n" + json.dumps(json_schema)]
                resp = self.client.models.generate_content(model=model, contents=contents, config=cfg)
                text = resp.text
                if not text:
                    raise ModelError("Gemini returned no text (blocked or empty).")
                return text
            except Exception as e:  # noqa: BLE001 - the SDK raises many types; the message says which
                last = e
                msg = str(e).lower()
                if any(w in msg for w in ("api key", "api_key", "permission", "401", "403", "quota", "429", "not found", "404")):
                    break  # retrying with a plainer config won't fix a key, quota or model-name problem
        raise ModelError(f"Gemini ({model}): {type(last).__name__}: {str(last)[:200]}")

    def understand(self, images: Sequence[Image], prompt: str, schema: dict, system: str = "") -> dict:
        parts = [self._types.Part.from_bytes(data=b, mime_type=m) for b, m in images]
        text = self._generate(self.model, parts + [prompt], system, schema, max_tokens=6000)
        return _json_from_text(text)

    def write(self, prompt: str, system: str = "", max_tokens: int = 700) -> str:
        return self._generate(self.model, [prompt], system, None, max_tokens).strip()

    def write_fast(self, prompt: str, system: str = "", max_tokens: int = 700) -> str:
        return self._generate(self.fast_model, [prompt], system, None, max_tokens).strip()


class OllamaProvider(Provider):
    """Local fallback. qwen3.5:4b reads images and writes Telugu, Hindi, Welsh-ish and European languages."""
    name = "local"

    def __init__(self, base_url: str, model: str, timeout: float = 150.0, load_timeout: float = 75.0):
        self.base_url, self.model, self.timeout, self.load_timeout = base_url.rstrip("/"), model, timeout, load_timeout

    def loaded(self) -> bool:
        """Is the model in memory right now? (Ollama /api/ps)"""
        try:
            with urllib.request.urlopen(self.base_url + "/api/ps", timeout=3) as r:
                return any(self.model in (m.get("name"), m.get("model")) for m in json.loads(r.read()).get("models", []))
        except Exception:
            return False

    def preload(self) -> None:
        """Load the model first (Ollama's warm-up: an empty prompt), with its own short deadline. On this Mac the
        hub keeps a 7B model pinned, and a second model often can't fit: then Ollama queues the load for minutes.
        Better to say so in about a minute than to leave someone holding a letter for five."""
        if self.loaded():
            return
        body = json.dumps({"model": self.model, "prompt": "", "keep_alive": "10m"}).encode()
        req = urllib.request.Request(self.base_url + "/api/generate", data=body, headers={"Content-Type": "application/json"})
        try:
            urllib.request.urlopen(req, timeout=self.load_timeout).read()
        except urllib.error.HTTPError as e:
            raise ModelError(f"Ollama couldn't load {self.model}: {e.code} {e.read()[:120].decode(errors='replace')}")
        except (urllib.error.URLError, OSError) as e:
            raise ModelError(f"the local model {self.model} didn't load within {int(self.load_timeout)} s "
                             f"({type(e).__name__}); usually there isn't enough free memory while another model is pinned")

    def _chat(self, messages: list, fmt: Any = None, max_tokens: int = 1500) -> str:
        self.preload()
        body = {"model": self.model, "stream": False, "think": False, "keep_alive": "10m",
                "options": {"temperature": 0.1, "num_predict": max_tokens}, "messages": messages}
        if fmt is not None:
            body["format"] = fmt
        req = urllib.request.Request(self.base_url + "/api/chat", data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return json.loads(r.read())["message"]["content"]
        except urllib.error.HTTPError as e:
            raise ModelError(f"Ollama said {e.code}: {e.read()[:200].decode(errors='replace')}")
        except (urllib.error.URLError, OSError, KeyError, ValueError) as e:
            raise ModelError(f"Ollama unreachable or odd reply: {type(e).__name__}")

    def understand(self, images: Sequence[Image], prompt: str, schema: dict, system: str = "") -> dict:
        msgs = ([{"role": "system", "content": system}] if system else []) + \
               [{"role": "user", "content": prompt, "images": [base64.b64encode(b).decode() for b, _ in images]}]
        return _json_from_text(self._chat(msgs, fmt=schema, max_tokens=4000))

    def write(self, prompt: str, system: str = "", max_tokens: int = 700) -> str:
        msgs = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
        return self._chat(msgs, max_tokens=max_tokens).strip()


class Chain(Provider):
    """Try each provider in turn. Which one answered is in .last_provider after every call."""
    name = "chain"

    def __init__(self, providers: List[Provider]):
        if not providers:
            raise ModelError("No model is available: set GEMINI_API_KEY (agents/set_gemini_key.sh) or run Ollama.")
        self.providers = providers
        self.last_provider = providers[0].name
        self.errors: list[str] = []

    def _try(self, fn: str, *args, **kw):
        errs = []
        for p in self.providers:
            try:
                out = getattr(p, fn)(*args, **kw)
                self.last_provider = p.name
                return out
            except ModelError as e:
                errs.append(f"{p.name}: {e}")
            except Exception as e:  # noqa: BLE001
                errs.append(f"{p.name}: {type(e).__name__}: {str(e)[:160]}")
        self.errors = errs
        raise ModelError(" | ".join(errs))

    def understand(self, images, prompt, schema, system=""):
        return self._try("understand", images, prompt, schema, system)

    def write(self, prompt, system="", max_tokens=700):
        return self._try("write", prompt, system, max_tokens)


def build(settings: Settings) -> Chain:
    """Gemini when a key is set (the agents' model), the local model behind it, or alone when there's no key."""
    providers: List[Provider] = []
    if settings.gemini_enabled:
        try:
            providers.append(GeminiProvider(settings.gemini_api_key, settings.model, settings.fast_model))
        except Exception as e:  # noqa: BLE001 - e.g. package missing
            print(f"gemini unavailable: {type(e).__name__}", flush=True)
    if settings.local_enabled:
        providers.append(OllamaProvider(settings.ollama_url, settings.local_model))
    return Chain(providers)


def ollama_ready(settings: Settings) -> bool:
    try:
        with urllib.request.urlopen(settings.ollama_url + "/api/tags", timeout=2) as r:
            names = [m.get("name") for m in json.loads(r.read()).get("models", [])]
        return settings.local_model in names or settings.local_model.split(":")[0] in [n.split(":")[0] for n in names]
    except Exception:
        return False
