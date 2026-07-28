"""Use clock_timestamp() for created_at/updated_at defaults.

Revision ID: 0003_clock_timestamp
Revises: 0002_ledger
Create Date: 2026-07-28

`now()` returns the transaction start time, so every row written in one transaction shares
a created_at. The costing engine uses created_at to break ties between events on the same
date; identical values made it fall through to comparing random UUIDs, so FIFO order was
non-deterministic whenever two events were inserted together.

clock_timestamp() is the actual wall clock at insert, which preserves insertion order.
"""

from alembic import op

revision = "0003_clock_timestamp"
down_revision = "0002_ledger"
branch_labels = None
depends_on = None

TABLES = (
    "members",
    "games",
    "product_types",
    "products",
    "purchases",
    "sales",
    "inventory_adjustments",
)
COLUMNS = ("created_at", "updated_at")


def _set_default(expression: str) -> None:
    # Interpolated rather than bound because Postgres cannot parameterise identifiers in
    # DDL. Every value here is a module-level constant, never user input.
    for table in TABLES:
        for column in COLUMNS:
            op.execute(f"ALTER TABLE {table} ALTER COLUMN {column} SET DEFAULT {expression}")


def upgrade() -> None:
    _set_default("clock_timestamp()")


def downgrade() -> None:
    _set_default("now()")
