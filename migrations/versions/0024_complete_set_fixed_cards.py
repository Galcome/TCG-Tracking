"""Fixed-value cards on a complete-set mapping.

A complete set is priced as the sum of its cards' market prices, but a graded copy inside
it is worth what its owner says, not the raw card's price. Each mapping can now name such
cards by number with a value in CAD cents that the daily refresh adds as-is.

Revision ID: 0024_complete_set_fixed_cards
Revises: 0023_combine_products
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0024_complete_set_fixed_cards"
down_revision: str | None = "0023_combine_products"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "catalog_mappings",
        sa.Column(
            "fixed_cards",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("catalog_mappings", "fixed_cards")
