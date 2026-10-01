"""Let a product be hidden from the stock list and the on-shelf totals.

Revision ID: 0016_hidden_products
Revises: 0015_sale_orders
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016_hidden_products"
down_revision: str | None = "0015_sale_orders"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Not the same thing as archived. An archived product is finished with; a hidden one
    # is still owned and still sellable, just not worth looking at - bulk and $2 singles.
    op.add_column(
        "products",
        sa.Column("is_hidden", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column("products", "is_hidden", server_default=None)
    op.create_index("ix_products_is_hidden", "products", ["is_hidden"])


def downgrade() -> None:
    op.drop_index("ix_products_is_hidden", table_name="products")
    op.drop_column("products", "is_hidden")
