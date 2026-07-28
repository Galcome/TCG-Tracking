"""Ledger write paths: persistence, recomputation, and the audit trail.

This is the only module that writes to the ledger tables. Every mutating path ends in
`recompute_product`, so cost basis and stock can never drift from the transactions that
produced them.

The pure allocation logic lives in `costing.py`; this module's job is loading events out of
the database, handing them over, and writing the answer back.
"""

from __future__ import annotations

import uuid
from typing import Any, Literal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from src.models.audit import AuditLog
from src.models.ledger import (
    STATUS_ACTIVE,
    STATUS_VOIDED,
    CostAllocation,
    InventoryAdjustment,
    Purchase,
    Sale,
)
from src.models.product import Product
from src.services.costing import Event, allocate

EntityKind = Literal["purchase", "sale", "adjustment"]

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

    for purchase in db.scalars(_active(Purchase, product_id)):
        events.append(
            Event(
                id=purchase.id,
                quantity=purchase.quantity,
                is_supply=True,
                occurred_on=purchase.purchase_date,
                created_at=purchase.created_at,
                landed_cost_cents=purchase.landed_cost_cents,
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


def recompute_product(db: Session, product_id: uuid.UUID) -> None:
    """Rebuild this product's cost allocations from its complete history.

    Takes a row lock on the product first so two concurrent writes cannot interleave and
    produce allocations from two different views of history.
    """
    db.execute(select(Product.id).where(Product.id == product_id).with_for_update())

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


def snapshot(entity: Purchase | Sale | InventoryAdjustment, fields: list[str]) -> dict[str, Any]:
    """JSON-safe view of the fields an audit entry cares about."""
    values: dict[str, Any] = {}
    for name in fields:
        value = getattr(entity, name)
        values[name] = value.isoformat() if hasattr(value, "isoformat") else value
    return values


def void(
    db: Session,
    entity: Purchase | Sale | InventoryAdjustment,
    *,
    entity_type: EntityKind,
    member_id: uuid.UUID | None,
    reason: str | None,
) -> None:
    """Retire a transaction without deleting it, then rebuild the product's costs."""
    entity.status = STATUS_VOIDED
    entity.void_reason = reason
    db.flush()
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
