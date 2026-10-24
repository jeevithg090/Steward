"""Personal memory (SQL fallback for Mem0) and forget tombstones, with pgvector.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-24 18:40:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "memories",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("key", sa.String(length=24), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("trust", sa.String(length=16), nullable=False),
        sa.Column("observed_at", TS, nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("consent_scope", sa.String(length=64), nullable=True),
        sa.Column("expires_at", TS, nullable=True),
        sa.Column("superseded_by", sa.String(length=32), nullable=True),
        sa.Column("embedding", Vector(256), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_memories")),
    )
    op.create_index(op.f("ix_memories_user_id"), "memories", ["user_id"])
    op.create_table(
        "memory_tombstones",
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("key", sa.String(length=24), nullable=False),
        sa.Column("at", TS, nullable=False),
        sa.PrimaryKeyConstraint("user_id", "key", "at", name=op.f("pk_memory_tombstones")),
    )


def downgrade() -> None:
    op.drop_table("memory_tombstones")
    op.drop_index(op.f("ix_memories_user_id"), table_name="memories")
    op.drop_table("memories")
