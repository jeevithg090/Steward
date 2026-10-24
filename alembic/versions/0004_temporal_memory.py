"""Temporal memory (SQL fallback for Graphiti): trusted episodes and dated facts.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-24 18:55:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "memory_episodes",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("event", sa.String(length=16), nullable=False),
        sa.Column("at", TS, nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_memory_episodes")),
    )
    op.create_index(op.f("ix_memory_episodes_user_id"), "memory_episodes", ["user_id"])
    op.create_table(
        "temporal_facts",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("subject", sa.String(length=120), nullable=False),
        sa.Column("predicate", sa.String(length=32), nullable=False),
        sa.Column("object", sa.String(length=200), nullable=False),
        sa.Column("valid_from", TS, nullable=False),
        sa.Column("valid_to", TS, nullable=True),
        sa.Column("superseded_by", sa.String(length=32), nullable=True),
        sa.Column("episode_id", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(
            ["episode_id"],
            ["memory_episodes.id"],
            name=op.f("fk_temporal_facts_episode_id_memory_episodes"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_temporal_facts")),
    )
    op.create_index(op.f("ix_temporal_facts_user_id"), "temporal_facts", ["user_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_temporal_facts_user_id"), table_name="temporal_facts")
    op.drop_table("temporal_facts")
    op.drop_index(op.f("ix_memory_episodes_user_id"), table_name="memory_episodes")
    op.drop_table("memory_episodes")
