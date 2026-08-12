"""The money ledger: accounts, movements and their postings.

Answers a different question from the stock ledger. `purchases` and `sales` say what was
spent on stock and what came back; these tables say whose money paid for it and where the
proceeds went.

Nothing is backfilled. Existing purchases and sales get no funding or proceeds record,
because who paid for them is not derivable from anything stored - the opening positions
carried over from the spreadsheet are entered as `adjustment` movements instead, which is
exactly what the workbook's rollover column already is.

Revision ID: 0006_money_ledger
Revises: 0005_stock_buckets
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_money_ledger"
down_revision: str | None = "0005_stock_buckets"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TIMESTAMPS = (
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
)


def upgrade() -> None:
    op.create_table(
        "money_accounts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("member_id", sa.Uuid(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        *_TIMESTAMPS,
        sa.CheckConstraint("kind IN ('joint', 'member')", name="ck_money_accounts_kind"),
        sa.CheckConstraint(
            "(kind = 'member') = (member_id IS NOT NULL)",
            name="ck_money_accounts_member_link",
        ),
        sa.CheckConstraint("length(trim(name)) > 0", name="ck_money_accounts_name_present"),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("member_id"),
    )
    # Partial unique index: exactly one joint account, enforced by the database rather than
    # by a check-then-insert that two simultaneous page loads could both pass.
    op.create_index(
        "uq_money_accounts_joint",
        "money_accounts",
        ["kind"],
        unique=True,
        postgresql_where=sa.text("kind = 'joint'"),
    )

    op.create_table(
        "money_movements",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("occurred_on", sa.Date(), nullable=True),
        sa.Column("purchase_id", sa.Uuid(), nullable=True),
        sa.Column("sale_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=10), nullable=False, server_default="active"),
        sa.Column("void_reason", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="CAD"),
        sa.Column("created_by_member_id", sa.Uuid(), nullable=True),
        *_TIMESTAMPS,
        sa.CheckConstraint(
            "kind IN ('funding', 'proceeds', 'transfer', 'adjustment')",
            name="ck_money_movements_kind",
        ),
        sa.CheckConstraint("status IN ('active', 'voided')", name="ck_money_movements_status"),
        sa.CheckConstraint(
            "(purchase_id IS NOT NULL)::int + (sale_id IS NOT NULL)::int <= 1",
            name="ck_money_movements_one_cause",
        ),
        sa.ForeignKeyConstraint(["purchase_id"], ["purchases.id"]),
        sa.ForeignKeyConstraint(["sale_id"], ["sales.id"]),
        sa.ForeignKeyConstraint(["created_by_member_id"], ["members.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_money_movements_status_date", "money_movements", ["status", "occurred_on"]
    )
    op.create_index("ix_money_movements_purchase", "money_movements", ["purchase_id"])
    op.create_index("ix_money_movements_sale", "money_movements", ["sale_id"])

    op.create_table(
        "money_postings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("movement_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("delta_cents", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("delta_cents <> 0", name="ck_money_postings_delta_non_zero"),
        sa.ForeignKeyConstraint(["movement_id"], ["money_movements.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["account_id"], ["money_accounts.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_money_postings_movement_account",
        "money_postings",
        ["movement_id", "account_id"],
        unique=True,
    )
    op.create_index("ix_money_postings_account", "money_postings", ["account_id"])


def downgrade() -> None:
    op.drop_index("ix_money_postings_account", table_name="money_postings")
    op.drop_index("uq_money_postings_movement_account", table_name="money_postings")
    op.drop_table("money_postings")

    op.drop_index("ix_money_movements_sale", table_name="money_movements")
    op.drop_index("ix_money_movements_purchase", table_name="money_movements")
    op.drop_index("ix_money_movements_status_date", table_name="money_movements")
    op.drop_table("money_movements")

    op.drop_index("uq_money_accounts_joint", table_name="money_accounts")
    op.drop_table("money_accounts")
