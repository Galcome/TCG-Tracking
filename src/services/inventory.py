"""Derived inventory and performance figures.

Nothing here is stored. Stock, cost basis and profit are aggregated from the ledger every
time they are asked for, so there is no counter that can silently drift from the
transactions underneath it.

Quantity does not need FIFO - it is just supply minus consumption - so it is a plain SQL
aggregate. Cost basis does need FIFO, but the engine has already written its answer into
`cost_allocations`, so the aggregates read that rather than re-running it per product.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from sqlalchemy import Select, case, func, select, union_all
from sqlalchemy.orm import Session
from sqlalchemy.sql import Subquery

from src.models.ledger import (
    BUCKETS,
    STATUS_ACTIVE,
    CostAllocation,
    InventoryAdjustment,
    Purchase,
    Sale,
    StockMove,
)

#: Cost leaving a product because it became another one. Part of the ledger model's
#: reason list; named here so the aggregate can tell it from a real write-off.
REASON_TRANSFORMED = "transformed"


@dataclass
class ProductStats:
    """Everything the UI shows about one product's position."""

    quantity_purchased: int = 0
    quantity_sold: int = 0
    quantity_adjusted: int = 0  #: net, signed
    quantity_on_hand: int = 0

    total_invested_cents: int = 0  #: landed cost of every purchase, ever
    remaining_cost_cents: int = 0  #: cost basis still sitting in stock
    cost_of_sales_cents: int = 0  #: cost basis of units actually sold
    cost_written_off_cents: int = 0  #: cost removed by negative adjustments
    #: Cost that left this product by becoming another one. A cracked case did not
    #: lose its $900; the boxes have it. Reported apart from real write-offs, and
    #: subtracted from remaining cost just the same.
    cost_transformed_cents: int = 0

    gross_revenue_cents: int = 0
    net_proceeds_cents: int = 0
    #: Net proceeds of known-cost sales only - the only ones profit can be computed for.
    net_proceeds_cents_known: int = 0

    sale_count: int = 0
    sales_missing_cost: int = 0

    #: Stock split by bucket. Sums to `quantity_on_hand`, because a move takes from one
    #: bucket and gives to another and so nets to zero.
    by_bucket: dict[str, int] = field(default_factory=lambda: dict.fromkeys(BUCKETS, 0))

    @property
    def realized_profit_cents(self) -> int:
        """Profit from sales whose cost is known. Excludes write-offs by design."""
        return self.net_proceeds_cents_known - self.cost_of_sales_cents

    @property
    def roi(self) -> float | None:
        if self.cost_of_sales_cents <= 0:
            return None
        return self.realized_profit_cents / self.cost_of_sales_cents

    @property
    def average_unit_cost_cents(self) -> int | None:
        if self.quantity_on_hand <= 0:
            return None
        return round(self.remaining_cost_cents / self.quantity_on_hand)


def stock_totals() -> Subquery:
    """Per-product stock, per bucket, as a subquery the database can filter and page on.

    The same supply-minus-consumption arithmetic `product_stats` does in Python, expressed
    in SQL so the inventory list does not have to load the whole catalogue to answer "which
    of these are in stock". `product_stats` stays as it is: it computes cost basis and
    profit as well, and that is only ever wanted for one page at a time.

    Columns: `product_id`, `on_hand`, and one per bucket. A product with no transactions has
    no row at all, so every reader has to coalesce - which is correct, because no rows means
    zero of everything.
    """
    # A move is the one row that touches two buckets, so it appears twice: out of
    # `from_bucket` and into `bucket`. It nets to zero in `on_hand`, which is the point.
    pieces = [
        select(
            Purchase.product_id.label("product_id"),
            Purchase.bucket.label("bucket"),
            Purchase.quantity.label("delta"),
        ).where(Purchase.status == STATUS_ACTIVE),
        select(Sale.product_id, Sale.bucket, -Sale.quantity).where(Sale.status == STATUS_ACTIVE),
        select(
            InventoryAdjustment.product_id,
            InventoryAdjustment.bucket,
            InventoryAdjustment.quantity_delta,
        ).where(InventoryAdjustment.status == STATUS_ACTIVE),
        select(StockMove.product_id, StockMove.bucket, StockMove.quantity).where(
            StockMove.status == STATUS_ACTIVE
        ),
        select(StockMove.product_id, StockMove.from_bucket, -StockMove.quantity).where(
            StockMove.status == STATUS_ACTIVE
        ),
    ]
    flat = union_all(*pieces).subquery("stock_deltas")

    return (
        select(
            flat.c.product_id,
            func.coalesce(func.sum(flat.c.delta), 0).label("on_hand"),
            *[
                func.coalesce(func.sum(flat.c.delta).filter(flat.c.bucket == bucket), 0).label(
                    bucket
                )
                for bucket in BUCKETS
            ],
        )
        .group_by(flat.c.product_id)
        .subquery("stock_totals")
    )


def _by_product(stmt: Select, product_ids: list[uuid.UUID] | None, column) -> Select:
    stmt = stmt.where(column.status == STATUS_ACTIVE)
    if product_ids is not None:
        stmt = stmt.where(column.product_id.in_(product_ids))
    return stmt


def product_stats(
    db: Session, product_ids: list[uuid.UUID] | None = None
) -> dict[uuid.UUID, ProductStats]:
    """Aggregate stats keyed by product id. `None` means every product."""
    stats: dict[uuid.UUID, ProductStats] = {}

    def row(product_id: uuid.UUID) -> ProductStats:
        return stats.setdefault(product_id, ProductStats())

    purchases = _by_product(
        select(
            Purchase.product_id,
            func.sum(Purchase.quantity),
            func.sum(
                Purchase.gross_amount_cents
                + Purchase.shipping_cents
                + Purchase.tax_cents
                + Purchase.fees_cents
            ),
        ).group_by(Purchase.product_id),
        product_ids,
        Purchase,
    )
    for product_id, quantity, landed in db.execute(purchases):
        entry = row(product_id)
        entry.quantity_purchased = int(quantity or 0)
        entry.total_invested_cents = int(landed or 0)

    sales = _by_product(
        select(
            Sale.product_id,
            func.sum(Sale.quantity),
            func.sum(Sale.gross_amount_cents),
            func.sum(
                Sale.gross_amount_cents
                - Sale.platform_fees_cents
                - Sale.payment_fees_cents
                - Sale.shipping_paid_cents
            ),
            func.count(),
            func.sum(case((Sale.has_unknown_cost.is_(True), 1), else_=0)),
            func.sum(func.coalesce(Sale.cost_basis_cents, 0)),
            # Net proceeds of known-cost sales only: profit is undefined for the others,
            # and including their revenue would inflate it.
            func.sum(
                case(
                    (
                        Sale.has_unknown_cost.is_(False),
                        Sale.gross_amount_cents
                        - Sale.platform_fees_cents
                        - Sale.payment_fees_cents
                        - Sale.shipping_paid_cents,
                    ),
                    else_=0,
                )
            ),
        ).group_by(Sale.product_id),
        product_ids,
        Sale,
    )
    for (
        product_id,
        quantity,
        gross,
        net,
        count,
        unknown,
        cost_basis,
        net_known,
    ) in db.execute(sales):
        entry = row(product_id)
        entry.quantity_sold = int(quantity or 0)
        entry.gross_revenue_cents = int(gross or 0)
        entry.net_proceeds_cents = int(net or 0)
        entry.sale_count = int(count or 0)
        entry.sales_missing_cost = int(unknown or 0)
        entry.cost_of_sales_cents = int(cost_basis or 0)
        entry.net_proceeds_cents_known = int(net_known or 0)

    adjustments = _by_product(
        select(
            InventoryAdjustment.product_id,
            func.sum(InventoryAdjustment.quantity_delta),
            func.sum(
                case(
                    (
                        InventoryAdjustment.reason != REASON_TRANSFORMED,
                        func.coalesce(InventoryAdjustment.cost_removed_cents, 0),
                    ),
                    else_=0,
                )
            ),
            func.sum(
                case(
                    (
                        InventoryAdjustment.reason == REASON_TRANSFORMED,
                        func.coalesce(InventoryAdjustment.cost_removed_cents, 0),
                    ),
                    else_=0,
                )
            ),
            func.sum(
                case(
                    (
                        InventoryAdjustment.quantity_delta > 0,
                        func.coalesce(InventoryAdjustment.landed_cost_cents, 0),
                    ),
                    else_=0,
                )
            ),
        ).group_by(InventoryAdjustment.product_id),
        product_ids,
        InventoryAdjustment,
    )
    for product_id, delta, written_off, transformed, added_cost in db.execute(adjustments):
        entry = row(product_id)
        entry.quantity_adjusted = int(delta or 0)
        entry.cost_written_off_cents = int(written_off or 0)
        entry.cost_transformed_cents = int(transformed or 0)
        # Stock counted in via an adjustment is invested capital too, when its cost is known.
        entry.total_invested_cents += int(added_cost or 0)

    # Stock per bucket. Buckets are a location dimension over the same rows, so this is the
    # same supply-minus-consumption arithmetic grouped one level finer, plus moves.
    for model, column, sign in (
        (Purchase, Purchase.quantity, 1),
        (Sale, Sale.quantity, -1),
        (InventoryAdjustment, InventoryAdjustment.quantity_delta, 1),
    ):
        stmt = _by_product(
            select(model.product_id, model.bucket, func.sum(column)).group_by(
                model.product_id, model.bucket
            ),
            product_ids,
            model,
        )
        for product_id, bucket, quantity in db.execute(stmt):
            row(product_id).by_bucket[bucket] += sign * int(quantity or 0)

    # A move is the one row that touches two buckets: out of `from_bucket`, into `bucket`.
    moves = _by_product(
        select(
            StockMove.product_id,
            StockMove.from_bucket,
            StockMove.bucket,
            func.sum(StockMove.quantity),
        ).group_by(StockMove.product_id, StockMove.from_bucket, StockMove.bucket),
        product_ids,
        StockMove,
    )
    for product_id, source, destination, quantity in db.execute(moves):
        entry = row(product_id)
        entry.by_bucket[source] -= int(quantity or 0)
        entry.by_bucket[destination] += int(quantity or 0)

    for product_id, entry in stats.items():
        entry.quantity_on_hand = (
            entry.quantity_purchased + entry.quantity_adjusted - entry.quantity_sold
        )
        entry.remaining_cost_cents = max(
            entry.total_invested_cents
            - entry.cost_of_sales_cents
            - entry.cost_written_off_cents
            - entry.cost_transformed_cents,
            0,
        )

    return stats


def quantity_on_hand(db: Session, product_id: uuid.UUID) -> int:
    """Stock for one product. Supply minus consumption; no FIFO needed.

    This is the single source of truth for quantity. It deliberately returns a signed
    number: selling more than was ever bought is a data error the brief wants surfaced,
    not clamped to zero and hidden.
    """
    stats = product_stats(db, [product_id]).get(product_id)
    return stats.quantity_on_hand if stats else 0


def has_any_transactions(db: Session, product_id: uuid.UUID) -> bool:
    """True if anything financial references this product, voided rows included.

    Used to decide whether a product may be deleted outright or must be archived - a
    voided transaction is still history worth keeping.
    """
    for model in (Purchase, Sale, InventoryAdjustment, StockMove):
        if db.scalar(select(model.id).where(model.product_id == product_id).limit(1)):
            return True
    return bool(
        db.scalar(select(CostAllocation.id).where(CostAllocation.product_id == product_id).limit(1))
    )
