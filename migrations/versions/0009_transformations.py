"""Transformations: one product becoming another, carrying its cost and its date.

Case into boxes, box into cards, raw card into a graded card - one table, because they are
one operation. What travels with the stock is what makes the reports possible: the original
purchase date, so cracking does not reset the ageing clock, and parentage, so a graded hit
can be traced back to the case it came out of.

Two supporting changes:

`purchases.is_derived` marks cost carried across rather than money spent. Six boxes out of a
$900 case are six derived purchases totalling $900; without the flag the dashboard would say
the group paid $1,800. They are ordinary purchases in every other respect - FIFO consumes
them and the ageing report ages them - and only the money-out figures skip them.

The `transformed` adjustment reason exists so a cracked case is not reported as a write-off.
Its cost did not evaporate, it moved.

Revision ID: 0009_transformations
Revises: 0008_card_sets
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009_transformations"
down_revision: str | None = "0008_card_sets"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_REASONS_BEFORE = (
    "reason IN ('opening_inventory', 'correction', 'damaged', 'missing', 'opened', "
    "'given_away', 'personal_use', 'returned', 'written_off', 'other')"
)
_REASONS_AFTER = (
    "reason IN ('opening_inventory', 'correction', 'damaged', 'missing', 'opened', "
    "'given_away', 'personal_use', 'returned', 'written_off', 'transformed', 'other')"
)


def upgrade() -> None:
    op.add_column(
        "purchases",
        sa.Column(
            "is_derived", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
    )

    op.drop_constraint("ck_adjustments_reason", "inventory_adjustments", type_="check")
    op.create_check_constraint(
        "ck_adjustments_reason", "inventory_adjustments", _REASONS_AFTER
    )

    op.create_table(
        "transformations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("source_product_id", sa.Uuid(), nullable=False),
        sa.Column("source_quantity", sa.Integer(), nullable=False),
        sa.Column(
            "source_bucket", sa.String(length=16), nullable=False, server_default="inventory"
        ),
        sa.Column("occurred_on", sa.Date(), nullable=True),
        sa.Column("inherited_purchase_date", sa.Date(), nullable=True),
        sa.Column("source_cost_cents", sa.BigInteger(), nullable=True),
        sa.Column("consuming_adjustment_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=10), nullable=False, server_default="active"),
        sa.Column("void_reason", sa.Text(), nullable=True),
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
        sa.CheckConstraint("kind IN ('crack', 'rip', 'grade')", name="ck_transformations_kind"),
        sa.CheckConstraint(
            "status IN ('active', 'voided')", name="ck_transformations_status"
        ),
        sa.CheckConstraint("source_quantity > 0", name="ck_transformations_source_positive"),
        sa.ForeignKeyConstraint(["source_product_id"], ["products.id"]),
        sa.ForeignKeyConstraint(["consuming_adjustment_id"], ["inventory_adjustments.id"]),
        sa.ForeignKeyConstraint(["created_by_member_id"], ["members.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_transformations_source", "transformations", ["source_product_id", "status"]
    )

    op.create_table(
        "transformation_outputs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("transformation_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("bucket", sa.String(length=16), nullable=False, server_default="inventory"),
        sa.Column("cost_cents", sa.BigInteger(), nullable=True),
        sa.Column("purchase_id", sa.Uuid(), nullable=True),
        sa.CheckConstraint(
            "quantity > 0", name="ck_transformation_outputs_quantity_positive"
        ),
        sa.CheckConstraint(
            "cost_cents IS NULL OR cost_cents >= 0",
            name="ck_transformation_outputs_cost_non_negative",
        ),
        sa.ForeignKeyConstraint(
            ["transformation_id"], ["transformations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.ForeignKeyConstraint(["purchase_id"], ["purchases.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_transformation_outputs_transformation",
        "transformation_outputs",
        ["transformation_id"],
    )
    op.create_index(
        "ix_transformation_outputs_product", "transformation_outputs", ["product_id"]
    )


def downgrade() -> None:
    op.drop_index(
        "ix_transformation_outputs_product", table_name="transformation_outputs"
    )
    op.drop_index(
        "ix_transformation_outputs_transformation", table_name="transformation_outputs"
    )
    op.drop_table("transformation_outputs")

    op.drop_index("ix_transformations_source", table_name="transformations")
    op.drop_table("transformations")

    # Any row using the new reason would violate the narrower constraint.
    op.execute(
        "UPDATE inventory_adjustments SET reason = 'opened' WHERE reason = 'transformed'"
    )
    op.drop_constraint("ck_adjustments_reason", "inventory_adjustments", type_="check")
    op.create_check_constraint(
        "ck_adjustments_reason", "inventory_adjustments", _REASONS_BEFORE
    )

    op.drop_column("purchases", "is_derived")
