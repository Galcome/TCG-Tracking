"""Turning stock of one product into stock of another.

Built once because it is one operation three times over: a case becomes boxes, a box becomes
cards, a raw card becomes a graded card. What differs between them is how the cost is split,
so that is the only thing a caller supplies.

The mechanics are deliberately ordinary ledger rows. Consuming the source is a negative
adjustment; producing each output is a purchase. Nothing here invents a second way to hold
stock or cost, so FIFO, the ageing report and every per-product figure keep working without
knowing transformations exist.

Two things travel across, and everything downstream depends on them:

**The original purchase date.** The outputs are dated from the lot the source came out of,
not from the day it was opened. Cracking a case on its first birthday must not make six
brand-new boxes - the money has been asleep for a year either way.

**Parentage.** `transformation_outputs` records what came from what, which is the only
reason a graded hit can later be traced back to the case that produced it.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.models.ledger import (
    STATUS_ACTIVE,
    STATUS_VOIDED,
    CostAllocation,
    InventoryAdjustment,
    Purchase,
)
from src.models.product import Product
from src.models.transformation import Transformation, TransformationOutput
from src.services import inventory, ledger
from src.services.costing import split_cost

#: The reason a consuming adjustment carries. Kept apart from `written_off` because the
#: cost did not evaporate - it moved to whatever came out.
REASON_TRANSFORMED = "transformed"


#: A card is not a container. Cracking or ripping one consumed it and produced "boxes" out
#: of a single, splitting its cost across them and writing the lineage - and until this
#: existed, nothing anywhere refused. `kind` was a label on a record, never a constraint.
_NOT_A_CONTAINER = frozenset({"single", "raw-single", "graded-card"})

#: A case is opened into boxes, never one card at a time. A pack has nothing sealed inside
#: it, so there is nothing to crack it into.
CANNOT_BE_CRACKED = _NOT_A_CONTAINER | {"booster-pack"}
CANNOT_BE_RIPPED = _NOT_A_CONTAINER | {"sealed-case"}

#: Deliberately deny-lists. `lot`, `collection`, `box-set`, `binder`, `deck` and `other`
#: stay permitted because nobody can say what they hold, and blocking a real workflow is a
#: worse failure than allowing an odd one. Only the genuinely impossible is refused.
_REFUSALS = {
    "crack": (CANNOT_BE_CRACKED, "cracked open"),
    "rip": (CANNOT_BE_RIPPED, "ripped open"),
}


def opening_refusal(db: Session, product_id: uuid.UUID, kind: str) -> str | None:
    """Why this product cannot be opened that way, or `None` when it can.

    Grading is never refused here: sending a raw single away and getting a slab back is
    exactly what that kind is for.
    """
    rule = _REFUSALS.get(kind)
    if rule is None:
        return None

    forbidden, verb = rule
    product = db.get(Product, product_id)
    if product is None:
        return None

    slug = product.product_type.slug
    if slug not in forbidden:
        return None
    return f"A {product.product_type.name} cannot be {verb}."


@dataclass(frozen=True)
class OutputSpec:
    """One product coming out, in one bucket. Same product in two buckets is two specs."""

    product_id: uuid.UUID
    quantity: int
    bucket: str


def source_purchase_date(db: Session, product_id: uuid.UUID) -> date | None:
    """The date the outputs should inherit: the oldest lot this product still has stock in.

    FIFO consumes the oldest lot first, so that is the one being opened. Undated lots
    return None, which stays None - inventing a date to make the ageing report look tidier
    is exactly the kind of invention this app refuses everywhere else.
    """
    consumed = (
        select(
            CostAllocation.purchase_id.label("purchase_id"),
            func.sum(CostAllocation.quantity).label("used"),
        )
        .where(CostAllocation.purchase_id.is_not(None))
        .group_by(CostAllocation.purchase_id)
        .subquery()
    )

    return db.scalar(
        select(Purchase.purchase_date)
        .outerjoin(consumed, consumed.c.purchase_id == Purchase.id)
        .where(
            Purchase.product_id == product_id,
            Purchase.status == STATUS_ACTIVE,
            Purchase.quantity - func.coalesce(consumed.c.used, 0) > 0,
        )
        .order_by(Purchase.purchase_date.asc().nullsfirst(), Purchase.created_at.asc())
        .limit(1)
    )


def transform(
    db: Session,
    *,
    kind: str,
    source_product_id: uuid.UUID,
    source_quantity: int,
    source_bucket: str,
    outputs: list[OutputSpec],
    costs: list[int] | None = None,
    added_cost: int = 0,
    occurred_on: date | None,
    member_id: uuid.UUID | None,
    notes: str | None = None,
) -> Transformation:
    """Consume the source, produce the outputs, carry the cost and the date across.

    `costs` lets a caller decide each row's share itself. The rip screen does, because a
    box is a lottery rather than a division: three hits at $500, $50 and $10 split a $150
    box $134 / $13 / $3, so the big hit carries the risk it earned and each card's ROI
    stands on its own. Whatever the hits do not take is written off as bulk.

    Omitted, the source's cost is divided across the produced *units* with a
    largest-remainder split, so six boxes out of a $100 case come to
    1667 + 1667 + 1667 + 1667 + 1666 + 1666 and sum back exactly.

    `added_cost` is money spent to make the transformation happen - grading fees, shipping,
    insurance. It joins what the outputs carry, because the card really has absorbed it.

    A source whose cost is genuinely unknown produces outputs whose cost is unknown too.
    Spreading a zero would say the boxes were free, which is a different claim.
    """
    record = Transformation(
        kind=kind,
        source_product_id=source_product_id,
        source_quantity=source_quantity,
        source_bucket=source_bucket,
        occurred_on=occurred_on,
        inherited_purchase_date=source_purchase_date(db, source_product_id),
        notes=notes,
        created_by_member_id=member_id,
    )
    db.add(record)
    db.flush()

    # Take the source out of stock first, then read what FIFO says it cost. Doing it in
    # that order means the cost carried across is the engine's own answer rather than a
    # second calculation that could disagree with it.
    consuming = InventoryAdjustment(
        product_id=source_product_id,
        quantity_delta=-source_quantity,
        reason=REASON_TRANSFORMED,
        adjustment_date=occurred_on,
        bucket=source_bucket,
        member_id=member_id,
        created_by_member_id=member_id,
        notes=notes,
    )
    db.add(consuming)
    db.flush()
    ledger.recompute_product(db, source_product_id)
    db.refresh(consuming)

    record.consuming_adjustment_id = consuming.id
    record.source_cost_cents = None if consuming.has_unknown_cost else consuming.cost_removed_cents

    # Money spent to make the transformation happen - grading fees, shipping, insurance.
    # It joins the outputs' cost basis because the card really has absorbed it, and leaving
    # it out would overstate every graded card's ROI by roughly the fee.
    carried = record.source_cost_cents
    if added_cost and carried is not None:
        carried += added_cost

    shares: list[int | None]
    if costs is not None:
        shares = list(costs)
        # Anything the outputs did not take is bulk, and bulk is written off here rather
        # than carried as an asset nobody would ever choose to acquire.
        record.bulk_cost_cents = max((record.source_cost_cents or 0) - sum(costs), 0)
    else:
        shares = _shares(carried, outputs)

    for spec, share in zip(outputs, shares):
        produced = Purchase(
            product_id=spec.product_id,
            quantity=spec.quantity,
            gross_amount_cents=max((share or 0) - added_cost, 0),
            # New money, kept apart from the carried gross so the dashboard can tell
            # spending from cost that merely moved.
            fees_cents=added_cost if share is not None else 0,
            # The whole point. Not `occurred_on`.
            purchase_date=record.inherited_purchase_date,
            purchased_by_member_id=member_id,
            created_by_member_id=member_id,
            bucket=spec.bucket,
            source=f"{kind} of {source_product_id}",
            is_derived=True,
        )
        db.add(produced)
        db.flush()

        db.add(
            TransformationOutput(
                transformation_id=record.id,
                product_id=spec.product_id,
                quantity=spec.quantity,
                bucket=spec.bucket,
                cost_cents=share,
                purchase_id=produced.id,
            )
        )
        ledger.recompute_product(db, spec.product_id)

    db.flush()
    ledger.record_audit(
        db,
        entity_type="transformation",
        entity_id=record.id,
        action="create",
        member_id=member_id,
        after={
            "kind": kind,
            "source_quantity": source_quantity,
            "outputs": len(outputs),
            "source_cost_cents": record.source_cost_cents,
        },
    )
    return record


def _shares(source_cost: int | None, outputs: list[OutputSpec]) -> list[int | None]:
    """Each output row's share of the source's cost, by unit count."""
    if source_cost is None:
        # Unknown stays unknown. Spreading a zero would claim the outputs were free.
        return [None] * len(outputs)

    units = sum(spec.quantity for spec in outputs)
    per_unit = split_cost(source_cost, units)

    shares: list[int | None] = []
    cursor = 0
    for spec in outputs:
        shares.append(sum(per_unit[cursor : cursor + spec.quantity]))
        cursor += spec.quantity
    return shares


def void(
    db: Session,
    record: Transformation,
    *,
    member_id: uuid.UUID | None,
    reason: str | None,
) -> None:
    """Undo it: the source comes back, the outputs go away.

    The rows stay. A voided transformation is the explanation for stock reappearing, and
    the audit trail is what makes the mistake recoverable rather than just gone.
    """
    record.status = STATUS_VOIDED
    record.void_reason = reason

    touched = {record.source_product_id}

    if record.consuming_adjustment_id is not None:
        consuming = db.get(InventoryAdjustment, record.consuming_adjustment_id)
        if consuming is not None and consuming.status == STATUS_ACTIVE:
            consuming.status = STATUS_VOIDED
            consuming.void_reason = reason

    for output in db.scalars(
        select(TransformationOutput).where(
            TransformationOutput.transformation_id == record.id
        )
    ):
        if output.purchase_id is None:  # pragma: no cover - always set on create
            continue
        produced = db.get(Purchase, output.purchase_id)
        if produced is not None and produced.status == STATUS_ACTIVE:
            produced.status = STATUS_VOIDED
            produced.void_reason = reason
            touched.add(produced.product_id)

    db.flush()
    for product_id in touched:
        ledger.recompute_product(db, product_id)

    ledger.record_audit(
        db,
        entity_type="transformation",
        entity_id=record.id,
        action="void",
        member_id=member_id,
        before={"status": STATUS_ACTIVE},
        after={"status": STATUS_VOIDED},
        reason=reason,
    )


def available_in_bucket(db: Session, product_id: uuid.UUID, bucket: str) -> int:
    """How much of this product is in that bucket, for refusing impossible sources."""
    stats = inventory.product_stats(db, [product_id]).get(product_id)
    return stats.by_bucket.get(bucket, 0) if stats else 0
