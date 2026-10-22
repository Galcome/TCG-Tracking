"""The audit log's last-resort undo: products that were deleted, and putting one back."""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from src.dependencies import db_session, get_current_member
from src.models.audit import ACTION_DELETE, AuditLog
from src.models.member import Member
from src.models.product import Product
from src.services import ledger

router = APIRouter()

#: Deletes are rare - tests and mistakes - so this many covers every one anyone will look for.
DELETED_LIMIT = 100


class DeletedProductRead(BaseModel):
    #: The delete's audit row; recovery is addressed by it.
    id: uuid.UUID
    product_id: uuid.UUID
    name: str
    deleted_at: datetime
    deleted_by: str | None
    purchases: int
    sales: int
    #: False for deletes made before a full copy was kept.
    recoverable: bool


class RestoredRead(BaseModel):
    product_id: uuid.UUID


@router.get("/deleted-products", response_model=list[DeletedProductRead])
def list_deleted_products(
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session, scope="function"),
) -> list[DeletedProductRead]:
    """Products that are deleted right now, newest first. One row per product: if it was
    deleted, put back and deleted again, only the latest delete is offered."""
    entries = db.scalars(
        select(AuditLog)
        .where(
            AuditLog.entity_type == "product",
            AuditLog.action == ACTION_DELETE,
            ~exists().where(Product.id == AuditLog.entity_id),
        )
        .order_by(AuditLog.occurred_at.desc(), AuditLog.id)
        .limit(DELETED_LIMIT)
    ).all()
    names = {
        member_id: name
        for member_id, name in db.execute(
            select(Member.id, Member.display_name).where(
                Member.id.in_({entry.member_id for entry in entries})
            )
        ).all()
    }

    items: list[DeletedProductRead] = []
    seen: set[uuid.UUID] = set()
    for entry in entries:
        if entry.entity_id in seen:
            continue
        seen.add(entry.entity_id)
        before = entry.before or {}
        items.append(
            DeletedProductRead(
                id=entry.id,
                product_id=entry.entity_id,
                name=before.get("name") or "Unnamed product",
                deleted_at=entry.occurred_at,
                deleted_by=names.get(entry.member_id),
                purchases=len(before.get("purchases", [])),
                sales=len(before.get("sales", [])),
                recoverable="records" in before,
            )
        )
    return items


@router.post(
    "/deleted-products/{audit_id}/restore",
    response_model=RestoredRead,
    status_code=status.HTTP_201_CREATED,
)
def restore_deleted_product(
    audit_id: uuid.UUID,
    member: Member = Depends(get_current_member),
    db: Session = Depends(db_session, scope="function"),
) -> RestoredRead:
    """Put a deleted product back with everything it had, as a last resort."""
    entry = db.get(AuditLog, audit_id)
    if entry is None or entry.entity_type != "product" or entry.action != ACTION_DELETE:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delete not found")
    return RestoredRead(product_id=ledger.restore_product(db, entry, member_id=member.id))
