"""Ledger write paths: persistence, recomputation, and the audit trail.

This is the only module that writes to the ledger tables. Every mutating path ends in
`recompute_product`, so cost basis and stock can never drift from the transactions that
produced them.

The pure allocation logic lives in `costing.py`; this module's job is loading events out of
the database, handing them over, and writing the answer back.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from typing import Any, Literal

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from src.models.audit import ACTION_DELETE, ACTION_RESTORE, AuditLog
from src.models.grading import GradingSubmission
from src.models.ledger import (
    STATUS_ACTIVE,
    STATUS_VOIDED,
    CostAllocation,
    InventoryAdjustment,
    Purchase,
    Sale,
    StockMove,
)
from src.models.money import MoneyMovement
from src.models.price_snapshot import PriceSnapshot
from src.models.product import Product
from src.models.transformation import Transformation, TransformationOutput
from src.services import recovery
from src.services.costing import Event, allocate

EntityKind = Literal[
    "purchase", "sale", "adjustment", "move", "money_movement", "transformation", "product"
]

#: Which table an event id came from, so allocations land in the right FK column.
_SourceKind = Literal["purchase", "sale", "adjustment_supply", "adjustment_consumer"]


def _active(model, product_id: uuid.UUID):
    return select(model).where(model.product_id == product_id, model.status == STATUS_ACTIVE)


def load_events(
    db: Session, product_id: uuid.UUID
) -> tuple[list[Event], dict[uuid.UUID, _SourceKind]]:
    """Every non-voided event for one product, plus where each id came from.

    Voided rows are simply absent - that is the whole mechanism by which voiding works.
    """
    events: list[Event] = []
    sources: dict[uuid.UUID, _SourceKind] = {}

    # Derived purchases retain non-null accounting columns, even when the inherited
    # transformation basis is unknown. Its explicit null share is authoritative for
    # FIFO: a zero placeholder must not turn an unknown-cost hit into a free asset.
    unknown_derived = set(
        db.scalars(
            select(TransformationOutput.purchase_id).where(
                TransformationOutput.product_id == product_id,
                TransformationOutput.cost_cents.is_(None),
            )
        )
    )

    for purchase in db.scalars(_active(Purchase, product_id)):
        events.append(
            Event(
                id=purchase.id,
                quantity=purchase.quantity,
                is_supply=True,
                occurred_on=purchase.purchase_date,
                created_at=purchase.created_at,
                landed_cost_cents=(
                    None
                    if purchase.is_derived and purchase.id in unknown_derived
                    else purchase.landed_cost_cents
                ),
            )
        )
        sources[purchase.id] = "purchase"

    for sale in db.scalars(_active(Sale, product_id)):
        events.append(
            Event(
                id=sale.id,
                quantity=sale.quantity,
                is_supply=False,
                occurred_on=sale.sale_date,
                created_at=sale.created_at,
            )
        )
        sources[sale.id] = "sale"

    for adjustment in db.scalars(_active(InventoryAdjustment, product_id)):
        adds_stock = adjustment.quantity_delta > 0
        events.append(
            Event(
                id=adjustment.id,
                quantity=abs(adjustment.quantity_delta),
                is_supply=adds_stock,
                occurred_on=adjustment.adjustment_date,
                created_at=adjustment.created_at,
                landed_cost_cents=adjustment.landed_cost_cents if adds_stock else None,
            )
        )
        sources[adjustment.id] = "adjustment_supply" if adds_stock else "adjustment_consumer"

    return events, sources


def lock_products(db: Session, product_ids: Iterable[uuid.UUID]) -> None:
    """Serialize related stock operations in one consistent UUID order."""
    db.execute(
        select(Product.id)
        .where(Product.id.in_(set(product_ids)))
        .order_by(Product.id)
        .with_for_update()
    )


def recompute_product(db: Session, product_id: uuid.UUID) -> None:
    """Rebuild this product's cost allocations from its complete history.

    Takes a row lock on the product first so two concurrent writes cannot interleave and
    produce allocations from two different views of history.
    """
    lock_products(db, [product_id])

    events, sources = load_events(db, product_id)
    result = allocate(events)

    db.execute(delete(CostAllocation).where(CostAllocation.product_id == product_id))

    for allocation in result.allocations:
        columns: dict[str, Any] = {
            "product_id": product_id,
            "quantity": allocation.quantity,
            "cost_cents": allocation.cost_cents,
        }
        consumer_kind = sources[allocation.consumer_id]
        if consumer_kind == "sale":
            columns["sale_id"] = allocation.consumer_id
        else:
            columns["adjustment_consumer_id"] = allocation.consumer_id

        if allocation.supply_id is not None:
            supply_kind = sources[allocation.supply_id]
            if supply_kind == "purchase":
                columns["purchase_id"] = allocation.supply_id
            else:
                columns["adjustment_supply_id"] = allocation.supply_id

        db.add(CostAllocation(**columns))

    # Write the per-consumer answer back so reads never have to re-run the engine.
    for sale in db.scalars(_active(Sale, product_id)):
        outcome = result.consumers.get(sale.id)
        sale.cost_basis_cents = outcome.cost_basis_cents if outcome else None
        sale.has_unknown_cost = bool(outcome and outcome.has_unknown_cost)
        sale.days_held_weighted = outcome.days_held_weighted if outcome else None

    for adjustment in db.scalars(_active(InventoryAdjustment, product_id)):
        outcome = result.consumers.get(adjustment.id)
        adjustment.cost_removed_cents = outcome.cost_basis_cents if outcome else None
        adjustment.has_unknown_cost = bool(outcome and outcome.has_unknown_cost)

    db.flush()


def record_audit(
    db: Session,
    *,
    entity_type: EntityKind,
    entity_id: uuid.UUID,
    action: str,
    member_id: uuid.UUID | None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    reason: str | None = None,
) -> None:
    db.add(
        AuditLog(
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            member_id=member_id,
            before=before,
            after=after,
            reason=reason,
        )
    )


def snapshot(
    entity: Purchase | Sale | InventoryAdjustment | StockMove, fields: list[str]
) -> dict[str, Any]:
    """JSON-safe view of the fields an audit entry cares about."""
    values: dict[str, Any] = {}
    for name in fields:
        value = getattr(entity, name)
        values[name] = value.isoformat() if hasattr(value, "isoformat") else value
    return values


def void(
    db: Session,
    entity: Purchase | Sale | InventoryAdjustment | StockMove,
    *,
    entity_type: EntityKind,
    member_id: uuid.UUID | None,
    reason: str | None,
) -> None:
    """Retire a transaction without deleting it, then rebuild the product's costs."""
    # Every ledger mutation must take the product lock before touching its child row.
    # Otherwise an edit can hold Product while this path holds Sale/Purchase/etc. and
    # both sides wait on the other's recomputation/flush.
    lock_products(db, [entity.product_id])
    entity_model = type(entity)
    locked_entity = db.scalar(
        select(entity_model)
        .where(entity_model.id == entity.id)
        .with_for_update()
    )
    if locked_entity is None:
        raise HTTPException(status_code=404, detail=f"{entity_type.title()} not found")
    db.refresh(entity)
    if entity.status != STATUS_ACTIVE:
        raise HTTPException(status_code=409, detail=f"This {entity_type} has already been voided")
    entity.status = STATUS_VOIDED
    entity.void_reason = reason
    db.flush()
    # A move carries no money and consumes no lots, so there is nothing for the costing
    # engine to rebuild. Recomputing would return the identical answer and imply, wrongly,
    # that where stock sits affects what it cost.
    if not isinstance(entity, StockMove):
        recompute_product(db, entity.product_id)
    record_audit(
        db,
        entity_type=entity_type,
        entity_id=entity.id,
        action="void",
        member_id=member_id,
        before={"status": STATUS_ACTIVE},
        after={"status": STATUS_VOIDED},
        reason=reason,
    )


def delete_product(db: Session, product: Product, *, member_id: uuid.UUID | None) -> None:
    """Remove a product that should never have existed, and everything recorded against it.

    For test entries and duplicates: one step instead of voiding each purchase and sale one
    by one. Its purchases, sales, moves, adjustments, cost allocations and the money that
    funded or came from them all go, voided rows included. The audit row left behind lists
    what was removed, and keeps a full copy of it so `restore_product` can put it back.

    A product that was opened or sent for grading is refused: those link it to other
    products' stock and cost, and removing one side would corrupt the other.
    """
    lock_products(db, [product.id])

    linked = (
        select(Transformation.id).where(Transformation.source_product_id == product.id),
        select(TransformationOutput.id).where(TransformationOutput.product_id == product.id),
        select(GradingSubmission.id).where(GradingSubmission.product_id == product.id),
    )
    if any(db.scalar(query.limit(1)) for query in linked):
        raise HTTPException(
            status_code=409,
            detail=(
                "This product was opened or sent for grading, which ties it to other "
                "products. Void that first, or archive the product instead."
            ),
        )

    purchases = db.scalars(
        select(Purchase).where(Purchase.product_id == product.id).order_by(Purchase.created_at)
    ).all()
    sales = db.scalars(
        select(Sale).where(Sale.product_id == product.id).order_by(Sale.created_at)
    ).all()
    purchase_ids = [purchase.id for purchase in purchases]
    sale_ids = [sale.id for sale in sales]

    def as_text(value: uuid.UUID | None) -> str | None:
        return str(value) if value else None

    before = {
        "name": product.name,
        "purchases": [
            {
                **snapshot(purchase, ["quantity", "purchase_date", "source", "status"]),
                "landed_cost_cents": purchase.landed_cost_cents,
                "purchased_by_member_id": as_text(purchase.purchased_by_member_id),
            }
            for purchase in purchases
        ],
        "sales": [
            {
                **snapshot(sale, ["quantity", "gross_amount_cents", "sale_date", "status"]),
                "sold_by_member_id": as_text(sale.sold_by_member_id),
            }
            for sale in sales
        ],
        "records": recovery.capture(db, product.id),
    }

    # Children before parents. Money postings go with their movement (ON DELETE CASCADE);
    # catalog mappings and market prices go with the product the same way.
    db.execute(delete(CostAllocation).where(CostAllocation.product_id == product.id))
    db.execute(
        delete(MoneyMovement).where(
            MoneyMovement.purchase_id.in_(purchase_ids) | MoneyMovement.sale_id.in_(sale_ids)
        )
    )
    for model in (StockMove, Sale, InventoryAdjustment, Purchase, PriceSnapshot):
        db.execute(delete(model).where(model.product_id == product.id))

    record_audit(
        db,
        entity_type="product",
        entity_id=product.id,
        action=ACTION_DELETE,
        member_id=member_id,
        before=before,
    )
    db.delete(product)
    db.flush()


def restore_product(db: Session, entry: AuditLog, *, member_id: uuid.UUID | None) -> uuid.UUID:
    """Put a deleted product back exactly as it was, from the copy its delete row kept.

    A last resort for a delete that should not have happened. Everything returns with its
    original ids, then FIFO is rebuilt so cost and profit match what they were.
    """
    before = entry.before or {}
    records = before.get("records")
    if records is None:
        raise HTTPException(
            status_code=409,
            detail="This product was deleted before deletes kept a full copy, so it cannot "
            "be put back.",
        )
    if db.get(Product, entry.entity_id) is not None:
        raise HTTPException(status_code=409, detail="This product is already back.")

    try:
        with db.begin_nested():
            recovery.restore(db, records)
    except IntegrityError as error:
        raise HTTPException(
            status_code=409,
            detail="Something this product was recorded against no longer exists, so it "
            "cannot be put back.",
        ) from error

    recompute_product(db, entry.entity_id)
    record_audit(
        db,
        entity_type="product",
        entity_id=entry.entity_id,
        action=ACTION_RESTORE,
        member_id=member_id,
        after={"name": before.get("name"), "from_delete": str(entry.id)},
    )
    db.flush()
    return entry.entity_id
