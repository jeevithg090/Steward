"""Whether the model behind the jurors and small talk is really answering (plan.md §13.5).

Configured is not the same as answering: a Serverless GPU can be loading, or failing to start, and
a hosted model can be rate-limited. Every call through `RecordingClient` notes its outcome, and
`/health` says what the last call did, so the honesty badge never claims a model that isn't there.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any

from agent_framework import Message


class ModelStatus:
    def __init__(self) -> None:
        self.last_answer: datetime | None = None
        self.last_failure: datetime | None = None
        self.answers = 0
        self.failures = 0

    def answered(self) -> None:
        self.last_answer = datetime.now(UTC)
        self.answers += 1

    def failed(self) -> None:
        self.last_failure = datetime.now(UTC)
        self.failures += 1

    @property
    def answering(self) -> bool | None:
        """True if the last call answered, False if it failed, None before any call."""
        if self.last_answer is None and self.last_failure is None:
            return None
        if self.last_failure is None:
            return True
        return self.last_answer is not None and self.last_answer > self.last_failure

    def view(self) -> dict[str, Any]:
        return {
            "answering": self.answering,
            "answers": self.answers,
            "failures": self.failures,
            "last_answer_at": self.last_answer.isoformat() if self.last_answer else None,
            "last_failure_at": self.last_failure.isoformat() if self.last_failure else None,
        }


class RecordingClient:
    """A chat client that notes each call's outcome in a ModelStatus, and passes it on."""

    def __init__(self, inner: Any, status: ModelStatus) -> None:
        self._inner = inner
        self._status = status

    async def get_response(
        self, messages: Sequence[Message], *, options: Mapping[str, Any] | None = None
    ) -> Any:
        try:
            if options is None:
                response = await self._inner.get_response(messages)
            else:
                response = await self._inner.get_response(messages, options=options)
        except Exception:
            self._status.failed()
            raise
        self._status.answered()
        return response
