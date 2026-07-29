"""Dashboard and reporting endpoints."""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from src.dependencies import db_session, get_current_member
from src.models.member import Member
from src.schemas.money import MoneyOut, MoneyOutOptional
from src.services import reporting

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


PeriodQuery = Query(default=reporting.PERIOD_ALL, pattern="^(all|ytd|mtd|30d)$")


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
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
):
    return reporting.by_game(db, period)


@router.get("/reports/by-product", response_model=list[GroupRead])
def read_by_product(
    period: str = PeriodQuery,
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
):
    return reporting.by_product(db, period)


@router.get("/reports/by-product-type", response_model=list[GroupRead])
def read_by_product_type(
    period: str = PeriodQuery,
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
):
    return reporting.by_product_type(db, period)


@router.get("/reports/by-marketplace", response_model=list[GroupRead])
def read_by_marketplace(
    period: str = PeriodQuery,
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
):
    """Where things sold. Sales with no marketplace collapse into "Unspecified"."""
    return reporting.by_marketplace(db, period)


@router.get("/reports/by-seller", response_model=list[GroupRead])
def read_by_seller(
    period: str = PeriodQuery,
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
):
    return reporting.by_seller(db, period)


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
