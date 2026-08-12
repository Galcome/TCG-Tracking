"""Stock buckets and moves.

Stock gains a bucket - inventory, store or vault - and a move transaction that shifts it
between them. Buckets are *intent*, not a place; whose house something is in stays
`products.storage_location`.

Deliberately orthogonal to cost. A unit's cost basis comes from its purchase lot wherever it
sits, so FIFO stays product-wide and `cost_allocations` is untouched by any of this.

The added columns carry `server_default='inventory'`, which backfills every existing row to
what it always implicitly was, and keeps a direct SQL insert from failing on a column the
ORM would have filled in.

Revision ID: 0005_stock_buckets
Revises: 0004_sale_hold_time
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_stock_buckets"
down_revision: str | None = "0004_sale_hold_time"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BUCKET_CHECK = "bucket IN ('inventory', 'store', 'vault')"
_BUCKETED = ("purchases", "sales", "inventory_adjustments")

#: Constraint names differ from table names for adjustments, matching the existing scheme.
_CONSTRAINT_NAMES = {
    "purchases": "ck_purchases_bucket",
    "sales": "ck_sales_bucket",
    "inventory_adjustments": "ck_adjustments_bucket",
}


def upgrade() -> None:
    for table in _BUCKETED:
        op.add_column(
            table,
            sa.Column(
                "bucket",
                sa.String(length=16),
                nullable=False,
                server_default="inventory",
            ),
        )
        op.create_check_constraint(_CONSTRAINT_NAMES[table], table, BUCKET_CHECK)

    op.create_table(
        "stock_moves",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("from_bucket", sa.String(length=16), nullable=False),
        sa.Column("bucket", sa.String(length=16), nullable=False, server_default="inventory"),
        sa.Column("moved_on", sa.Date(), nullable=True),
        sa.Column("member_id", sa.Uuid(), nullable=True),
        sa.Column("created_by_member_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("void_reason", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=False),
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
        sa.CheckConstraint("quantity > 0", name="ck_moves_quantity_positive"),
        sa.CheckConstraint("from_bucket <> bucket", name="ck_moves_buckets_differ"),
        sa.CheckConstraint(
            "from_bucket IN ('inventory', 'store', 'vault')", name="ck_moves_from_bucket"
        ),
        sa.CheckConstraint(BUCKET_CHECK, name="ck_moves_bucket"),
        sa.CheckConstraint("status IN ('active', 'voided')", name="ck_moves_status"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"]),
        sa.ForeignKeyConstraint(["created_by_member_id"], ["members.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_moves_product_status", "stock_moves", ["product_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_moves_product_status", table_name="stock_moves")
    op.drop_table("stock_moves")

    for table in _BUCKETED:
        op.drop_constraint(_CONSTRAINT_NAMES[table], table, type_="check")
        op.drop_column(table, "bucket")
