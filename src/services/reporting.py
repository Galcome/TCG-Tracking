"""Store-wide performance figures.

Every number here is aggregated from the ledger on request. Sales whose cost is unknown are
excluded from profit and ROI and counted separately, so a figure is never quietly built on
an invented cost.

"Invested" is reported three ways on purpose. The brief warns that one number labelled
"invested" is misleading over a time period: money spent during the period, the cost of what
was sold during it, and the cost still sitting in stock are three different things.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from src.models.ledger import STATUS_ACTIVE, CostAllocation, Purchase, Sale
from src.models.member import Member
from src.models.product import Product
from src.models.taxonomy import Game, ProductType
from src.services.inventory import product_stats

PERIOD_ALL = "all"
PERIOD_YTD = "ytd"
PERIOD_MTD = "mtd"
PERIOD_30D = "30d"
PERIODS = (PERIOD_ALL, PERIOD_YTD, PERIOD_MTD, PERIOD_30D)

#: Display label for sales with no marketplace recorded. Not a stored value.
UNSPECIFIED_MARKETPLACE = "Unspecified"

#: Upper bounds, in days, of the stock-ageing buckets.
AGE_BUCKETS = (30, 90, 180)


def period_start(period: str, today: date | None = None) -> date | None:
    """First day included in the period, or None for all time."""
    today = today or date.today()
    if period == PERIOD_YTD:
        return date(today.year, 1, 1)
    if period == PERIOD_MTD:
        return date(today.year, today.month, 1)
    if period == PERIOD_30D:
        return today.fromordinal(today.toordinal() - 30)
    return None


@dataclass
class Dashboard:
    realized_profit_cents: int = 0
    cost_of_sales_cents: int = 0
    inventory_at_cost_cents: int = 0
    total_invested_cents: int = 0
    purchases_in_period_cents: int = 0
    total_sales_cents: int = 0
    units_in_stock: int = 0
    sale_count: int = 0
    #: Sales left out of profit because their cost is unknown.
    sales_missing_cost: int = 0
    #: Sales with no date at all, therefore absent from any period figure.
    undated_sales: int = 0
    products_with_negative_stock: int = 0
    cost_written_off_cents: int = 0

    @property
    def roi(self) -> float | None:
        if self.cost_of_sales_cents <= 0:
            return None
        return self.realized_profit_cents / self.cost_of_sales_cents

    @property
    def average_sale_cents(self) -> int | None:
        if self.sale_count <= 0:
            return None
        return round(self.total_sales_cents / self.sale_count)


@dataclass
class UnitsByAge:
    """Units *currently on hand*, bucketed by how long they have been sitting."""

    d0_30: int = 0
    d31_90: int = 0
    d91_180: int = 0
    d180_plus: int = 0

    def add(self, days: int, quantity: int) -> None:
        first, second, third = AGE_BUCKETS
        if days <= first:
            self.d0_30 += quantity
        elif days <= second:
            self.d31_90 += quantity
        elif days <= third:
            self.d91_180 += quantity
        else:
            self.d180_plus += quantity


@dataclass
class GroupRow:
    key: str
    label: str
    realized_profit_cents: int = 0
    cost_of_sales_cents: int = 0
    revenue_cents: int = 0
    inventory_at_cost_cents: int = 0
    units_in_stock: int = 0
    sale_count: int = 0
    sales_missing_cost: int = 0

    units_sold: int = 0
    units_purchased: int = 0
    #: Quantity-weighted mean shelf time across this group's sales. None when no sale in
    #: the group has a known hold time.
    avg_days_held: int | None = None
    units_by_age: UnitsByAge = field(default_factory=UnitsByAge)

    @property
    def roi(self) -> float | None:
        if self.cost_of_sales_cents <= 0:
            return None
        return self.realized_profit_cents / self.cost_of_sales_cents

    @property
    def sell_through(self) -> float | None:
        """Units sold over units bought, over the whole life of the stock.

        Deliberately not period-scoped: units bought this month against units sold this
        month can exceed 1 wildly when old stock moves, which tells you nothing.
        """
        if self.units_purchased <= 0:
            return None
        return self.units_sold / self.units_purchased

    @property
    def profit_per_day_cents(self) -> int | None:
        """Realized profit per day of shelf time - the return-on-time figure.

        None when hold time is unknown or zero: dividing by zero days would report an
        infinite rate for something bought and sold the same day.
        """
        if not self.avg_days_held:
            return None
        return round(self.realized_profit_cents / self.avg_days_held)


_NET = (
    Sale.gross_amount_cents
    - Sale.platform_fees_cents
    - Sale.payment_fees_cents
    - Sale.shipping_paid_cents
)
#: Net proceeds of known-cost sales only. Including the rest would inflate profit with
#: revenue whose cost we cannot subtract.
_NET_KNOWN = case((Sale.has_unknown_cost.is_(False), _NET), else_=0)

_LANDED = (
    Purchase.gross_amount_cents + Purchase.shipping_cents + Purchase.tax_cents + Purchase.fees_cents
)


def dashboard(db: Session, period: str = PERIOD_ALL, today: date | None = None) -> Dashboard:
    start = period_start(period, today)
    result = Dashboard()

    sales = select(
        func.coalesce(func.sum(_NET_KNOWN), 0),
        func.coalesce(func.sum(func.coalesce(Sale.cost_basis_cents, 0)), 0),
        func.coalesce(func.sum(Sale.gross_amount_cents), 0),
        func.count(),
        func.coalesce(func.sum(case((Sale.has_unknown_cost.is_(True), 1), else_=0)), 0),
    ).where(Sale.status == STATUS_ACTIVE)
    if start is not None:
        sales = sales.where(Sale.sale_date.is_not(None), Sale.sale_date >= start)

    net_known, cost_of_sales, gross, count, unknown = db.execute(sales).one()
    result.cost_of_sales_cents = int(cost_of_sales)
    result.realized_profit_cents = int(net_known) - int(cost_of_sales)
    result.total_sales_cents = int(gross)
    result.sale_count = int(count)
    result.sales_missing_cost = int(unknown)

    result.undated_sales = int(
        db.scalar(
            select(func.count())
            .select_from(Sale)
            .where(Sale.status == STATUS_ACTIVE, Sale.sale_date.is_(None))
        )
        or 0
    )

    # Purchases made during the period - deliberately distinct from cost of sales.
    purchases = select(func.coalesce(func.sum(_LANDED), 0)).where(Purchase.status == STATUS_ACTIVE)
    result.total_invested_cents = int(db.scalar(purchases) or 0)
    if start is not None:
        purchases = purchases.where(
            Purchase.purchase_date.is_not(None), Purchase.purchase_date >= start
        )
    result.purchases_in_period_cents = int(db.scalar(purchases) or 0)

    # Stock and remaining cost are always as-of-now; a period cannot change what is on the
    # shelf today.
    for stats in product_stats(db).values():
        result.units_in_stock += max(stats.quantity_on_hand, 0)
        result.inventory_at_cost_cents += stats.remaining_cost_cents
        result.cost_written_off_cents += stats.cost_written_off_cents
        if stats.quantity_on_hand < 0:
            result.products_with_negative_stock += 1

    return result


# --------------------------------------------------------------------- groupings
#
# Five reports slice the same figures five ways, so the aggregation lives in one place and
# each public function only says what to group on and how to label it.


@dataclass
class _Grouping:
    """How one report slices the ledger.

    `sale_key` groups the sales aggregate. `product_key` maps a product to the same key so
    stock can be attributed - it is None for reports grouped on a property of the sale
    (marketplace, seller), where "inventory in this group" has no meaning.
    """

    sale_key: object
    labels: dict
    product_key: dict[uuid.UUID, object] | None
    #: Include groups holding stock but with no sales yet.
    keep_unsold: bool = False


def _weighted_days(pairs: list[tuple[int, int | None]]) -> int | None:
    """Quantity-weighted mean of (quantity, days) pairs, ignoring unknown hold times."""
    known = [(quantity, days) for quantity, days in pairs if days is not None]
    total = sum(quantity for quantity, _ in known)
    if not total:
        return None
    return round(sum(quantity * days for quantity, days in known) / total)


def _grouped(db: Session, grouping: _Grouping, period: str, today: date | None) -> list[GroupRow]:
    start = period_start(period, today)
    rows: dict[object, GroupRow] = {
        key: GroupRow(key=str(key), label=label) for key, label in grouping.labels.items()
    }

    def row_for(key: object) -> GroupRow:
        return rows.setdefault(key, GroupRow(key=str(key), label=str(key)))

    def in_period(stmt):
        if start is None:
            return stmt
        return stmt.where(Sale.sale_date.is_not(None), Sale.sale_date >= start)

    sales = in_period(
        select(
            grouping.sale_key,
            func.coalesce(func.sum(_NET_KNOWN), 0),
            func.coalesce(func.sum(func.coalesce(Sale.cost_basis_cents, 0)), 0),
            func.coalesce(func.sum(Sale.gross_amount_cents), 0),
            func.count(),
            func.coalesce(func.sum(case((Sale.has_unknown_cost.is_(True), 1), else_=0)), 0),
            func.coalesce(func.sum(Sale.quantity), 0),
        )
        .join(Product, Product.id == Sale.product_id)
        .where(Sale.status == STATUS_ACTIVE)
        .group_by(grouping.sale_key)
    )

    for key, net_known, cost, gross, count, unknown, units in db.execute(sales):
        row = row_for(key)
        row.cost_of_sales_cents = int(cost)
        row.realized_profit_cents = int(net_known) - int(cost)
        row.revenue_cents = int(gross)
        row.sale_count = int(count)
        row.sales_missing_cost = int(unknown)
        row.units_sold = int(units)

    # Hold time is already weighted per sale, so it cannot be averaged in the same
    # aggregate as the money without under-weighting large sales.
    hold = in_period(
        select(grouping.sale_key, Sale.quantity, Sale.days_held_weighted)
        .join(Product, Product.id == Sale.product_id)
        .where(Sale.status == STATUS_ACTIVE)
    )
    per_group: dict[object, list[tuple[int, int | None]]] = {}
    for key, quantity, days in db.execute(hold):
        per_group.setdefault(key, []).append((int(quantity), days))
    for key, pairs in per_group.items():
        row_for(key).avg_days_held = _weighted_days(pairs)

    if grouping.product_key is not None:
        _attach_stock(db, grouping.product_key, row_for, today)

    ranked = [
        row
        for row in rows.values()
        if row.sale_count or (grouping.keep_unsold and row.units_in_stock)
    ]
    ranked.sort(key=lambda row: (-row.realized_profit_cents, row.label))
    return ranked


def _attach_stock(
    db: Session, product_key: dict[uuid.UUID, object], row_for, today: date | None
) -> None:
    """Stock, inventory value, lifetime purchases and stock ageing, per group.

    All as-of-now and lifetime: a date filter cannot change what is physically on the
    shelf today.
    """
    for product_id, stats in product_stats(db).items():
        key = product_key.get(product_id)
        if key is not None:
            row = row_for(key)
            row.inventory_at_cost_cents += stats.remaining_cost_cents
            row.units_in_stock += max(stats.quantity_on_hand, 0)

    purchased = (
        select(Purchase.product_id, func.coalesce(func.sum(Purchase.quantity), 0))
        .where(Purchase.status == STATUS_ACTIVE)
        .group_by(Purchase.product_id)
    )
    for product_id, quantity in db.execute(purchased):
        key = product_key.get(product_id)
        if key is not None:
            row_for(key).units_purchased += int(quantity)

    reference = today or date.today()
    for lot in _remaining_lots(db):
        key = product_key.get(lot.product_id)
        # An undated lot cannot be aged; leaving it out beats inventing a date.
        if key is not None and lot.purchase_date is not None:
            row_for(key).units_by_age.add(
                (reference - lot.purchase_date).days, int(lot.remaining)
            )


def _remaining_lots(db: Session):
    """Purchase lots with stock left, with what was paid for them.

    Remaining is the lot's quantity minus whatever the costing engine already allocated
    away from it, which is exactly what `cost_allocations` records.

    Columns are labelled and read by name: both callers want different subsets, and
    positional unpacking makes adding one a silent reshuffle.
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
    remaining = Purchase.quantity - func.coalesce(consumed.c.used, 0)

    return db.execute(
        select(
            Purchase.id.label("purchase_id"),
            Purchase.product_id.label("product_id"),
            Purchase.purchase_date.label("purchase_date"),
            Purchase.quantity.label("bought"),
            _LANDED.label("landed_cents"),
            remaining.label("remaining"),
        )
        .outerjoin(consumed, consumed.c.purchase_id == Purchase.id)
        .where(Purchase.status == STATUS_ACTIVE, remaining > 0)
    ).all()


@dataclass
class AgingLot:
    """One purchase lot still sitting on the shelf.

    Lot-level rather than product-level on purpose: a product bought three times has three
    different ages, and averaging them hides the one that has been there a year.
    """

    purchase_id: uuid.UUID
    product_id: uuid.UUID
    product_name: str
    game_slug: str
    units: int
    cost_cents: int
    purchase_date: date | None
    #: None when the lot has no purchase date. Such a lot cannot be aged, and guessing
    #: would put invented money in a bucket.
    days_held: int | None


def aging_lots(db: Session, today: date | None = None) -> list[AgingLot]:
    """Unsold stock, oldest money first. Undated lots sort last."""
    reference = today or date.today()
    products = {
        row.id: row
        for row in db.execute(
            select(Product.id, Product.name, Game.slug.label("game_slug")).join(
                Game, Game.id == Product.game_id
            )
        ).all()
    }

    rows: list[AgingLot] = []
    for lot in _remaining_lots(db):
        product = products.get(lot.product_id)
        if product is None:  # pragma: no cover - a purchase always has its product
            continue
        rows.append(
            AgingLot(
                purchase_id=lot.purchase_id,
                product_id=lot.product_id,
                product_name=product.name,
                game_slug=product.game_slug,
                units=int(lot.remaining),
                # Proportional, matching what the section has always claimed. Not the
                # engine's largest-remainder split, which allocates against a consuming
                # sale and has no meaning for units nobody has sold.
                cost_cents=round(int(lot.landed_cents) * int(lot.remaining) / int(lot.bought)),
                purchase_date=lot.purchase_date,
                days_held=(
                    (reference - lot.purchase_date).days if lot.purchase_date is not None else None
                ),
            )
        )

    rows.sort(key=lambda row: (row.days_held is None, -(row.days_held or 0), row.product_name))
    return rows


def by_game(db: Session, period: str = PERIOD_ALL, today: date | None = None) -> list[GroupRow]:
    """Performance grouped by game, best first."""
    return _grouped(
        db,
        _Grouping(
            sale_key=Product.game_id,
            labels=dict(db.execute(select(Game.id, Game.name)).all()),
            product_key=dict(db.execute(select(Product.id, Product.game_id)).all()),
            keep_unsold=True,
        ),
        period,
        today,
    )


def by_product(db: Session, period: str = PERIOD_ALL, today: date | None = None) -> list[GroupRow]:
    """Performance grouped by individual product."""
    return _grouped(
        db,
        _Grouping(
            sale_key=Product.id,
            labels=dict(db.execute(select(Product.id, Product.name)).all()),
            product_key={row[0]: row[0] for row in db.execute(select(Product.id)).all()},
            keep_unsold=True,
        ),
        period,
        today,
    )


def by_product_type(
    db: Session, period: str = PERIOD_ALL, today: date | None = None
) -> list[GroupRow]:
    """Performance grouped by product type - sealed against singles against slabs."""
    return _grouped(
        db,
        _Grouping(
            sale_key=Product.product_type_id,
            labels=dict(db.execute(select(ProductType.id, ProductType.name)).all()),
            product_key=dict(db.execute(select(Product.id, Product.product_type_id)).all()),
            keep_unsold=True,
        ),
        period,
        today,
    )


def by_marketplace(
    db: Session, period: str = PERIOD_ALL, today: date | None = None
) -> list[GroupRow]:
    """Where things actually sold.

    A sale with no marketplace recorded is real revenue, so it collapses into a single
    "Unspecified" row rather than being dropped. Stock is not attributed - a product does
    not live in a marketplace.
    """
    return _grouped(
        db,
        _Grouping(
            sale_key=func.coalesce(Sale.marketplace, UNSPECIFIED_MARKETPLACE),
            labels={},
            product_key=None,
        ),
        period,
        today,
    )


def by_seller(db: Session, period: str = PERIOD_ALL, today: date | None = None) -> list[GroupRow]:
    """Per-member sales performance.

    These are performance figures, not ownership. Every unit belongs to the store; this
    only says who moved it.
    """
    return _grouped(
        db,
        _Grouping(
            sale_key=Sale.sold_by_member_id,
            labels=dict(db.execute(select(Member.id, Member.display_name)).all()),
            product_key=None,
        ),
        period,
        today,
    )


@dataclass
class Attention:
    """Ways the ledger is currently lying, and nothing else.

    Selling out used to be listed here, which had it backwards - it is the goal, not a
    fault, and it meant a working store carried a permanent warning. Undated sales left
    too: the dashboard already states that count in its own line, and a caveat repeated as
    a red banner trains people to ignore the banner.

    What is left are the two states where a number on screen cannot be trusted: profit
    reported without a known cost, and stock the ledger says is negative.
    """

    sales_missing_cost: int = 0
    products_with_negative_stock: int = 0
    negative_stock_products: list[dict] = field(default_factory=list)


def attention(db: Session) -> Attention:
    result = Attention()
    names = dict(db.execute(select(Product.id, Product.name)).all())

    for product_id, stats in product_stats(db).items():
        result.sales_missing_cost += stats.sales_missing_cost
        if stats.quantity_on_hand < 0:
            result.products_with_negative_stock += 1
            result.negative_stock_products.append(
                {
                    "id": str(product_id),
                    "name": names.get(product_id, "Unknown"),
                    "quantity": stats.quantity_on_hand,
                }
            )

    return result


__all__ = [
    "AGE_BUCKETS",
    "AgingLot",
    "Attention",
    "Dashboard",
    "GroupRow",
    "PERIODS",
    "UNSPECIFIED_MARKETPLACE",
    "UnitsByAge",
    "aging_lots",
    "attention",
    "by_game",
    "by_marketplace",
    "by_product",
    "by_product_type",
    "by_seller",
    "dashboard",
    "period_start",
]
