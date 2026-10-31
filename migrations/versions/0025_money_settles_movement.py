"""Link a payback to the movement it pays back.

Pay back on an open transaction has to settle that transaction. Nothing recorded which one
a transfer was for, so the money could only come off the partner's oldest row. Existing
transfers stay unlinked, and open items keep treating unlinked money as coming off the
oldest rows, so nothing settled before this reopens.

Revision ID: 0025_money_settles_movement
Revises: 0024_complete_set_fixed_cards
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0025_money_settles_movement"
down_revision: str | None = "0024_complete_set_fixed_cards"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("money_movements", sa.Column("settles_movement_id", sa.Uuid(), nullable=True))


def downgrade() -> None:
    op.drop_column("money_movements", "settles_movement_id")
