#!/usr/bin/env python3
"""
Skill Forge Demo - Generate a complete Tempo skill from natural language narration.

Run this script to see the Skill Forge in action:
    python -m tempo.skill_forge.demo "In my council you can get 25% off council tax if you live alone. You fill this form and they reply in 2 weeks."
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# Add tempo to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from tempo.skill_forge import GenerationConfig, SkillForgeGenerator


class MockModel:
    """Mock model for demo - returns structured spec without real LLM call."""

    async def structured(self, prompt: str, schema: dict, model: str, temperature: float) -> dict:
        # Return a realistic spec for the council tax example
        return {
            "id": "skill-demo-1234",
            "name": "council-tax-single-person-discount",
            "description": "Claims 25% council tax discount for single occupants",
            "version": "0.1.0",
            "tier": "community",
            "triggers": [
                {
                    "type": "intent",
                    "examples": [
                        "council tax discount",
                        "single person discount",
                        "council tax reduction",
                    ],
                    "source": None,
                    "cron": None,
                },
                {"type": "event", "examples": [], "source": "council.tax_bill", "cron": None},
            ],
            "capabilities": [
                {
                    "name": "read.evidence.council_tax_bill",
                    "requires_consent": [],
                    "description": "Read council tax bill",
                    "risk_level": "low",
                },
                {
                    "name": "net.api.council_portal",
                    "requires_consent": ["file_claim"],
                    "description": "Submit claim to council portal",
                    "risk_level": "medium",
                },
                {
                    "name": "act.file_claim",
                    "requires_consent": ["file_claim"],
                    "description": "File the discount claim",
                    "risk_level": "high",
                },
            ],
            "forbidden": ["money.move", "credentials.collect", "settlement.below_entitlement"],
            "blueprints": [
                "intake.vision",
                "intake.voice",
                "rules.entitlement",
                "writer.claim",
                "form_buddy",
            ],
            "rule_packs": [
                {
                    "id": "council-tax-single-person-discount",
                    "scheme": "Council Tax Reduction",
                    "operator": "local_council",
                    "citation_url": "https://www.gov.uk/apply-council-tax-reduction",
                    "last_verified": "2026-10-24",
                }
            ],
            "context": {
                "pin": ["user.time_value", "case.facts", "case.entitlement", "consent.limits"],
                "retrieve": {
                    "provider": "snowflake.cortex_search",
                    "service": "POLICY_SEARCH",
                    "filter": {"scheme": "Council Tax"},
                    "top_k": 4,
                },
            },
            "budgets": {"max_llm_gbp": 0.15, "max_call_minutes": 15, "max_user_questions": 2},
            "time_value": {"est_user_minutes_saved": 30},
            "evals": {"suite": "evals/", "publish_threshold": 0.95, "adversarial": True},
        }


class MockRepo:
    """Mock repo for demo."""

    pass


async def run_demo(narration: str):
    """Run the Skill Forge demo."""
    print("=" * 70)
    print("🧬 TEMPO SKILL FORGE - Generative Skill Creation Demo")
    print("=" * 70)
    print(f'\n📝 User narration: "{narration}"\n')

    # Create generator with mock dependencies
    config = GenerationConfig(output_dir="skills/generated")
    generator = SkillForgeGenerator(MockModel(), MockRepo(), config)

    # Generate the skill
    print("🔄 Generating skill...")
    state = await generator.generate_skill(narration, user_id="demo-user")

    print("\n✅ Generation complete!")
    print(f"   Skill ID: {state.skill_id}")
    print(f"   Stage: {state.stage.value}")
    print(f"   Artifacts generated: {len(state.artifacts)}")

    if state.spec:
        print("\n📋 Formal Specification:")
        print(f"   Name: {state.spec.name}")
        print(f"   Description: {state.spec.description}")
        print(f"   Blueprints: {', '.join(state.spec.blueprints)}")
        print(f"   Rule Packs: {[rp.id for rp in state.spec.rule_packs]}")
        print(f"   Capabilities: {len(state.spec.capabilities)}")
        print(f"   Est. time saved: {state.spec.time_value.est_user_minutes_saved} min")

    print("\n📦 Generated Artifacts:")
    for artifact in state.artifacts:
        print(f"   • {artifact.artifact_type}: {artifact.file_path}")

    if state.eval_results:
        print("\n🧪 Eval Gate Results:")
        print(f"   Passed: {state.eval_results.get('passed', 'N/A')}")
        print(f"   Score: {state.eval_results.get('score', 'N/A')}")
        print(f"   Details: {state.eval_results.get('details', 'N/A')}")

    # Show preview of key artifacts
    print("\n" + "=" * 70)
    print("📄 ARTIFACT PREVIEWS")
    print("=" * 70)

    for artifact in state.artifacts:
        if artifact.artifact_type in ["manifest", "rule_pack", "mcp_server", "tests"]:
            print(f"\n--- {artifact.file_path} ---")
            content = artifact.content
            if isinstance(content, bytes):
                content = content.decode("utf-8", errors="replace")
            lines = content.split("\n")
            for line in lines[:30]:
                print(line)
            if len(lines) > 30:
                print(f"... ({len(lines) - 30} more lines)")

    print("\n" + "=" * 70)
    print("🎉 Skill generated successfully!")
    print(f"   Output directory: {config.output_dir}/{state.skill_id}/")
    print("   Ready for eval gate → GitLab MR → Registry")
    print("=" * 70)

    return state


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    narration = " ".join(sys.argv[1:])
    asyncio.run(run_demo(narration))


if __name__ == "__main__":
    main()
