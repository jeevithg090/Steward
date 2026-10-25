"""The Visual Document & Letter Interpreter.

    photo(s) of a letter, bill or form
      -> understand   the model reads it into facts (schema.py), in English
      -> assess       scam/safety signals (safety.py), never the model's word alone
      -> explain      what a kind neighbour would say, in the person's language and dialect (prompts.py)
      -> speak        Gemini TTS, or the phone's own voice when there's no key (speech.py)
      -> remember     the hub keeps the summary and each deadline as events (memory.py)
      -> follow-up    "what if I can't pay?" answered from the same facts, later

Every stage reports a short step so the phone can show progress. The photo is never stored.
"""
from __future__ import annotations

import base64
import time
from typing import Optional

from ..core.llm import Chain, ModelError, prepare_image
from ..core.memory import HubMemory
from ..core.registry import Agent, StepFn
from ..core.speech import Speech
from . import languages, prompts, safety, schema

MAX_IMAGES = 4
MAX_IMAGE_BYTES = 8 * 1024 * 1024


class DocumentInterpreterAgent(Agent):
    name = "document"
    title = "Letter reader"
    description = ("Take a photo of a letter, bill or form. Kairos says in plain words, in your own language, what "
                   "it is, what it means, whether you owe money and what to do by when.")
    input_schema = {
        "type": "object",
        "properties": {
            "image": {"type": "string", "description": "base64 JPEG/PNG of the document (or use images)"},
            "mime": {"type": "string", "default": "image/jpeg"},
            "images": {"type": "array", "items": {"type": "object", "properties": {"b64": {"type": "string"}, "mime": {"type": "string"}}},
                       "description": "several pages, in order, max 4"},
            "language": {"type": "string", "default": "en-GB", "description": "BCP-47 code the person wants to hear"},
            "dialect": {"type": "string", "default": "", "description": "free text, e.g. 'Telangana', 'Yorkshire', 'Sylheti', 'North Wales'"},
            "reading_level": {"type": "string", "enum": ["simple", "detailed"], "default": "simple"},
            "speak": {"type": "boolean", "default": True, "description": "return audio when a voice is available"},
        },
        "required": ["image"],
    }

    def __init__(self, models: Chain, speech: Speech, memory: HubMemory, budget_seconds: float = 90.0):
        self.models, self.speech, self.memory, self.budget = models, speech, memory, budget_seconds

    # -- inputs --------------------------------------------------------------------------------------------
    @staticmethod
    def decode_images(inputs: dict) -> list:
        raw = []
        if inputs.get("images"):
            for im in inputs["images"][:MAX_IMAGES]:
                if isinstance(im, dict) and im.get("b64"):
                    raw.append((im["b64"], im.get("mime") or "image/jpeg"))
        elif inputs.get("image"):
            raw.append((inputs["image"], inputs.get("mime") or "image/jpeg"))
        if not raw:
            raise ValueError("Send a photo of the document (image or images).")
        out = []
        for b64, mime in raw:
            if "," in b64 and b64.lstrip().startswith("data:"):
                b64 = b64.split(",", 1)[1]  # a data: URL from a web page
            try:
                data = base64.b64decode(b64, validate=False)
            except Exception:
                raise ValueError("The photo wasn't valid base64.")
            if not data or len(data) > MAX_IMAGE_BYTES:
                raise ValueError("Each photo must be between 1 byte and 8 MB.")
            out.append(prepare_image(data, mime))
        return out

    # -- the pipeline ---------------------------------------------------------------------------------------
    def run(self, inputs: dict, on_step: StepFn, context: dict) -> dict:
        t0 = time.time()
        images = self.decode_images(inputs)
        lang = languages.info(inputs.get("language") or "en-GB")
        dialect = " ".join(str(inputs.get("dialect") or "").split())[:80]
        level = "detailed" if inputs.get("reading_level") == "detailed" else "simple"
        speak = inputs.get("speak", True) is not False

        on_step("Looking at the photo" + (f"s ({len(images)} pages)" if len(images) > 1 else ""))
        try:
            raw = self.models.understand(images, prompts.UNDERSTAND_PROMPT, schema.SCHEMA, prompts.UNDERSTAND_SYSTEM)
        except ModelError as e:
            raise RuntimeError(f"Couldn't read the photo: {e}")
        facts = schema.normalise(raw)
        provider_read = self.models.last_provider
        who = facts["sender"]["name"] or "someone"
        kind = facts["document_type"].replace("_", " ")
        on_step(f"It's a {kind} from {who}" if facts["readable"] else "The photo is hard to read")

        on_step("Checking for anything suspicious")
        risk = safety.assess(facts)
        if risk["level"] in ("medium", "high"):
            on_step(f"Warning: this could be a scam ({risk['level']} risk)")

        on_step(f"Putting it into plain {lang['name']}" + (f" ({dialect})" if dialect else ""))
        try:
            explanation = self.models.write(prompts.explain_prompt(facts, lang, dialect, level, risk), prompts.EXPLAIN_SYSTEM,
                                            max_tokens=900 if level == "detailed" else 600)
        except ModelError as e:
            raise RuntimeError(f"Couldn't write the explanation: {e}")
        explanation = safety.spoken_safe(explanation) or facts["summary_plain"]

        audio: Optional[dict] = None
        if speak and time.time() - t0 < self.budget:
            on_step("Getting the voice ready")
            audio = self.speech.synthesize(explanation, lang["speech"])
            if audio is None:
                on_step("Your phone will read it out")

        on_step("Remembering what it said")
        mem = self.memory.remember(facts, explanation, lang["code"])

        context.update({"facts": facts, "language": lang, "dialect": dialect, "explanation": explanation,
                        "reading_level": level, "risk": risk})
        on_step("Done")
        return {
            "document": schema.public(facts),
            "explanation": {"text": explanation, "language": lang["code"], "language_name": lang["name"],
                            "dialect": dialect, "speech_lang": lang["speech"], "reading_level": level},
            "audio": audio,
            "safety": risk,
            "memory": mem,
            "provider": {"read": provider_read, "wrote": self.models.last_provider, "voice": audio["provider"] if audio else "device"},
            "seconds": round(time.time() - t0, 1),
        }

    # -- later questions -------------------------------------------------------------------------------------
    def follow_up(self, question: str, context: dict, on_step: StepFn) -> dict:
        question = " ".join(str(question or "").split())[:500]
        if not question:
            raise ValueError("Ask a question about the letter.")
        if not context.get("facts"):
            raise ValueError("There's no letter to ask about yet.")
        on_step("Looking back at the letter")
        try:
            answer = self.models.write(prompts.followup_prompt(context, question), prompts.FOLLOWUP_SYSTEM, max_tokens=400)
        except ModelError as e:
            raise RuntimeError(f"Couldn't answer: {e}")
        answer = safety.spoken_safe(answer)
        lang = context.get("language") or languages.info("en-GB")
        audio = self.speech.synthesize(answer, lang.get("speech")) if context.get("speak", True) else None
        return {"answer": answer, "audio": audio, "language": lang.get("code"), "speech_lang": lang.get("speech"),
                "provider": self.models.last_provider}
