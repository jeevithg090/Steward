"""The Vault: sealed blobs and wrapped data keys (client-side encryption, S8.3).

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-24 19:40:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "vault_blobs",
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("mission_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("blob", sa.LargeBinary(), nullable=False),
        sa.PrimaryKeyConstraint("user_id", "mission_id", "name", name=op.f("pk_vault_blobs")),
    )
    op.create_table(
        "vault_keys",
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("mission_id", sa.String(length=64), nullable=False),
        sa.Column("wrapped", sa.LargeBinary(), nullable=False),
        sa.PrimaryKeyConstraint("user_id", "mission_id", name=op.f("pk_vault_keys")),
    )


def downgrade() -> None:
    op.drop_table("vault_keys")
    op.drop_table("vault_blobs")
