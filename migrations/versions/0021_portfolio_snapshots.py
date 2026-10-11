"""One row per day of what the priced stock was worth, for the dashboard's value chart.

Revision ID: 0021_portfolio_snapshots
Revises: 0020_audit_delete
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0021_portfolio_snapshots"
down_revision: str | None = "0020_audit_delete"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "portfolio_snapshots",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("captured_on", sa.Date(), nullable=False),
        sa.Column("market_value_cents", sa.BigInteger(), nullable=False),
        sa.Column("priced_cost_cents", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("clock_timestamp()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("clock_timestamp()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "market_value_cents >= 0", name="ck_portfolio_snapshots_value_non_negative"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("captured_on", name="uq_portfolio_snapshots_captured_on"),
    )


def downgrade() -> None:
    op.drop_table("portfolio_snapshots")
