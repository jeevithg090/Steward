"""Tracing to Langfuse over OpenTelemetry, and structured logs that can't leak personal data.

- Every span carries `tempo.mission_id` (MissionIdSpanProcessor reads it from the context).
- Microsoft Agent Framework emits workflow, executor and model spans into the same trace; prompt
  content is off unless ENABLE_SENSITIVE_DATA is set, and we never set it.
- Logs are JSON with the trace id, and only allowlisted keys survive: anything else (a phone
  number someone passed by mistake) is dropped before it's written.
"""

from __future__ import annotations

import base64
import logging
import sys
from collections.abc import Iterator, MutableMapping
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, TextIO

import structlog
from opentelemetry import context as otel_context
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import ReadableSpan, Span, SpanProcessor, TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, SimpleSpanProcessor, SpanExporter

from tempo_adapters.settings import Settings

MISSION_ATTRIBUTE = "tempo.mission_id"
CURRENT_MISSION: ContextVar[str | None] = ContextVar("tempo_mission_id", default=None)
LOG_KEYS = frozenset(
    {
        "event", "level", "timestamp", "logger", "mission_id", "state", "latency_ms", "trace_id",
        "span_id", "error_code", "source", "missions", "point", "tool", "decision", "reason",
    }
)  # fmt: skip


@contextmanager
def mission_context(mission_id: str) -> Iterator[None]:
    token = CURRENT_MISSION.set(mission_id)
    try:
        yield
    finally:
        CURRENT_MISSION.reset(token)


class MissionIdSpanProcessor(SpanProcessor):
    def on_start(self, span: Span, parent_context: otel_context.Context | None = None) -> None:
        mission_id = CURRENT_MISSION.get()
        if mission_id is not None:
            span.set_attribute(MISSION_ATTRIBUTE, mission_id)

    def on_end(self, span: ReadableSpan) -> None:
        return None


def langfuse_otlp(settings: Settings) -> tuple[str, dict[str, str]] | None:
    """(check) Langfuse ingests OTLP/HTTP at /api/public/otel with basic auth (public:secret)."""
    if settings.langfuse_public_key is None or settings.langfuse_secret_key is None:
        return None
    pair = f"{settings.langfuse_public_key}:{settings.langfuse_secret_key.get_secret_value()}"
    endpoint = f"{settings.langfuse_host.rstrip('/')}/api/public/otel/v1/traces"
    return endpoint, {"Authorization": "Basic " + base64.b64encode(pair.encode()).decode()}


def langfuse_exporter(settings: Settings) -> OTLPSpanExporter | None:
    target = langfuse_otlp(settings)
    if target is None:
        return None
    endpoint, headers = target
    return OTLPSpanExporter(endpoint=endpoint, headers=headers, timeout=10)


def configure_tracing(
    settings: Settings, *, exporter: SpanExporter | None = None
) -> TracerProvider:
    """Install (or extend) the global tracer provider. `exporter` is for tests."""
    current = trace.get_tracer_provider()
    if isinstance(current, TracerProvider):
        provider = current
    else:
        provider = TracerProvider(resource=Resource.create({"service.name": "tempo"}))
        trace.set_tracer_provider(provider)
    provider.add_span_processor(MissionIdSpanProcessor())
    if exporter is not None:
        provider.add_span_processor(SimpleSpanProcessor(exporter))
    elif (langfuse := langfuse_exporter(settings)) is not None:
        provider.add_span_processor(BatchSpanProcessor(langfuse))
    return provider


def trace_url(settings: Settings, trace_id: str | None) -> str | None:
    """(check) A link Langfuse resolves to the trace, for Mission Control."""
    if trace_id is None or settings.langfuse_public_key is None:
        return None
    return f"{settings.langfuse_host.rstrip('/')}/trace/{trace_id}"


def current_trace_id() -> str | None:
    context = trace.get_current_span().get_span_context()
    return format(context.trace_id, "032x") if context.is_valid else None


def _add_trace_ids(_: Any, __: str, event: MutableMapping[str, Any]) -> MutableMapping[str, Any]:
    context = trace.get_current_span().get_span_context()
    if context.is_valid:
        event["trace_id"] = format(context.trace_id, "032x")
        event["span_id"] = format(context.span_id, "016x")
    if (mission_id := CURRENT_MISSION.get()) is not None:
        event.setdefault("mission_id", mission_id)
    return event


def _allowlist(_: Any, __: str, event: MutableMapping[str, Any]) -> MutableMapping[str, Any]:
    for key in [k for k in event if k not in LOG_KEYS]:
        del event[key]
    return event


def configure_logging(stream: TextIO = sys.stdout) -> None:
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            _add_trace_ids,
            _allowlist,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        logger_factory=structlog.PrintLoggerFactory(file=stream),
        cache_logger_on_first_use=False,
    )
