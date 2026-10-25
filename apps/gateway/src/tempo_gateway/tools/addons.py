"""Add-on tools (plan.md §17): any MCP server listed in `addons/tools.yaml` lends its tools to the
brain. Adding a tool is one entry there, not code.

Each add-on runs as its own process over stdio:
- It starts when the Gateway starts, in the background.
- It is pinned to a version.
- It gets a stripped environment: PATH and HOME plus its own settings, never the Gateway's keys.

Only the tools an entry lists are offered to the model, renamed `<id>_<tool>` so two add-ons can't
collide. A call has a time limit, and its text comes back as data, capped. An add-on that fails to
start is left out, and the other tools carry on.
"""

from __future__ import annotations

import asyncio
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import structlog
import yaml
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from .base import Source

log = structlog.get_logger(__name__)

START_TIMEOUT_S = 45.0  # a first start downloads the package (uvx caches it after)
CALL_TIMEOUT_S = 20.0
MAX_TEXT = 6000
_RESULT = re.compile(r"^\s*\d+\.\s+(?P<title>.+?)\n\s+URL:\s+(?P<url>https?://\S+)", re.MULTILINE)
_URL = re.compile(r"https?://[^\s\"'<>)\]]+")


@dataclass(frozen=True)
class AddonSpec:
    id: str
    name: str
    command: str
    args: tuple[str, ...]
    provider: str
    tools: dict[str, dict[str, str]]  # the server's tool name -> optional description and label
    env: dict[str, str] = field(default_factory=dict)
    repo: str = ""
    license: str = ""


def load_specs(path: Path) -> list[AddonSpec]:
    """The add-ons file; a missing file means no add-ons."""
    if not path.exists():
        return []
    raw = yaml.safe_load(path.read_text()) or {}
    specs = []
    for entry in raw.get("addons", []):
        tools = {name: dict(extra or {}) for name, extra in (entry.get("tools") or {}).items()}
        specs.append(
            AddonSpec(
                id=str(entry["id"]),
                name=str(entry.get("name", entry["id"])),
                command=str(entry["command"]),
                args=tuple(str(a) for a in entry.get("args", [])),
                provider=str(entry.get("provider", entry["id"])),
                tools=tools,
                env={k: str(v) for k, v in (entry.get("env") or {}).items()},
                repo=str(entry.get("repo", "")),
                license=str(entry.get("license", "")),
            )
        )
    return specs


@dataclass(frozen=True)
class AddonTool:
    name: str  # what the model calls: <id>_<tool>
    spec: AddonSpec
    tool: str  # the server's own name
    description: str
    parameters: dict[str, Any]
    label: str

    def schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


class _Server:
    """One add-on process. A task owns the stdio session for its whole life (the MCP client must be
    opened and closed in the same task); calls use the session from any task."""

    def __init__(self, spec: AddonSpec) -> None:
        self.spec = spec
        self.session: ClientSession | None = None
        self.tools: list[Any] = []
        self._ready = asyncio.Event()
        self._stop = asyncio.Event()
        self._task: asyncio.Task[None] | None = None
        self._devnull = open(os.devnull, "w")  # noqa: SIM115 (lives as long as the server)

    async def _own(self) -> None:
        env = {
            "PATH": os.environ.get("PATH", ""),
            "HOME": os.environ.get("HOME", ""),
            **self.spec.env,
        }
        params = StdioServerParameters(
            command=self.spec.command, args=list(self.spec.args), env=env
        )
        try:
            async with (
                stdio_client(params, errlog=self._devnull) as (read, write),
                ClientSession(read, write) as session,
            ):
                await session.initialize()
                self.tools = list((await session.list_tools()).tools)
                self.session = session
                self._ready.set()
                await self._stop.wait()
        except Exception as exc:  # an add-on that fails is left out, never the Gateway
            log.warning("addon_failed", addon=self.spec.id, error_code=type(exc).__name__)
        finally:
            self.session = None
            self._ready.set()

    async def start(self) -> None:
        if self._task is None or self._task.done():
            self._ready, self._stop = asyncio.Event(), asyncio.Event()
            self._task = asyncio.create_task(self._own())
        try:
            await asyncio.wait_for(self._ready.wait(), START_TIMEOUT_S)
        except TimeoutError:
            log.warning("addon_slow_to_start", addon=self.spec.id)

    async def call(self, tool: str, args: dict[str, Any]) -> Any:
        if self.session is None:
            await self.start()
        if self.session is None:
            raise RuntimeError(f"the {self.spec.name} add-on isn't running")
        return await asyncio.wait_for(self.session.call_tool(tool, args), CALL_TIMEOUT_S)

    async def close(self) -> None:
        self._stop.set()
        if self._task is not None:
            try:
                await asyncio.wait_for(self._task, 5)
            except (TimeoutError, asyncio.CancelledError):
                self._task.cancel()
        self._devnull.close()


class AddonHub:
    """All add-ons: starts them, offers their allowlisted tools, and runs a call."""

    def __init__(self, specs: list[AddonSpec]) -> None:
        self._servers = {spec.id: _Server(spec) for spec in specs}
        self._tools: dict[str, AddonTool] = {}

    async def warm(self) -> None:
        """Start every add-on at once and learn its tools; the slow or broken are skipped."""
        await asyncio.gather(
            *(server.start() for server in self._servers.values()), return_exceptions=True
        )
        tools: dict[str, AddonTool] = {}
        for server in self._servers.values():
            offered = {t.name: t for t in server.tools}
            for name, extra in server.spec.tools.items():
                if name not in offered:
                    continue  # listed but not served: left out
                tool = offered[name]
                schema = (
                    getattr(tool, "input_schema", None) or getattr(tool, "inputSchema", None) or {}
                )
                tools[f"{server.spec.id}_{name}"] = AddonTool(
                    name=f"{server.spec.id}_{name}",
                    spec=server.spec,
                    tool=name,
                    description=extra.get("description")
                    or (tool.description or name).strip().split("\n")[0][:300],
                    parameters=dict(schema) or {"type": "object", "properties": {}},
                    label=extra.get("label") or f"Asked {server.spec.name}",
                )
        self._tools = tools
        log.info(
            "addons_ready", tools=len(tools), addons=sorted({t.spec.id for t in tools.values()})
        )

    @property
    def names(self) -> frozenset[str]:
        return frozenset(self._tools)

    @property
    def providers(self) -> list[str]:
        return sorted({t.spec.provider for t in self._tools.values()})

    def schemas(self) -> list[dict[str, Any]]:
        return [tool.schema() for tool in self._tools.values()]

    def label(self, name: str, args: dict[str, str]) -> str:
        tool = self._tools[name]
        try:
            return tool.label.format(**args)
        except (KeyError, IndexError, ValueError):
            return tool.label

    async def run(self, name: str, args: dict[str, Any]) -> tuple[dict[str, Any], list[Source]]:
        tool = self._tools[name]
        result = await self._servers[tool.spec.id].call(tool.tool, args)
        words = "\n".join(c.text for c in result.content if getattr(c, "text", None))[:MAX_TEXT]
        if getattr(result, "is_error", None) or getattr(result, "isError", None):
            return {"provider": tool.spec.provider, "error": words[:400]}, []
        sources = [Source(m["title"].strip()[:120], m["url"]) for m in _RESULT.finditer(words)]
        if not sources:
            sources = [Source(url.split("/")[2], url) for url in dict.fromkeys(_URL.findall(words))]
        return {"provider": tool.spec.provider, "result": words}, sources[:4]

    async def close(self) -> None:
        await asyncio.gather(
            *(server.close() for server in self._servers.values()), return_exceptions=True
        )
