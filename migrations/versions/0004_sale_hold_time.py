"""Persist per-sale shelf time.

Revision ID: 0004_sale_hold_time
Revises: 0003_clock_timestamp
Create Date: 2026-07-28

The FIFO engine already knows the purchase date of every unit it consumes; this stores
the quantity-weighted mean so "profit per day of shelf time" can be reported without
re-walking history on every read.

NULL means genuinely unknown, matching the has_unknown_cost convention: any consumed unit
without a purchase date, or sold beyond recorded stock, leaves the whole sale unknown
rather than guessing a date.
"""

import sqlalchemy as sa
from alembic import op

revision = "0004_sale_hold_time"
down_revision = "0003_clock_timestamp"
branch_labels = None
depends_on = None


# A slice's acquisition date comes from whichever supply funded it. Both columns NULL
# means a shortfall - sold beyond recorded stock - which disqualifies the whole sale.
#
# GREATEST(..., 0) because FIFO deliberately does not require a lot to predate the sale
# it funds, so a back-dated sale can produce negative days. Negative shelf time is not a
# fact about the world and would poison any profit-per-day figure.
BACKFILL = """
UPDATE sales AS target
SET days_held_weighted = computed.days_held
FROM (
    SELECT
        allocation.sale_id,
        ROUND(
            SUM(
                allocation.quantity
                * GREATEST(sale.sale_date - COALESCE(purchase.purchase_date,
                                                     adjustment.adjustment_date), 0)
            )::numeric
            / SUM(allocation.quantity)
        )::int AS days_held
    FROM cost_allocations AS allocation
    JOIN sales AS sale ON sale.id = allocation.sale_id
    LEFT JOIN purchases AS purchase ON purchase.id = allocation.purchase_id
    LEFT JOIN inventory_adjustments AS adjustment
        ON adjustment.id = allocation.adjustment_supply_id
    WHERE allocation.sale_id IS NOT NULL
      AND sale.sale_date IS NOT NULL
    GROUP BY allocation.sale_id
    HAVING BOOL_AND(
        COALESCE(purchase.purchase_date, adjustment.adjustment_date) IS NOT NULL
    )
) AS computed
WHERE target.id = computed.sale_id
"""


def upgrade() -> None:
    op.add_column("sales", sa.Column("days_held_weighted", sa.Integer(), nullable=True))
    op.execute(BACKFILL)


def downgrade() -> None:
    op.drop_column("sales", "days_held_weighted")
