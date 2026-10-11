"""Let the audit log record a product being deleted outright.

Deleting a test or mistaken product now takes its purchases, sales and money with it in
one step. The audit row is what is left behind, so it needs its own action.

Revision ID: 0020_audit_delete
Revises: 0019_partner_contributions
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0020_audit_delete"
down_revision: str | None = "0019_partner_contributions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Frozen copies, not imports: a migration must keep meaning what it meant when it ran.
OLD_ACTIONS = "action IN ('create', 'update', 'void')"
NEW_ACTIONS = "action IN ('create', 'update', 'void', 'delete')"


def upgrade() -> None:
    op.drop_constraint("ck_audit_action", "audit_log", type_="check")
    op.create_check_constraint("ck_audit_action", "audit_log", NEW_ACTIONS)


def downgrade() -> None:
    # The delete rows are the only record of what was removed; refuse rather than drop them.
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM audit_log WHERE action = 'delete') "
        "THEN RAISE EXCEPTION 'audit_log holds delete records; "
        "export and remove them before downgrading'; "
        "END IF; END $$"
    )
    op.drop_constraint("ck_audit_action", "audit_log", type_="check")
    op.create_check_constraint("ck_audit_action", "audit_log", OLD_ACTIONS)
