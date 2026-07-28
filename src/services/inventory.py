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
from dataclasses import dataclass

from sqlalchemy import Select, case, func, select
from sqlalchemy.orm import Session

from src.models.ledger import (
    STATUS_ACTIVE,
    CostAllocation,
    InventoryAdjustment,
    Purchase,
    Sale,
)


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

    gross_revenue_cents: int = 0
    net_proceeds_cents: int = 0
    #: Net proceeds of known-cost sales only - the only ones profit can be computed for.
    net_proceeds_cents_known: int = 0

    sale_count: int = 0
    sales_missing_cost: int = 0

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
            func.sum(func.coalesce(InventoryAdjustment.cost_removed_cents, 0)),
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
    for product_id, delta, written_off, added_cost in db.execute(adjustments):
        entry = row(product_id)
        entry.quantity_adjusted = int(delta or 0)
        entry.cost_written_off_cents = int(written_off or 0)
        # Stock counted in via an adjustment is invested capital too, when its cost is known.
        entry.total_invested_cents += int(added_cost or 0)

    for product_id, entry in stats.items():
        entry.quantity_on_hand = (
            entry.quantity_purchased + entry.quantity_adjusted - entry.quantity_sold
        )
        entry.remaining_cost_cents = max(
            entry.total_invested_cents - entry.cost_of_sales_cents - entry.cost_written_off_cents,
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
    for model in (Purchase, Sale, InventoryAdjustment):
        if db.scalar(select(model.id).where(model.product_id == product_id).limit(1)):
            return True
    return bool(
        db.scalar(select(CostAllocation.id).where(CostAllocation.product_id == product_id).limit(1))
    )
