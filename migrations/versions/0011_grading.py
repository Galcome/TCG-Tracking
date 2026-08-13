"""Cards away at the grader.

A submission does not move stock. Joseph chose a flag over an "Out" state, so the card keeps
its bucket and carries the date it was sent - which is what makes the day count on it
possible, and that day count is what stops a card quietly sitting at PSA for months.

The return is the transformation, not the send: the grade is unknown when it leaves.

Revision ID: 0011_grading
Revises: 0010_rip_screen
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011_grading"
down_revision: str | None = "0010_rip_screen"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "grading_submissions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("bucket", sa.String(length=16), nullable=False, server_default="inventory"),
        sa.Column("grading_company", sa.String(length=40), nullable=True),
        sa.Column("sent_on", sa.Date(), nullable=False),
        sa.Column("fees_cents", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("status", sa.String(length=10), nullable=False, server_default="out"),
        sa.Column("returned_on", sa.Date(), nullable=True),
        sa.Column("grade", sa.String(length=20), nullable=True),
        sa.Column("transformation_id", sa.Uuid(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("void_reason", sa.Text(), nullable=True),
        sa.Column("created_by_member_id", sa.Uuid(), nullable=True),
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
        sa.CheckConstraint("status IN ('out', 'returned', 'voided')", name="ck_grading_status"),
        sa.CheckConstraint("quantity > 0", name="ck_grading_quantity_positive"),
        sa.CheckConstraint("fees_cents >= 0", name="ck_grading_fees_non_negative"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.ForeignKeyConstraint(["transformation_id"], ["transformations.id"]),
        sa.ForeignKeyConstraint(["created_by_member_id"], ["members.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_grading_product_status", "grading_submissions", ["product_id", "status"]
    )


def downgrade() -> None:
    op.drop_index("ix_grading_product_status", table_name="grading_submissions")
    op.drop_table("grading_submissions")
