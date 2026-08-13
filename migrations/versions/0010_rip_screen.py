"""The rip screen: dated value estimates, and bulk written off where it happens.

`price_snapshots` holds what something was thought to be worth on a day. Estimates never
touch cost basis or realized profit - they inform decisions, they do not score them - so
this is a table of its own rather than a column on the product.

It exists now rather than with the parked price feed because the rip screen needs it.
Pulling a card and calling it $50 out of a $150 box reads as being $100 down that day, and
that is a true statement of that day. What the app owes is the journey: cost fixed at $150,
estimate $50 on day zero, sold for $1,500 on day 400.

`transformations.bulk_cost_cents` is the part of a ripped box the hits did not take. The
group has said outright it would never rip something in order to sell the bulk, so the
leftovers are not an asset - they are written off where it happened, and a bad rip looks
bad immediately.

Revision ID: 0010_rip_screen
Revises: 0009_transformations
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010_rip_screen"
down_revision: str | None = "0009_transformations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "transformations",
        sa.Column(
            "bulk_cost_cents", sa.BigInteger(), nullable=False, server_default=sa.text("0")
        ),
    )

    op.create_table(
        "price_snapshots",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("value_cents", sa.BigInteger(), nullable=False),
        sa.Column("captured_on", sa.Date(), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False, server_default="typed"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_member_id", sa.Uuid(), nullable=True),
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
        sa.CheckConstraint("value_cents >= 0", name="ck_price_snapshots_value_non_negative"),
        sa.CheckConstraint("source IN ('typed')", name="ck_price_snapshots_source"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.ForeignKeyConstraint(["created_by_member_id"], ["members.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_price_snapshots_product_date", "price_snapshots", ["product_id", "captured_on"]
    )


def downgrade() -> None:
    op.drop_index("ix_price_snapshots_product_date", table_name="price_snapshots")
    op.drop_table("price_snapshots")
    op.drop_column("transformations", "bulk_cost_cents")
