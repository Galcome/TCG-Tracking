"""Store credit as a pot per shop.

Selling a box to a card shop for credit is a real disposal at a real value - it belongs in
realized profit - but it produces no cash. So credit gets its own account kind: it sums like
the joint account, because it is spendable, and it is reported on its own line, because
folding restricted credit into a cash figure is the same class of lie as valuing unpriced
stock at zero.

The name is the shop, matched case-insensitively, so "Card Shop" and "card shop" cannot end
up as two half-balances.

Revision ID: 0007_store_credit
Revises: 0006_money_ledger
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_store_credit"
down_revision: str | None = "0006_money_ledger"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_money_accounts_kind", "money_accounts", type_="check")
    op.create_check_constraint(
        "ck_money_accounts_kind",
        "money_accounts",
        "kind IN ('joint', 'member', 'store_credit')",
    )
    op.create_index(
        "uq_money_accounts_store_name",
        "money_accounts",
        [sa.text("lower(name)")],
        unique=True,
        postgresql_where=sa.text("kind = 'store_credit'"),
    )


def downgrade() -> None:
    op.drop_index("uq_money_accounts_store_name", table_name="money_accounts")
    # Any store-credit account would violate the narrower constraint, so they go first.
    op.execute("DELETE FROM money_accounts WHERE kind = 'store_credit'")
    op.drop_constraint("ck_money_accounts_kind", "money_accounts", type_="check")
    op.create_check_constraint(
        "ck_money_accounts_kind", "money_accounts", "kind IN ('joint', 'member')"
    )
