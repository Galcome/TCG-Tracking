"""Audit trail for every change to financial history.

Editing a transaction re-runs FIFO across the whole product, so a correction to an old
purchase can change the profit on sales that already looked settled. That is arithmetically
right and deeply confusing without a record of what changed, when, and who did it.

One generic table rather than per-entity history tables: the rows are only ever written and
read back chronologically, so there is nothing to gain from separate schemas.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base

ACTION_CREATE = "create"
ACTION_UPDATE = "update"
ACTION_VOID = "void"


class AuditLog(Base):
    __tablename__ = "audit_log"
    __table_args__ = (
        CheckConstraint("action IN ('create', 'update', 'void')", name="ck_audit_action"),
        Index("ix_audit_entity", "entity_type", "entity_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    action: Mapped[str] = mapped_column(String(10), nullable=False)

    member_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("members.id"), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Only the fields that actually changed, so a diff is readable without decoding two
    # full snapshots.
    before: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
