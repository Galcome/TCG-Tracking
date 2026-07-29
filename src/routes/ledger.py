"""Purchase, sale and inventory-adjustment endpoints.

Every mutating handler ends in `ledger.recompute_product`, so stock and cost basis are
always a consequence of the transactions rather than a number someone typed.

Permissions are deliberately flat: any member may edit or void. Three trusted people do not
need an approval bottleneck, and the audit log - not a role check - is what makes a mistake
recoverable.
"""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.dependencies import db_session, get_current_member
from src.models.ledger import STATUS_ACTIVE, InventoryAdjustment, Purchase, Sale
from src.models.member import Member
from src.models.product import Product
from src.models.taxonomy import Game
from src.schemas.ledger import (
    AdjustmentCreate,
    AdjustmentRead,
    PurchaseCreate,
    PurchaseRead,
    PurchaseUpdate,
    SaleCreate,
    SaleList,
    SaleListItem,
    SaleRead,
    SaleUpdate,
    VoidRequest,
)
from src.services import inventory, ledger, reporting
from src.services.search import escape_like

router = APIRouter()

#: Request field -> ORM column, for the fields whose names differ.
PURCHASE_FIELDS = {
    "quantity": "quantity",
    "amount": "gross_amount_cents",
    "shipping": "shipping_cents",
    "tax": "tax_cents",
    "fees": "fees_cents",
    "purchase_date": "purchase_date",
    "purchased_by_member_id": "purchased_by_member_id",
    "source": "source",
    "notes": "notes",
}

DEFAULT_SALE_LIMIT = 50
MAX_SALE_LIMIT = 200

#: Marketplace value used when a sale never recorded where it sold.
UNSPECIFIED_MARKETPLACE = "Unspecified"


def _sale_filters(
    q: str | None,
    marketplace: str | None,
    sold_by_member_id: uuid.UUID | None,
    game: str | None,
    period: str,
) -> list:
    """Shared WHERE clauses so the count and the page can never disagree."""
    filters: list = []

    search = (q or "").strip()
    if search:
        filters.append(Product.search_text.ilike(f"%{escape_like(search)}%", escape="\\"))

    if marketplace:
        # "Unspecified" is a display label for NULL, not a stored value.
        if marketplace == UNSPECIFIED_MARKETPLACE:
            filters.append(Sale.marketplace.is_(None))
        else:
            filters.append(Sale.marketplace == marketplace)

    if sold_by_member_id is not None:
        filters.append(Sale.sold_by_member_id == sold_by_member_id)

    if game:
        filters.append(Product.game_id.in_(select(Game.id).where(Game.slug == game)))

    start = reporting.period_start(period)
    if start is not None:
        # Undated sales cannot belong to a period; excluding them is the same rule the
        # dashboard uses, so the two never disagree.
        filters.append(Sale.sale_date.is_not(None))
        filters.append(Sale.sale_date >= start)

    return filters


SALE_FIELDS = {
    "quantity": "quantity",
    "amount": "gross_amount_cents",
    "platform_fees": "platform_fees_cents",
    "payment_fees": "payment_fees_cents",
    "shipping_paid": "shipping_paid_cents",
    "sale_date": "sale_date",
    "sold_by_member_id": "sold_by_member_id",
    "marketplace": "marketplace",
    "notes": "notes",
}


def _require_product(db: Session, product_id: uuid.UUID) -> Product:
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return product


def _require_active(db: Session, model, record_id: uuid.UUID, label: str):
    record = db.get(model, record_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{label} not found")
    if record.status != STATUS_ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This {label.lower()} has been voided and can no longer be changed",
        )
    return record


def _guard_oversell(
    db: Session,
    product_id: uuid.UUID,
    quantity: int,
    allow: bool,
    *,
    already_counted: int = 0,
) -> None:
    """Refuse to sell stock that was never recorded, unless asked explicitly.

    `already_counted` lets an edit ignore the quantity the sale currently holds, so
    changing a sale of 3 to 4 only needs one more unit available, not four.
    """
    if allow:
        return
    available = inventory.quantity_on_hand(db, product_id) + already_counted
    if quantity > available:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Only {available} in stock. Record the purchase first, or resend with "
                f"allow_oversell to book it anyway."
            ),
        )


def _apply(record, changes: dict[str, Any], mapping: dict[str, str]) -> dict[str, Any]:
    """Write mapped fields onto the ORM row, returning the previous values."""
    before: dict[str, Any] = {}
    for field, column in mapping.items():
        if field not in changes:
            continue
        previous = getattr(record, column)
        before[column] = previous.isoformat() if hasattr(previous, "isoformat") else previous
        setattr(record, column, changes[field])
    return before


def _after(record, before: dict[str, Any]) -> dict[str, Any]:
    return {
        column: (
            getattr(record, column).isoformat()
            if hasattr(getattr(record, column), "isoformat")
            else getattr(record, column)
        )
        for column in before
    }


# ----------------------------------------------------------------------- purchases


@router.post("/purchases", response_model=PurchaseRead, status_code=status.HTTP_201_CREATED)
def create_purchase(
    payload: PurchaseCreate,
    member: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> Purchase:
    _require_product(db, payload.product_id)

    purchase = Purchase(
        product_id=payload.product_id,
        quantity=payload.quantity,
        gross_amount_cents=payload.amount,
        shipping_cents=payload.shipping,
        tax_cents=payload.tax,
        fees_cents=payload.fees,
        purchase_date=payload.purchase_date,
        purchased_by_member_id=payload.purchased_by_member_id or member.id,
        source=payload.source,
        notes=payload.notes,
        created_by_member_id=member.id,
    )
    db.add(purchase)
    db.flush()
    ledger.recompute_product(db, purchase.product_id)
    ledger.record_audit(
        db,
        entity_type="purchase",
        entity_id=purchase.id,
        action="create",
        member_id=member.id,
        after=ledger.snapshot(purchase, ["quantity", "gross_amount_cents", "purchase_date"]),
    )
    return purchase


@router.patch("/purchases/{purchase_id}", response_model=PurchaseRead)
def update_purchase(
    purchase_id: uuid.UUID,
    payload: PurchaseUpdate,
    member: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> Purchase:
    purchase = _require_active(db, Purchase, purchase_id, "Purchase")
    changes = payload.model_dump(exclude_unset=True)
    reason = changes.pop("reason", None)

    before = _apply(purchase, changes, PURCHASE_FIELDS)
    db.flush()
    ledger.recompute_product(db, purchase.product_id)
    ledger.record_audit(
        db,
        entity_type="purchase",
        entity_id=purchase.id,
        action="update",
        member_id=member.id,
        before=before,
        after=_after(purchase, before),
        reason=reason,
    )
    return purchase


@router.post("/purchases/{purchase_id}/void", response_model=PurchaseRead)
def void_purchase(
    purchase_id: uuid.UUID,
    payload: VoidRequest,
    member: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> Purchase:
    purchase = _require_active(db, Purchase, purchase_id, "Purchase")
    ledger.void(
        db, purchase, entity_type="purchase", member_id=member.id, reason=payload.reason
    )
    return purchase


# --------------------------------------------------------------------------- sales


@router.get("/sales", response_model=SaleList)
def list_sales(
    q: str | None = Query(default=None, max_length=200, description="Product name"),
    marketplace: str | None = Query(default=None, max_length=120),
    sold_by_member_id: uuid.UUID | None = Query(default=None),
    game: str | None = Query(default=None, max_length=60, description="Game slug"),
    period: str = Query(default=reporting.PERIOD_ALL, pattern="^(all|ytd|mtd|30d)$"),
    limit: int = Query(default=DEFAULT_SALE_LIMIT, ge=1, le=MAX_SALE_LIMIT),
    offset: int = Query(default=0, ge=0),
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> SaleList:
    """The sales ledger across every product.

    Voided sales are included and flagged via `status` rather than hidden - a voided sale
    is the explanation for a number changing, so the ledger has to show it.
    """
    filters = _sale_filters(q, marketplace, sold_by_member_id, game, period)

    total = db.scalar(
        select(func.count())
        .select_from(Sale)
        .join(Product, Product.id == Sale.product_id)
        .where(*filters)
    )

    # Newest first. created_at breaks ties so paging is stable, and an explicit order is
    # required before any limit().
    rows = db.scalars(
        select(Sale)
        .join(Product, Product.id == Sale.product_id)
        .where(*filters)
        .order_by(Sale.sale_date.desc().nullslast(), Sale.created_at.desc(), Sale.id.desc())
        .limit(limit)
        .offset(offset)
    ).unique().all()

    # One extra query for every product on this page, rather than one per row.
    products = {
        product.id: product
        for product in db.scalars(
            select(Product).where(Product.id.in_({row.product_id for row in rows}))
        ).unique()
    }
    for sale in rows:
        sale.product = products[sale.product_id]

    return SaleList(
        items=[SaleListItem.model_validate(row, from_attributes=True) for row in rows],
        total=total or 0,
        limit=limit,
        offset=offset,
    )


@router.post("/sales", response_model=SaleRead, status_code=status.HTTP_201_CREATED)
def create_sale(
    payload: SaleCreate,
    member: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> Sale:
    _require_product(db, payload.product_id)
    _guard_oversell(db, payload.product_id, payload.quantity, payload.allow_oversell)

    sale = Sale(
        product_id=payload.product_id,
        quantity=payload.quantity,
        gross_amount_cents=payload.amount,
        platform_fees_cents=payload.platform_fees,
        payment_fees_cents=payload.payment_fees,
        shipping_paid_cents=payload.shipping_paid,
        sale_date=payload.sale_date,
        sold_by_member_id=payload.sold_by_member_id or member.id,
        marketplace=payload.marketplace,
        notes=payload.notes,
        created_by_member_id=member.id,
    )
    db.add(sale)
    db.flush()
    ledger.recompute_product(db, sale.product_id)
    ledger.record_audit(
        db,
        entity_type="sale",
        entity_id=sale.id,
        action="create",
        member_id=member.id,
        after=ledger.snapshot(sale, ["quantity", "gross_amount_cents", "sale_date"]),
    )
    db.refresh(sale)
    return sale


@router.patch("/sales/{sale_id}", response_model=SaleRead)
def update_sale(
    sale_id: uuid.UUID,
    payload: SaleUpdate,
    member: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> Sale:
    sale = _require_active(db, Sale, sale_id, "Sale")
    changes = payload.model_dump(exclude_unset=True)
    reason = changes.pop("reason", None)

    if "quantity" in changes:
        _guard_oversell(
            db, sale.product_id, changes["quantity"], False, already_counted=sale.quantity
        )

    before = _apply(sale, changes, SALE_FIELDS)
    db.flush()
    ledger.recompute_product(db, sale.product_id)
    ledger.record_audit(
        db,
        entity_type="sale",
        entity_id=sale.id,
        action="update",
        member_id=member.id,
        before=before,
        after=_after(sale, before),
        reason=reason,
    )
    db.refresh(sale)
    return sale


@router.post("/sales/{sale_id}/void", response_model=SaleRead)
def void_sale(
    sale_id: uuid.UUID,
    payload: VoidRequest,
    member: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> Sale:
    sale = _require_active(db, Sale, sale_id, "Sale")
    ledger.void(db, sale, entity_type="sale", member_id=member.id, reason=payload.reason)
    db.refresh(sale)
    return sale


# --------------------------------------------------------------------- adjustments


@router.post("/adjustments", response_model=AdjustmentRead, status_code=status.HTTP_201_CREATED)
def create_adjustment(
    payload: AdjustmentCreate,
    member: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> InventoryAdjustment:
    _require_product(db, payload.product_id)

    adjustment = InventoryAdjustment(
        product_id=payload.product_id,
        quantity_delta=payload.quantity_delta,
        reason=payload.reason,
        landed_cost_cents=payload.cost,
        adjustment_date=payload.adjustment_date,
        member_id=payload.member_id or member.id,
        notes=payload.notes,
        created_by_member_id=member.id,
    )
    db.add(adjustment)
    db.flush()
    ledger.recompute_product(db, adjustment.product_id)
    ledger.record_audit(
        db,
        entity_type="adjustment",
        entity_id=adjustment.id,
        action="create",
        member_id=member.id,
        after=ledger.snapshot(adjustment, ["quantity_delta", "reason", "adjustment_date"]),
        reason=payload.reason,
    )
    db.refresh(adjustment)
    return adjustment


@router.post("/adjustments/{adjustment_id}/void", response_model=AdjustmentRead)
def void_adjustment(
    adjustment_id: uuid.UUID,
    payload: VoidRequest,
    member: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> InventoryAdjustment:
    adjustment = _require_active(db, InventoryAdjustment, adjustment_id, "Adjustment")
    ledger.void(
        db, adjustment, entity_type="adjustment", member_id=member.id, reason=payload.reason
    )
    db.refresh(adjustment)
    return adjustment
