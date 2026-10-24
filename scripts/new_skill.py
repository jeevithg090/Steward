"""Scaffold a skill: a manifest a newcomer can fill in and, if asked, a rule pack template.

Usage:
  uv run python scripts/new_skill.py --id water-refund --name "Water supply refunds" \\
      [--needs claim,accept_cash] [--rules fixed_amount|delay_repay|none] [--root PATH]

What it writes already passes scripts/validate_skills.py, so the first `make check` is green and
every TODO is a word or a number for a person to check, never a schema to learn. Nothing is ever
overwritten: an existing skill folder stops the script.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Sequence
from pathlib import Path

import yaml

from tempo_core.capabilities import CAPABILITIES
from tempo_core.rules import parse_pack
from tempo_core.skills import ID_PATTERN, load_manifest

REPO = Path(__file__).resolve().parents[1]
RULES = ("fixed_amount", "delay_repay", "none")
TODO_SUMMARY = (
    "TODO: say what Tempo does for a person when this skill is on. Use one or two short sentences."
)
DR15_BANDS = (
    (0, 14, "0"),
    (15, 29, "25"),
    (30, 59, "50"),
    (60, 119, "100"),
    (120, None, "100"),
)


def row(field: str, check: str) -> str:
    """One YAML line with its `# (check)` note aligned, so the file reads as a checklist."""
    return f"{field.ljust(40)} # (check) {check}"


def manifest(skill_id: str, name: str, needs: Sequence[str]) -> str:
    lines = [
        f"# {name}: a skill manifest (SHIPPING.md §4.2). Plain words for people; `needs` binds",
        "# profiles: a profile that turns this skill on must allow every capability listed there.",
        "# Fill in every TODO and (check), then run: uv run python scripts/validate_skills.py",
        f"id: {skill_id}",
        row(f"name: {json.dumps(name)}", "as a person would say it"),
        'version: "0.1.0"',
        row("status: experimental", "ready | demo-values | experimental"),
        row("summary: >-", "one or two plain sentences; Flesch 60 or more"),
        f"  {TODO_SUMMARY}",
        row("jobs:", "1 to 6 plain sentences: what Tempo does when it is on"),
        '  - "TODO: one plain sentence for each thing Tempo does when this skill is on"',
        row(f"needs: [{', '.join(needs)}]", "capabilities its binding tools need; may be empty"),
        row("channels: [web, sms, voice]", "any of web, sms, voice"),
        row("# mission: TODO", "optional: the mission that runs it"),
        row("# operators: [TODO]", "optional: who this covers"),
        row("# docs: docs/TODO.md", "optional: a path here or an https URL"),
        row("maintainers: [TODO]", "your handle, or a team name"),
    ]
    return "\n".join(lines) + "\n"


def pack(kind: str, skill_id: str, name: str) -> str:
    head = [
        f"# {name}: every number here is a placeholder until a person checks it against the",
        "# published terms; then set demo_values to false and add last_verified: YYYY-MM-DD.",
        f"kind: {kind}",
        row(f"id: {skill_id}.{kind.replace('_', '-')}", "unique across every rule pack"),
        'version: "0.1.0"',
        row("operator: TODO", "the company or scheme owner, as people name it"),
    ]
    if kind == "fixed_amount":
        body = [
            row("scheme: TODO", "the published scheme this pack encodes"),
            row("citation_url: https://example.org/TODO", "where the numbers come from; https"),
            row('amount_gbp: "1.00"', "a quoted string, never a bare number"),
            row("min_notice_hours: 24", "less notice than this counts as missed"),
            row("claim_window_days: 30", "days from the event to claim"),
        ]
    else:
        body = [
            row("scheme: DR15", "DR15 or DR30"),
            row("toc_codes: []", "how rail data names the operator, e.g. [GW]"),
            row("citation_url: https://example.org/TODO", "the Delay Repay page; https"),
            row("claim_window_days: 28", "days after the journey to claim"),
            row("bands:", "start at 0, no gaps, last open-ended, never pay less later"),
            *(
                f"  - {{ min_minutes: {lo}, max_minutes: {'null' if hi is None else hi}, "
                f'refund_pct: "{pct}" }}'
                for lo, hi, pct in DR15_BANDS
            ),
        ]
    tail = ["demo_values: true   # stays true until every value above has been checked"]
    return "\n".join(head + body + tail) + "\n"


def parse(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    parser.add_argument("--id", required=True, help="[a-z0-9-]{2,40}; also the folder name")
    parser.add_argument("--name", required=True, help="as a person would say it")
    parser.add_argument("--needs", default="", help="comma-separated capabilities, e.g. claim")
    parser.add_argument("--rules", choices=RULES, default="none", help="a rule pack template")
    parser.add_argument("--root", type=Path, default=REPO, help="the checkout to write into")
    return parser.parse_args(argv)


def self_check(manifest_path: Path, pack_path: Path | None) -> None:
    """The template must load with the real schemas, or the newcomer inherits our bug."""
    load_manifest(manifest_path)
    if pack_path is not None:
        parse_pack(yaml.safe_load(pack_path.read_text(encoding="utf-8")))


def main(argv: Sequence[str] | None = None) -> int:
    args = parse(argv)
    needs = [word.strip() for word in args.needs.split(",") if word.strip()]
    if not re.fullmatch(ID_PATTERN, args.id):
        print(f"error: --id must match {ID_PATTERN} (lower case, digits, dashes)", file=sys.stderr)
        return 1
    if unknown := sorted(set(needs) - CAPABILITIES):
        words = ", ".join(sorted(CAPABILITIES))
        print(f"error: unknown capability {', '.join(unknown)}; use {words}", file=sys.stderr)
        return 1
    folder = args.root / "skills" / args.id
    if folder.exists():
        print(f"error: {folder} already exists; pick another id or move it first", file=sys.stderr)
        return 1
    folder.mkdir(parents=True)
    manifest_path = folder / "skill.yaml"
    manifest_path.write_text(manifest(args.id, args.name, needs), encoding="utf-8")
    pack_path = None
    if args.rules != "none":
        pack_path = folder / "rules" / f"{args.id}.yaml"
        pack_path.parent.mkdir()
        pack_path.write_text(pack(args.rules, args.id, args.name), encoding="utf-8")
    self_check(manifest_path, pack_path)
    rel = manifest_path.relative_to(args.root)
    also = " and the rule pack" if pack_path else ""
    print("Created:", *(str(p.relative_to(args.root)) for p in (manifest_path, pack_path) if p))
    print("Next:")
    print(f"  1. edit {rel}{also}: fill in every TODO and (check)")
    print("  2. uv run python scripts/validate_skills.py")
    print("  3. make check")
    return 0


if __name__ == "__main__":
    sys.exit(main())
