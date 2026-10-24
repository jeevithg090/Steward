"""Check every skill folder and profile the way CI and the Gateway do, and show what loaded.

Usage: uv run python scripts/validate_skills.py [--root PATH]

Rule packs, manifests and profiles go through the same code `main.build()` runs at start-up, so
a green run here means the Gateway will start. Any problem prints one plain reason and exits 1.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

import yaml
from pydantic import ValidationError

from tempo_core.errors import TempoError
from tempo_core.profiles import ProfileCatalog
from tempo_core.rules import RulePackRegistry, parse_pack
from tempo_core.rules.registry import GENERATED
from tempo_core.skills import SkillInvalid, SkillManifest, load_manifests, plain_reasons

REPO = Path(__file__).resolve().parents[1]


def load_packs(skills_root: Path) -> RulePackRegistry:
    """Like RulePackRegistry.from_directory, but a bad pack is reported with its file name."""
    packs = []
    for path in sorted(skills_root.glob("**/rules/*.yaml")):
        if GENERATED in path.relative_to(skills_root).parts:
            continue
        try:
            packs.append(parse_pack(yaml.safe_load(path.read_text(encoding="utf-8"))))
        except ValidationError as exc:
            raise SkillInvalid(f"{path}: {plain_reasons(exc)}") from exc
        except yaml.YAMLError as exc:
            raise SkillInvalid(f"{path}: not valid YAML ({' '.join(str(exc).split())})") from exc
    return RulePackRegistry(packs)


def table(headers: Sequence[str], rows: Sequence[Sequence[str]]) -> str:
    widths = [max(len(cell) for cell in column) for column in zip(headers, *rows, strict=True)]

    def line(cells: Sequence[str]) -> str:
        return "  ".join(c.ljust(w) for c, w in zip(cells, widths, strict=True)).rstrip()

    return "\n".join([line(headers), line(["-" * w for w in widths]), *(line(r) for r in rows)])


def skills_table(skills_root: Path, manifests: dict[str, SkillManifest]) -> str:
    rows = [
        [
            m.id,
            m.status,
            ", ".join(sorted(p.id for p in load_packs(skills_root / m.id))) or "-",
            ", ".join(m.needs) or "-",
        ]
        for m in manifests.values()
    ]
    return table(["skill", "status", "rule packs", "needs"], rows)


def profiles_table(catalog: ProfileCatalog) -> str:
    rows = [[p.id, ", ".join(p.skills), ", ".join(p.may) or "-"] for p in catalog.profiles]
    return table(["profile", "skills", "may"], rows)


def validate(root: Path) -> tuple[dict[str, SkillManifest], ProfileCatalog, int]:
    skills_root = root / "skills"
    registry = load_packs(skills_root)
    manifests = load_manifests(skills_root)
    catalog = ProfileCatalog.load(root / "profiles", skills_root)
    return manifests, catalog, len(registry)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    parser.add_argument(
        "--root", type=Path, default=REPO, help="the checkout that holds skills/ and profiles/"
    )
    args = parser.parse_args(argv)
    try:
        manifests, catalog, packs = validate(args.root)
    except (TempoError, ValueError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(skills_table(args.root / "skills", manifests))
    print()
    print(profiles_table(catalog))
    print(f"\n{len(manifests)} skills, {packs} rule packs, {len(catalog.profiles)} profiles: valid")
    return 0


if __name__ == "__main__":
    sys.exit(main())
