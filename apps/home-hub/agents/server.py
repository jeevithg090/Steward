"""Tempo's agents service: FastAPI on 127.0.0.1:8789, loopback only.

Phones never call this directly. They call voice/token_server.py at /voice/agents/<path> (through the ngrok
tunnel), which checks the phone key, then forwards here as /agents/<path>. So every route below also exists as
/voice/agents/... for the Kairos app and the tap-to-talk page.

    GET  /agents/health                       what's wired up (no secrets)
    GET  /agents                              the registered agents and their inputs
    POST /agents/document/interpret           {image|images | upload_id|upload_ids, language, dialect, reading_level,
                                              speak, wait} -> the job (status done|running|error, steps, result)
    POST /agents/uploads/{upload_id}/{part}   {data: <base64 slice>, total, mime}: a photo in slices under 64 KB,
                                              because the tunnel caps request bodies; then interpret with upload_id
    GET  /agents/jobs/{id}   GET /agents/jobs/latest
    POST /agents/document/{job_id}/ask        {question, speak} -> {answer, audio}
    POST /agents/{agent}/run                  generic: {inputs, wait} for any registered agent

No access log (bodies are photos of people's letters). Jobs expire after an hour; photos are never stored.
"""
from __future__ import annotations

import ipaddress
import re
import threading
import time
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from .core import config
from .core import llm as llm_mod
from .core.jobs import JobStore
from .core.memory import HubMemory
from .core import registry
from .core.speech import Speech
from .document_interpreter.agent import DocumentInterpreterAgent
from .document_interpreter import languages


class UploadStore:
    """Photos arrive in base64 slices (each request under the tunnel's 64 KB cap) and are joined here.
    Kept in memory for 10 minutes at most, deleted as soon as a job takes them. Never written to disk."""
    TTL = 600
    MAX_PARTS = 256
    MAX_CHARS = 16 * 1024 * 1024  # base64 characters per upload (~12 MB of photo)
    ID = re.compile(r"^[A-Za-z0-9_-]{8,48}$")

    def __init__(self):
        self.lock = threading.Lock()
        self.uploads: dict[str, dict] = {}

    def _prune(self) -> None:
        now = time.time()
        for k in [k for k, u in self.uploads.items() if now - u["created"] > self.TTL]:
            del self.uploads[k]

    def put(self, upload_id: str, part: int, total: int, data: str, mime: str) -> dict:
        if not self.ID.match(upload_id):
            raise HTTPException(400, "upload_id must be 8 to 48 letters, digits, - or _.")
        if not (1 <= total <= self.MAX_PARTS) or not (0 <= part < total):
            raise HTTPException(400, f"part must be 0..total-1 and total at most {self.MAX_PARTS}.")
        if not data or len(data) > 70_000:
            raise HTTPException(400, "Each slice must be 1 to 70000 base64 characters.")
        with self.lock:
            self._prune()
            u = self.uploads.setdefault(upload_id, {"parts": {}, "total": total, "mime": mime, "created": time.time(), "chars": 0})
            if u["total"] != total:
                raise HTTPException(409, "total changed between slices; start a new upload_id.")
            if part not in u["parts"]:
                u["chars"] += len(data)
                if u["chars"] > self.MAX_CHARS:
                    del self.uploads[upload_id]
                    raise HTTPException(413, "That photo is too big.")
                u["parts"][part] = data
            return {"upload_id": upload_id, "received": len(u["parts"]), "total": total, "complete": len(u["parts"]) == total}

    def take(self, upload_id: str) -> tuple[str, str]:
        with self.lock:
            u = self.uploads.pop(upload_id, None)
        if not u:
            raise HTTPException(404, "That upload isn't here (it may have expired after 10 minutes). Please send the photo again.")
        if len(u["parts"]) != u["total"]:
            raise HTTPException(409, f"Only {len(u['parts'])} of {u['total']} slices arrived. Please send the photo again.")
        return "".join(u["parts"][i] for i in range(u["total"])), u["mime"] or "image/jpeg"


class UploadIn(BaseModel):
    data: str
    total: int
    mime: str = "image/jpeg"


class InterpretIn(BaseModel):
    image: Optional[str] = None
    mime: str = "image/jpeg"
    images: Optional[list[dict[str, Any]]] = None
    upload_id: Optional[str] = None            # a photo sent in slices to /agents/uploads/{id}/{part}
    upload_ids: Optional[list[str]] = None     # several pages, in order
    language: str = "en-GB"
    dialect: str = ""
    reading_level: str = "simple"
    speak: bool = True
    wait: float = Field(default=55.0, ge=0, le=110)


class AskIn(BaseModel):
    question: str
    speak: bool = True


class RunIn(BaseModel):
    inputs: dict[str, Any] = Field(default_factory=dict)
    wait: float = Field(default=55.0, ge=0, le=110)


def create_app(settings: Optional[config.Settings] = None, models=None, speech=None, memory=None) -> FastAPI:
    settings = settings or config.load()
    models = models or llm_mod.build(settings)
    speech = speech or Speech(settings)
    memory = memory or HubMemory(settings.hub_url)
    jobs = JobStore()
    uploads = UploadStore()
    registry.REGISTRY.clear()
    registry.register(DocumentInterpreterAgent(models, speech, memory, settings.budget_seconds))

    app = FastAPI(title="Tempo agents", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings, app.state.models, app.state.speech, app.state.memory, app.state.jobs = settings, models, speech, memory, jobs

    def loopback_only(request: Request) -> None:
        host = request.client.host if request.client else ""
        try:
            if host == "testclient" or ipaddress.ip_address(host).is_loopback:
                return
        except ValueError:
            pass
        raise HTTPException(403, "The agents service only answers this computer.")

    @app.get("/agents/health", dependencies=[Depends(loopback_only)])
    def health():
        return {"ok": True, **settings.public(),
                "providers": [p.name for p in getattr(models, "providers", [])],
                "last_provider": getattr(models, "last_provider", None),
                "local_ready": llm_mod.ollama_ready(settings) if settings.local_enabled else False,
                "local_loaded": any(getattr(p, "loaded", lambda: False)() for p in getattr(models, "providers", []) if p.name == "local"),
                "voice": speech.available, "hub_memory": memory.ready(),
                "agents": sorted(registry.REGISTRY), "languages": languages.CHOICES}

    @app.get("/agents", dependencies=[Depends(loopback_only)])
    def list_agents():
        return {"agents": registry.all_agents(), "languages": languages.CHOICES}

    @app.post("/agents/uploads/{upload_id}/{part}", dependencies=[Depends(loopback_only)])
    def upload(upload_id: str, part: int, body: UploadIn):
        return uploads.put(upload_id, part, body.total, body.data, body.mime)

    @app.post("/agents/document/interpret", dependencies=[Depends(loopback_only)])
    def interpret(body: InterpretIn):
        agent = registry.get("document")
        inputs = body.model_dump(exclude={"wait", "upload_id", "upload_ids"})
        if body.upload_ids:
            inputs["images"] = [dict(zip(("b64", "mime"), uploads.take(u))) for u in body.upload_ids[:4]]
            inputs["image"] = None
        elif body.upload_id:
            inputs["image"], inputs["mime"] = uploads.take(body.upload_id)
        try:
            DocumentInterpreterAgent.decode_images(inputs)  # fail fast with a clear 400, before a thread starts
        except ValueError as e:
            raise HTTPException(400, str(e))
        job = jobs.start(agent, inputs, wait=body.wait, context={"speak": body.speak})
        return job.view()

    @app.get("/agents/jobs/latest", dependencies=[Depends(loopback_only)])
    def latest():
        return jobs.latest_view()

    @app.get("/agents/jobs/{job_id}", dependencies=[Depends(loopback_only)])
    def job(job_id: str):
        j = jobs.get(job_id)
        if not j:
            raise HTTPException(404, "That job isn't here any more.")
        return j.view()

    @app.post("/agents/document/{job_id}/ask", dependencies=[Depends(loopback_only)])
    def ask(job_id: str, body: AskIn):
        j = jobs.get(job_id)
        if j is not None:
            j.context["speak"] = body.speak
        try:
            return jobs.follow_up(job_id, registry.get("document"), body.question)
        except KeyError as e:
            raise HTTPException(404, str(e).strip("'"))
        except ValueError as e:
            raise HTTPException(409, str(e))
        except RuntimeError as e:
            raise HTTPException(502, str(e))

    @app.post("/agents/{agent_name}/run", dependencies=[Depends(loopback_only)])
    def run_any(agent_name: str, body: RunIn):
        try:
            agent = registry.get(agent_name)
        except KeyError as e:
            raise HTTPException(404, str(e))
        return jobs.start(agent, body.inputs, wait=body.wait).view()

    return app


app = create_app()
