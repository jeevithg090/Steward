"""No-logs hardening (S8.5): spans leave without content; server logs lose query strings."""

from __future__ import annotations

import logging

from opentelemetry.sdk.trace import Event, ReadableSpan

from tempo_adapters.telemetry import QueryRedactor, content_free


def test_spans_leave_without_prompts_completions_or_tool_data() -> None:
    span = ReadableSpan(
        name="chat tempo-private",
        attributes={
            "gen_ai.request.model": "tempo-private", "gen_ai.usage.input_tokens": 42,
            "gen_ai.input.messages": '[{"role":"user","content":"I am Margaret"}]',
            "gen_ai.output.messages": "Claim £14.20?", "gen_ai.system_instructions": "You are Tempo",
            "gen_ai.tool.call.arguments": '{"name":"Margaret"}', "gen_ai.tool.call.result": "ok",
            "gen_ai.prompt.0.content": "legacy content", "gen_ai.prompt.name": "persona",
        },
        events=[Event("gen_ai.user.message", {"content": "I am Margaret"}), Event("retry", {"n": 1})],
    )  # fmt: skip

    clean = content_free(span)

    assert dict(clean.attributes or {}) == {
        "gen_ai.request.model": "tempo-private", "gen_ai.usage.input_tokens": 42,
        "gen_ai.prompt.name": "persona",
    }  # fmt: skip
    assert [e.name for e in clean.events] == ["retry"]


def test_server_logs_drop_query_strings() -> None:
    record = logging.LogRecord(
        "uvicorn.error", logging.INFO, __file__, 1, '%s - "WebSocket %s" [accepted]',
        ("127.0.0.1:5000", "/events?token=demo-token"), None,
    )  # fmt: skip

    assert QueryRedactor().filter(record)
    assert record.getMessage() == '127.0.0.1:5000 - "WebSocket /events?…" [accepted]'
