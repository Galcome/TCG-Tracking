"""Let the audit log record a deleted product being put back.

A product delete now keeps a full copy of what it removed, and that copy can be restored as
a last resort. The restore is its own audit action, so the log shows who undid what.

Revision ID: 0022_audit_restore
Revises: 0021_portfolio_snapshots
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0022_audit_restore"
down_revision: str | None = "0021_portfolio_snapshots"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Frozen copies, not imports: a migration must keep meaning what it meant when it ran.
OLD_ACTIONS = "action IN ('create', 'update', 'void', 'delete')"
NEW_ACTIONS = "action IN ('create', 'update', 'void', 'delete', 'restore')"


def upgrade() -> None:
    op.drop_constraint("ck_audit_action", "audit_log", type_="check")
    op.create_check_constraint("ck_audit_action", "audit_log", NEW_ACTIONS)


def downgrade() -> None:
    # The restore rows are the record of who undid a delete; refuse rather than drop them.
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM audit_log WHERE action = 'restore') "
        "THEN RAISE EXCEPTION 'audit_log holds restore records; "
        "export and remove them before downgrading'; "
        "END IF; END $$"
    )
    op.drop_constraint("ck_audit_action", "audit_log", type_="check")
    op.create_check_constraint("ck_audit_action", "audit_log", OLD_ACTIONS)
