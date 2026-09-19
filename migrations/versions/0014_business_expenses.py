"""Record business overhead as its own kind of money movement.

Revision ID: 0014_business_expenses
Revises: 0013_set_catalog_sync
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014_business_expenses"
down_revision: str | None = "0013_set_catalog_sync"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Frozen copies, not imports: a migration must keep meaning what it meant when it ran.
OLD_KINDS = "kind IN ('funding', 'proceeds', 'transfer', 'adjustment')"
NEW_KINDS = "kind IN ('funding', 'proceeds', 'transfer', 'adjustment', 'expense')"
CATEGORIES = (
    "expense_category IS NULL OR expense_category IN ('supplies', 'shipping_supplies', "
    "'show_fees', 'subscriptions', 'travel', 'grading_fees', 'other')"
)


def upgrade() -> None:
    op.add_column(
        "money_movements", sa.Column("expense_category", sa.String(32), nullable=True)
    )
    op.drop_constraint("ck_money_movements_kind", "money_movements", type_="check")
    op.create_check_constraint("ck_money_movements_kind", "money_movements", NEW_KINDS)
    op.create_check_constraint(
        "ck_money_movements_expense_category", "money_movements", CATEGORIES
    )
    op.create_check_constraint(
        "ck_money_movements_expense_has_category",
        "money_movements",
        "(kind = 'expense') = (expense_category IS NOT NULL)",
    )


def downgrade() -> None:
    # Expenses cannot be expressed in the old schema; dropping them silently would change
    # every balance they touched, so refuse instead.
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM money_movements WHERE kind = 'expense') THEN "
        "RAISE EXCEPTION 'money_movements holds expenses; "
        "export and remove them before downgrading'; "
        "END IF; END $$"
    )
    op.drop_constraint(
        "ck_money_movements_expense_has_category", "money_movements", type_="check"
    )
    op.drop_constraint("ck_money_movements_expense_category", "money_movements", type_="check")
    op.drop_constraint("ck_money_movements_kind", "money_movements", type_="check")
    op.create_check_constraint("ck_money_movements_kind", "money_movements", OLD_KINDS)
    op.drop_column("money_movements", "expense_category")
