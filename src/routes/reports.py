"""Dashboard and reporting endpoints."""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from src.dependencies import db_session, get_current_member
from src.models.member import Member
from src.models.price_snapshot import PriceSnapshot
from src.models.product import Product
from src.schemas.money import MoneyIn, MoneyOut, MoneyOutOptional
from src.schemas.pricing import MarketEstimateRead
from src.services import reporting, rollups, vault

router = APIRouter()

_CONFIG = ConfigDict(from_attributes=True, populate_by_name=True)


class DashboardRead(BaseModel):
    model_config = _CONFIG

    realized_profit: MoneyOut = Field(validation_alias="realized_profit_cents")
    roi: float | None
    inventory_at_cost: MoneyOut = Field(validation_alias="inventory_at_cost_cents")
    total_invested: MoneyOut = Field(validation_alias="total_invested_cents")
    #: Money spent inside the selected period, which is not the same as cost of sales.
    purchases_in_period: MoneyOut = Field(validation_alias="purchases_in_period_cents")
    cost_of_sales: MoneyOut = Field(validation_alias="cost_of_sales_cents")
    cost_written_off: MoneyOut = Field(validation_alias="cost_written_off_cents")
    total_sales: MoneyOut = Field(validation_alias="total_sales_cents")
    average_sale: MoneyOutOptional = Field(validation_alias="average_sale_cents")
    units_in_stock: int
    sale_count: int
    sales_missing_cost: int
    undated_sales: int
    products_with_negative_stock: int

    #: Lifetime cash. These ignore `period` - see the note on the dataclass.
    net_proceeds: MoneyOut = Field(validation_alias="net_proceeds_cents")
    fees_paid: MoneyOut = Field(validation_alias="fees_paid_cents")
    #: The part of `net_proceeds` that arrived as store credit rather than money. Real
    #: value, spendable only at the shop that issued it, so it is reported on its own line
    #: and left out of `cash_received` and `cash_balance`.
    store_credit: MoneyOut = Field(validation_alias="store_credit_cents")
    cash_received: MoneyOut = Field(validation_alias="cash_received_cents")
    #: Negative means money is on the shelf rather than in the bank, not that it was lost.
    cash_balance: MoneyOut = Field(validation_alias="cash_balance_cents")


class UnitsByAgeRead(BaseModel):
    model_config = _CONFIG

    d0_30: int
    d31_90: int
    d91_180: int
    d180_plus: int


class GroupRead(BaseModel):
    model_config = _CONFIG

    key: str
    label: str
    realized_profit: MoneyOut = Field(validation_alias="realized_profit_cents")
    cost_of_sales: MoneyOut = Field(validation_alias="cost_of_sales_cents")
    revenue: MoneyOut = Field(validation_alias="revenue_cents")
    inventory_at_cost: MoneyOut = Field(validation_alias="inventory_at_cost_cents")
    roi: float | None
    units_in_stock: int
    sale_count: int
    sales_missing_cost: int

    units_sold: int
    units_purchased: int
    #: Quantity-weighted mean shelf time in days. null when no sale here has a known one.
    avg_days_held: int | None
    #: Units sold over units bought, whole-life rather than period-scoped.
    sell_through: float | None
    #: Realized profit per day of shelf time. null when hold time is unknown or zero.
    profit_per_day: MoneyOutOptional = Field(validation_alias="profit_per_day_cents")
    #: Units on hand now, bucketed by how long they have been sitting.
    units_by_age: UnitsByAgeRead


class AttentionRead(BaseModel):
    model_config = _CONFIG

    sales_missing_cost: int
    products_with_negative_stock: int
    negative_stock_products: list[dict]


class AgingLotRead(BaseModel):
    model_config = _CONFIG

    purchase_id: uuid.UUID
    product_id: uuid.UUID
    product_name: str
    game_slug: str
    units: int
    cost: MoneyOut = Field(validation_alias="cost_cents")
    purchase_date: date | None
    #: null when the lot has no purchase date, so the UI can say so rather than bucket it.
    days_held: int | None


SetQuery = Query(default=None, description="Narrow to one set.")
GameQuery = Query(default=None, description="Narrow to one game.")
TypeQuery = Query(default=None, description="Narrow to one product type.")


def _filters(
    set_id: uuid.UUID | None, game_id: uuid.UUID | None, product_type_id: uuid.UUID | None
) -> reporting.Filters:
    """The same three narrowings on every grouped report, so one control drives them all."""
    return reporting.Filters(
        set_id=set_id, game_id=game_id, product_type_id=product_type_id
    )


PeriodQuery = Query(default=reporting.PERIOD_ALL, pattern=reporting.PERIOD_PATTERN)


@router.get("/dashboard", response_model=DashboardRead)
def read_dashboard(
    period: str = PeriodQuery,
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
):
    return reporting.dashboard(db, period)


@router.get("/reports/by-game", response_model=list[GroupRead])
def read_by_game(
    period: str = PeriodQuery,
    set_id: uuid.UUID | None = SetQuery,
    game_id: uuid.UUID | None = GameQuery,
    product_type_id: uuid.UUID | None = TypeQuery,
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
):
    return reporting.by_game(db, period, filters=_filters(set_id, game_id, product_type_id))


@router.get("/reports/by-product", response_model=list[GroupRead])
def read_by_product(
    period: str = PeriodQuery,
    set_id: uuid.UUID | None = SetQuery,
    game_id: uuid.UUID | None = GameQuery,
    product_type_id: uuid.UUID | None = TypeQuery,
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
):
    return reporting.by_product(db, period, filters=_filters(set_id, game_id, product_type_id))


@router.get("/reports/by-product-type", response_model=list[GroupRead])
def read_by_product_type(
    period: str = PeriodQuery,
    set_id: uuid.UUID | None = SetQuery,
    game_id: uuid.UUID | None = GameQuery,
    product_type_id: uuid.UUID | None = TypeQuery,
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
):
    return reporting.by_product_type(db, period, filters=_filters(set_id, game_id, product_type_id))


@router.get("/reports/by-marketplace", response_model=list[GroupRead])
def read_by_marketplace(
    period: str = PeriodQuery,
    set_id: uuid.UUID | None = SetQuery,
    game_id: uuid.UUID | None = GameQuery,
    product_type_id: uuid.UUID | None = TypeQuery,
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
):
    """Where things sold. Sales with no marketplace collapse into "Unspecified"."""
    return reporting.by_marketplace(db, period, filters=_filters(set_id, game_id, product_type_id))


@router.get("/reports/by-seller", response_model=list[GroupRead])
def read_by_seller(
    period: str = PeriodQuery,
    set_id: uuid.UUID | None = SetQuery,
    game_id: uuid.UUID | None = GameQuery,
    product_type_id: uuid.UUID | None = TypeQuery,
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
):
    return reporting.by_seller(db, period, filters=_filters(set_id, game_id, product_type_id))


@router.get("/reports/by-set-performance", response_model=list[GroupRead])
def read_by_set_performance(
    period: str = PeriodQuery,
    set_id: uuid.UUID | None = SetQuery,
    game_id: uuid.UUID | None = GameQuery,
    product_type_id: uuid.UUID | None = TypeQuery,
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
):
    """Sets compared against each other, so the group can see which ones actually paid.

    Named apart from `/reports/by-set`, which is the three-figure rollup for reading one
    set honestly. Two different questions, two different shapes.
    """
    return reporting.by_set(db, period, filters=_filters(set_id, game_id, product_type_id))


class MonthRead(BaseModel):
    """One calendar month of trading."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    month: str
    spent: MoneyOut = Field(validation_alias="spent_cents")
    realized_profit: MoneyOut = Field(validation_alias="realized_profit_cents")
    revenue: MoneyOut = Field(validation_alias="revenue_cents")
    units_sold: int
    units_bought: int


@router.get("/reports/by-month", response_model=list[MonthRead])
def read_by_month(
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
):
    """The last twelve months of trading, oldest first.

    No period parameter: the point of this one is the trend, and a period filter over a
    trend chart would just be a shorter trend.
    """
    return reporting.by_month(db)


@router.get("/reports/aging", response_model=list[AgingLotRead])
def read_aging(
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
):
    """Unsold stock, oldest money first, one row per purchase lot.

    Not period-scoped: what is sitting on the shelf today is not a function of a date
    range, and filtering it by one would hide the oldest stock exactly when it matters.
    """
    return reporting.aging_lots(db)


@router.get("/reports/attention", response_model=AttentionRead)
def read_attention(
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
):
    """States where a number on screen cannot be trusted. Empty when the ledger is sound."""
    return reporting.attention(db)


# ------------------------------------------------------------------------ rollups


class LineageNodeRead(BaseModel):
    model_config = _CONFIG

    product_id: uuid.UUID
    product_name: str
    depth: int
    quantity_produced: int
    cost: MoneyOutOptional = Field(validation_alias="cost_cents")
    children: list["LineageNodeRead"]


class LineageRead(BaseModel):
    model_config = _CONFIG

    product_id: uuid.UUID
    product_name: str
    #: What the root actually cost. The only money really spent on this chain.
    cost: MoneyOut = Field(validation_alias="cost_cents")
    realized_profit: MoneyOut = Field(validation_alias="realized_profit_cents")
    remaining_cost: MoneyOut = Field(validation_alias="remaining_cost_cents")
    written_off: MoneyOut = Field(validation_alias="written_off_cents")
    units_sold: int
    units_remaining: int
    #: Measured against the root's cost. null until something has actually sold.
    roi: float | None
    tree: list[LineageNodeRead]


class TierRead(BaseModel):
    model_config = _CONFIG

    key: str
    label: str
    products_traded: int
    units_sold: int
    realized_profit: MoneyOut = Field(validation_alias="realized_profit_cents")
    cost_of_sales: MoneyOut = Field(validation_alias="cost_of_sales_cents")
    roi: float | None
    #: The average across products, and the spread around it. The spread is the point:
    #: the case anybody remembers is the one that hit.
    average_roi: float | None
    best_roi: float | None
    worst_roi: float | None
    median_roi: float | None
    avg_days_held: int | None


class SetRead(BaseModel):
    model_config = _CONFIG

    set_id: uuid.UUID
    name: str
    game_slug: str

    units_sold: int
    realized_profit: MoneyOut = Field(validation_alias="realized_profit_cents")
    cost_of_sales: MoneyOut = Field(validation_alias="cost_of_sales_cents")
    sold_roi: float | None

    units_in_store: int
    store_cost: MoneyOut = Field(validation_alias="store_cost_cents")
    #: How long the oldest thing still in the Store has been sitting. Store only - the
    #: Vault is not asleep, it is parked on purpose.
    oldest_store_days: int | None

    units_in_vault: int
    vault_cost: MoneyOut = Field(validation_alias="vault_cost_cents")


@router.get("/reports/lineage/{product_id}", response_model=LineageRead)
def lineage_report(
    product_id: uuid.UUID,
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> LineageRead:
    """One product, all-in, across everything it became.

    Deliberately **not** summable with the tier report below. A case's lineage return *is*
    the aggregate of its descendants, so adding the two together would count the same money
    twice. They answer different questions and are shown as different views.
    """
    found = rollups.lineage(db, product_id)
    if found is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return LineageRead.model_validate(found, from_attributes=True)


@router.get("/reports/by-tier", response_model=list[TierRead])
def tier_report(
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> list[TierRead]:
    """How each kind of thing has performed, with the spread and not just the average.

    Comparing a case against a box is false - a $900 case is harder to move than a $150 box
    and should sit longer - so this is meant to be read within a row, against that row's own
    history, rather than across rows.
    """
    return [
        TierRead.model_validate(row, from_attributes=True) for row in rollups.by_tier(db)
    ]


@router.get("/reports/by-set", response_model=list[SetRead])
def set_report(
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> list[SetRead]:
    """One set, split into what sold, what is still trying, and what is held on purpose.

    Never a single blended figure. Averaging a realized flip together with an unrealized
    hold describes neither of them.
    """
    return [SetRead.model_validate(row, from_attributes=True) for row in rollups.by_set(db)]


# -------------------------------------------------------------------------- vault


class ValuationRequest(BaseModel):
    """What something is thought to be worth today, per unit.

    An estimate, and it stays one. It never touches cost basis or realized profit - those
    follow what was actually paid and actually received. Estimates inform decisions; they
    do not score them.
    """

    product_id: uuid.UUID
    value: MoneyIn
    captured_on: date = Field(default_factory=date.today)
    notes: str | None = None


class ValuationRead(BaseModel):
    model_config = _CONFIG

    id: uuid.UUID
    product_id: uuid.UUID
    value: MoneyOut = Field(validation_alias="value_cents")
    captured_on: date
    source: str


class VaultHoldingRead(BaseModel):
    model_config = _CONFIG

    product_id: uuid.UUID
    product_name: str
    units: int
    cost: MoneyOut = Field(validation_alias="cost_cents")

    #: null means never valued, and it stays null. Reporting cost as value would invent
    #: a number, which is the one thing this app refuses everywhere.
    value: MoneyOutOptional = Field(validation_alias="value_cents")
    valued_on: date | None
    #: How stale the estimate is. The workbook revalues annually; older than that is worth
    #: showing rather than quietly presenting as current.
    days_since_valued: int | None

    appreciation: MoneyOutOptional = Field(validation_alias="appreciation_cents")
    appreciation_pct: float | None = Field(validation_alias="appreciation")
    #: Per year held, and only past a year - multiplying a three-week gain by seventeen
    #: produces a confident number about nothing.
    annualised: float | None

    #: Held for, not warned about. The Vault is not measured on velocity.
    days_held: int | None
    #: How long it sat in the Store before being moved here. This is the loophole guard:
    #: exempting the Vault from ageing must not make it where slow stock disappears.
    days_in_store_first: int | None

    #: A free-source quote, independent of the manual valuation and accounting fields.
    market_estimate: MarketEstimateRead | None = None


@router.post("/valuations", response_model=ValuationRead, status_code=status.HTTP_201_CREATED)
def record_valuation(
    payload: ValuationRequest,
    member: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> ValuationRead:
    """Write down what something is worth today.

    The annual manual valuation is the floor, and it always works with no dependency on
    anybody else's price feed - which is exactly what the workbook's Vault tab already does.
    """
    if db.get(Product, payload.product_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    snapshot = PriceSnapshot(
        product_id=payload.product_id,
        value_cents=payload.value,
        captured_on=payload.captured_on,
        notes=(payload.notes or "").strip() or None,
        created_by_member_id=member.id,
    )
    db.add(snapshot)
    db.flush()
    return ValuationRead.model_validate(snapshot, from_attributes=True)


@router.get("/reports/vault", response_model=list[VaultHoldingRead])
def vault_report(
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> list[VaultHoldingRead]:
    """What is in the Vault, and what it has done since it went in.

    Measured on **appreciation** rather than velocity, because that is what a deliberate
    long hold is for. There is no days-to-sell figure here on purpose, and the Vault does
    not appear in the ageing report at all - it is not asleep, it is parked.
    """
    return [
        VaultHoldingRead.model_validate(row, from_attributes=True)
        for row in vault.holdings(db)
    ]
