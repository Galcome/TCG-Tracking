"""Group the lines of one multi-item sale.

Revision ID: 0015_sale_orders
Revises: 0014_business_expenses
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015_sale_orders"
down_revision: str | None = "0014_business_expenses"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nullable and without a parent table: an order is only the lines that share it, and
    # every sale recorded before this has none.
    op.add_column("sales", sa.Column("order_id", sa.Uuid(), nullable=True))
    op.create_index("ix_sales_order_id", "sales", ["order_id"])


def downgrade() -> None:
    op.drop_index("ix_sales_order_id", table_name="sales")
    op.drop_column("sales", "order_id")
