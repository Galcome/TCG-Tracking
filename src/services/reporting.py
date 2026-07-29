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

from src.models.ledger import STATUS_ACTIVE, Purchase, Sale
from src.models.member import Member
from src.models.product import Product
from src.models.taxonomy import Game
from src.services.inventory import product_stats

PERIOD_ALL = "all"
PERIOD_YTD = "ytd"
PERIOD_MTD = "mtd"
PERIOD_30D = "30d"
PERIODS = (PERIOD_ALL, PERIOD_YTD, PERIOD_MTD, PERIOD_30D)

#: Display label for sales with no marketplace recorded. Not a stored value.
UNSPECIFIED_MARKETPLACE = "Unspecified"


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

    @property
    def roi(self) -> float | None:
        if self.cost_of_sales_cents <= 0:
            return None
        return self.realized_profit_cents / self.cost_of_sales_cents


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


def by_game(db: Session, period: str = PERIOD_ALL, today: date | None = None) -> list[GroupRow]:
    """Performance grouped by game, best first."""
    start = period_start(period, today)
    rows: dict[uuid.UUID, GroupRow] = {}

    for game_id, name in db.execute(select(Game.id, Game.name)):
        rows[game_id] = GroupRow(key=str(game_id), label=name)

    sales = (
        select(
            Product.game_id,
            func.coalesce(func.sum(_NET_KNOWN), 0),
            func.coalesce(func.sum(func.coalesce(Sale.cost_basis_cents, 0)), 0),
            func.coalesce(func.sum(Sale.gross_amount_cents), 0),
            func.count(),
            func.coalesce(func.sum(case((Sale.has_unknown_cost.is_(True), 1), else_=0)), 0),
        )
        .join(Product, Product.id == Sale.product_id)
        .where(Sale.status == STATUS_ACTIVE)
        .group_by(Product.game_id)
    )
    if start is not None:
        sales = sales.where(Sale.sale_date.is_not(None), Sale.sale_date >= start)

    for game_id, net_known, cost, gross, count, unknown in db.execute(sales):
        row = rows.setdefault(game_id, GroupRow(key=str(game_id), label="Unknown"))
        row.cost_of_sales_cents = int(cost)
        row.realized_profit_cents = int(net_known) - int(cost)
        row.revenue_cents = int(gross)
        row.sale_count = int(count)
        row.sales_missing_cost = int(unknown)

    # `rows` was seeded from every game and `game_by_product` from every product, so the
    # lookup always lands - no defensive branch needed.
    game_by_product = dict(db.execute(select(Product.id, Product.game_id)).all())
    for product_id, stats in product_stats(db).items():
        row = rows[game_by_product[product_id]]
        row.inventory_at_cost_cents += stats.remaining_cost_cents
        row.units_in_stock += max(stats.quantity_on_hand, 0)

    ranked = [row for row in rows.values() if row.sale_count or row.units_in_stock]
    ranked.sort(key=lambda row: (-row.realized_profit_cents, row.label))
    return ranked


def by_marketplace(
    db: Session, period: str = PERIOD_ALL, today: date | None = None
) -> list[GroupRow]:
    """Where things actually sold, best first.

    A sale with no marketplace recorded is real revenue, so it collapses into a single
    "Unspecified" row rather than being dropped.
    """
    start = period_start(period, today)
    label = func.coalesce(Sale.marketplace, UNSPECIFIED_MARKETPLACE)

    sales = (
        select(
            label,
            func.coalesce(func.sum(_NET_KNOWN), 0),
            func.coalesce(func.sum(func.coalesce(Sale.cost_basis_cents, 0)), 0),
            func.coalesce(func.sum(Sale.gross_amount_cents), 0),
            func.count(),
            func.coalesce(func.sum(case((Sale.has_unknown_cost.is_(True), 1), else_=0)), 0),
        )
        .where(Sale.status == STATUS_ACTIVE)
        .group_by(label)
    )
    if start is not None:
        sales = sales.where(Sale.sale_date.is_not(None), Sale.sale_date >= start)

    rows: list[GroupRow] = []
    for name, net_known, cost, gross, count, unknown in db.execute(sales):
        rows.append(
            GroupRow(
                key=name,
                label=name,
                realized_profit_cents=int(net_known) - int(cost),
                cost_of_sales_cents=int(cost),
                revenue_cents=int(gross),
                sale_count=int(count),
                sales_missing_cost=int(unknown),
            )
        )

    rows.sort(key=lambda row: (-row.realized_profit_cents, row.label))
    return rows


def by_seller(db: Session, period: str = PERIOD_ALL, today: date | None = None) -> list[GroupRow]:
    """Per-member sales performance.

    These are performance figures, not ownership. Every unit belongs to the store; this
    only says who moved it.
    """
    start = period_start(period, today)
    rows: dict[uuid.UUID, GroupRow] = {}
    for member_id, name in db.execute(select(Member.id, Member.display_name)):
        rows[member_id] = GroupRow(key=str(member_id), label=name)

    sales = (
        select(
            Sale.sold_by_member_id,
            func.coalesce(func.sum(_NET_KNOWN), 0),
            func.coalesce(func.sum(func.coalesce(Sale.cost_basis_cents, 0)), 0),
            func.coalesce(func.sum(Sale.gross_amount_cents), 0),
            func.count(),
            func.coalesce(func.sum(case((Sale.has_unknown_cost.is_(True), 1), else_=0)), 0),
        )
        .where(Sale.status == STATUS_ACTIVE, Sale.sold_by_member_id.is_not(None))
        .group_by(Sale.sold_by_member_id)
    )
    if start is not None:
        sales = sales.where(Sale.sale_date.is_not(None), Sale.sale_date >= start)

    for member_id, net_known, cost, gross, count, unknown in db.execute(sales):
        row = rows.setdefault(member_id, GroupRow(key=str(member_id), label="Unknown"))
        row.cost_of_sales_cents = int(cost)
        row.realized_profit_cents = int(net_known) - int(cost)
        row.revenue_cents = int(gross)
        row.sale_count = int(count)
        row.sales_missing_cost = int(unknown)

    ranked = [row for row in rows.values() if row.sale_count]
    ranked.sort(key=lambda row: (-row.realized_profit_cents, row.label))
    return ranked


@dataclass
class Attention:
    """Things the dashboard should nag about, per the brief."""

    sales_missing_cost: int = 0
    products_with_negative_stock: int = 0
    undated_sales: int = 0
    products_out_of_stock: int = 0
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
        elif stats.quantity_on_hand == 0 and stats.quantity_purchased:
            result.products_out_of_stock += 1

    result.undated_sales = int(
        db.scalar(
            select(func.count())
            .select_from(Sale)
            .where(Sale.status == STATUS_ACTIVE, Sale.sale_date.is_(None))
        )
        or 0
    )
    return result


__all__ = [
    "Attention",
    "Dashboard",
    "GroupRow",
    "PERIODS",
    "attention",
    "by_game",
    "by_seller",
    "dashboard",
    "period_start",
]

