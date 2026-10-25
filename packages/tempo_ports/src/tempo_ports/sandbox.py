"""The link sandbox port (docs/scam-shield.md §3, tier 3): one isolated look behind a link.

The Gateway, never the phone, asks "where does this link really go, and what is on the page?",
and gets back a `SandboxReport` the domain core can judge. Live and Replay implementations live
in tempo_adapters.scam.sandbox.
"""

from __future__ import annotations

from typing import Protocol

from tempo_core.scam import SandboxReport


class LinkSandbox(Protocol):
    async def inspect(self, host: str, *, url: str | None = None) -> SandboxReport:
        """Follow the link from `host` (or the exact `url`), read the landing page without running
        anything on it, and report what was found. Never raises: trouble is a finding."""
        ...
