"""Jobs: one run of one agent, with live steps the phone can show while it works.

The shape matches voice/token_server.py's phone tasks (id, status, steps, answer) so the app and the page can
treat "agents working" the same way. Photos are never kept on a job: only what the agent extracted, so a
follow-up question can be answered. Jobs expire after an hour.
"""
from __future__ import annotations

import secrets
import threading
import time
from typing import Any, Callable, Dict, Optional

from .registry import Agent

KEEP_SECONDS = 3600
MAX_JOBS = 60


class Job:
    def __init__(self, agent: Agent, inputs: dict):
        self.id = secrets.token_hex(4)
        self.agent = agent.name
        self.status = "queued"          # queued | running | done | error
        self.steps: list[str] = []
        self.result: Optional[dict] = None
        self.error: Optional[str] = None
        self.started = time.time()
        self.finished: Optional[float] = None
        self.context: Dict[str, Any] = {}   # what the agent keeps for follow-ups (no images)
        self._inputs = inputs               # dropped as soon as the run ends
        self.lock = threading.Lock()

    def step(self, text: str) -> None:
        with self.lock:
            self.steps.append(text)

    def view(self) -> dict:
        return {"id": self.id, "agent": self.agent, "status": self.status, "steps": list(self.steps),
                "result": self.result, "error": self.error, "started": self.started, "finished": self.finished,
                "seconds": round((self.finished or time.time()) - self.started, 1)}


class JobStore:
    def __init__(self):
        self.lock = threading.Lock()
        self.jobs: Dict[str, Job] = {}
        self.latest: Optional[str] = None

    def _prune(self) -> None:
        now = time.time()
        old = [k for k, j in self.jobs.items() if j.finished and now - j.finished > KEEP_SECONDS]
        for k in old:
            del self.jobs[k]
        while len(self.jobs) > MAX_JOBS:
            oldest = min(self.jobs.values(), key=lambda j: j.started)
            del self.jobs[oldest.id]

    def start(self, agent: Agent, inputs: dict, wait: float = 0.0, context: Optional[dict] = None,
              on_done: Optional[Callable[[Job], None]] = None) -> Job:
        job = Job(agent, inputs)
        job.context.update(context or {})
        with self.lock:
            self._prune()
            self.jobs[job.id] = job
            self.latest = job.id

        def run():
            job.status = "running"
            try:
                job.result = agent.run(job._inputs, job.step, job.context)
                job.status = "done"
            except Exception as e:  # noqa: BLE001 - a failed job must never kill the service
                job.error = f"{type(e).__name__}: {str(e)[:300]}"
                job.status = "error"
                job.step("Something went wrong: " + job.error)
            finally:
                job._inputs = {}  # the photo is gone now
                job.finished = time.time()
                if on_done:
                    try:
                        on_done(job)
                    except Exception:  # noqa: BLE001
                        pass

        threading.Thread(target=run, daemon=True, name=f"job-{job.id}").start()
        deadline = time.time() + max(0.0, min(wait, 110.0))
        while time.time() < deadline and job.status in ("queued", "running"):
            time.sleep(0.2)
        return job

    def get(self, job_id: str) -> Optional[Job]:
        return self.jobs.get(job_id)

    def latest_view(self) -> dict:
        j = self.jobs.get(self.latest or "")
        return j.view() if j else {"status": "none"}

    def follow_up(self, job_id: str, agent: Agent, question: str) -> dict:
        job = self.jobs.get(job_id)
        if not job:
            raise KeyError("That letter isn't here any more. Please take the photo again.")
        if job.status != "done":
            raise ValueError("I'm still reading that one. Ask again in a moment.")
        steps: list[str] = []
        return agent.follow_up(question, job.context, steps.append)
