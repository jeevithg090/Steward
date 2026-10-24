"""Loading rule packs from skill folders and finding the one that covers a case.

Adding an operator means adding one YAML file under `skills/<skill>/rules/`.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any

import yaml
from pydantic import TypeAdapter

from tempo_core.errors import NotCovered
from tempo_core.rules.engine import AnyPack
from tempo_core.rules.schema import DelayRepayPack, RulePack

_PACK = TypeAdapter[AnyPack](RulePack)


def parse_pack(data: Any) -> AnyPack:
    """Validate one pack (already parsed from YAML); raises pydantic.ValidationError."""
    return _PACK.validate_python(data)


class RulePackRegistry:
    def __init__(self, packs: Iterable[AnyPack]) -> None:
        self._by_id: dict[str, AnyPack] = {}
        for pack in packs:
            if pack.id in self._by_id:
                raise ValueError(f"duplicate rule pack id {pack.id!r}")
            self._by_id[pack.id] = pack

    @classmethod
    def from_directory(cls, skills_root: Path) -> RulePackRegistry:
        """Load every `**/rules/*.yaml` under the skills folder."""
        paths = sorted(skills_root.glob("**/rules/*.yaml"))
        return cls(parse_pack(yaml.safe_load(p.read_text(encoding="utf-8"))) for p in paths)

    def by_id(self, pack_id: str) -> AnyPack:
        try:
            return self._by_id[pack_id]
        except KeyError:
            raise NotCovered(f"no rule pack {pack_id!r} is installed") from None

    def delay_repay(self, operator: str) -> DelayRepayPack:
        wanted = operator.casefold()
        for pack in self._by_id.values():
            if isinstance(pack, DelayRepayPack) and pack.operator.casefold() == wanted:
                return pack
        raise NotCovered(f"no Delay Repay pack covers {operator!r} yet")

    def __iter__(self) -> Iterator[AnyPack]:
        return iter(self._by_id.values())

    def __len__(self) -> int:
        return len(self._by_id)
