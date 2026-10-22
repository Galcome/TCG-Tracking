"""Record a partner buying into the business as its own kind of money movement.

A transfer from a partner's account into the joint one says the business owes them the
money back. A buy-in is ownership, not a loan, so it needs a kind that leaves nobody owed.

Revision ID: 0019_partner_contributions
Revises: 0018_more_sealed_product_types
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019_partner_contributions"
down_revision: str | None = "0018_more_sealed_product_types"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Frozen copies, not imports: a migration must keep meaning what it meant when it ran.
OLD_KINDS = "kind IN ('funding', 'proceeds', 'transfer', 'adjustment', 'expense')"
NEW_KINDS = (
    "kind IN ('funding', 'proceeds', 'transfer', 'adjustment', 'expense', 'contribution')"
)


def upgrade() -> None:
    op.add_column(
        "money_movements",
        sa.Column(
            "contributed_by_member_id",
            sa.Uuid(),
            sa.ForeignKey("members.id", name="fk_money_movements_contributed_by_member_id"),
            nullable=True,
        ),
    )
    op.drop_constraint("ck_money_movements_kind", "money_movements", type_="check")
    op.create_check_constraint("ck_money_movements_kind", "money_movements", NEW_KINDS)
    op.create_check_constraint(
        "ck_money_movements_contribution_has_member",
        "money_movements",
        "(kind = 'contribution') = (contributed_by_member_id IS NOT NULL)",
    )


def downgrade() -> None:
    # A contribution cannot be expressed in the old schema; dropping it silently would
    # take cash out of the joint account, so refuse instead.
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM money_movements WHERE kind = 'contribution') "
        "THEN RAISE EXCEPTION 'money_movements holds partner contributions; "
        "export and remove them before downgrading'; "
        "END IF; END $$"
    )
    op.drop_constraint(
        "ck_money_movements_contribution_has_member", "money_movements", type_="check"
    )
    op.drop_constraint("ck_money_movements_kind", "money_movements", type_="check")
    op.create_check_constraint("ck_money_movements_kind", "money_movements", OLD_KINDS)
    op.drop_column("money_movements", "contributed_by_member_id")
