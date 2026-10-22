"""Combine: many products bundled into one new one.

A whole set of singles sold as one unit is a transformation in the other direction - many
in, one out. The inputs get their own table, mirroring the outputs, and a combine is the
one kind with no single source product, so the source columns become nullable and a check
ties that to the kind.

Revision ID: 0023_combine_products
Revises: 0022_audit_restore
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0023_combine_products"
down_revision: str | None = "0022_audit_restore"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Frozen copies, not imports: a migration must keep meaning what it meant when it ran.
OLD_KINDS = "kind IN ('crack', 'rip', 'grade')"
NEW_KINDS = "kind IN ('crack', 'rip', 'grade', 'combine')"
SOURCE_CHECK = "(kind = 'combine') = (source_product_id IS NULL)"


def upgrade() -> None:
    op.drop_constraint("ck_transformations_kind", "transformations", type_="check")
    op.create_check_constraint("ck_transformations_kind", "transformations", NEW_KINDS)
    op.alter_column("transformations", "source_product_id", nullable=True)
    # The old default would quietly file a combine under Inventory; every writer names it.
    op.alter_column("transformations", "source_bucket", nullable=True, server_default=None)
    op.create_check_constraint(
        "ck_transformations_source_matches_kind", "transformations", SOURCE_CHECK
    )

    op.create_table(
        "transformation_inputs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("transformation_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("bucket", sa.String(length=16), nullable=False),
        sa.Column("cost_cents", sa.BigInteger(), nullable=True),
        sa.Column("consuming_adjustment_id", sa.Uuid(), nullable=True),
        sa.CheckConstraint("quantity > 0", name="ck_transformation_inputs_quantity_positive"),
        sa.CheckConstraint(
            "cost_cents IS NULL OR cost_cents >= 0",
            name="ck_transformation_inputs_cost_non_negative",
        ),
        sa.ForeignKeyConstraint(
            ["transformation_id"], ["transformations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.ForeignKeyConstraint(["consuming_adjustment_id"], ["inventory_adjustments.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_transformation_inputs_transformation", "transformation_inputs", ["transformation_id"]
    )
    op.create_index("ix_transformation_inputs_product", "transformation_inputs", ["product_id"])


def downgrade() -> None:
    # A combine is the record of where a bundle's stock and cost came from; refuse rather
    # than drop it.
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM transformations WHERE kind = 'combine') "
        "THEN RAISE EXCEPTION 'transformations holds combines; "
        "export and remove them before downgrading'; "
        "END IF; END $$"
    )
    op.drop_index("ix_transformation_inputs_product", table_name="transformation_inputs")
    op.drop_index("ix_transformation_inputs_transformation", table_name="transformation_inputs")
    op.drop_table("transformation_inputs")
    op.drop_constraint(
        "ck_transformations_source_matches_kind", "transformations", type_="check"
    )
    op.alter_column(
        "transformations", "source_bucket", nullable=False, server_default="inventory"
    )
    op.alter_column("transformations", "source_product_id", nullable=False)
    op.drop_constraint("ck_transformations_kind", "transformations", type_="check")
    op.create_check_constraint("ck_transformations_kind", "transformations", OLD_KINDS)
