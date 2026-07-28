"""Dashboard and reporting endpoints."""

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


class AttentionRead(BaseModel):
    model_config = _CONFIG

    sales_missing_cost: int
    products_with_negative_stock: int
    undated_sales: int
    products_out_of_stock: int
    negative_stock_products: list[dict]


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


@router.get("/reports/attention", response_model=AttentionRead)
def read_attention(
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
):
    """Data problems worth fixing, per the brief's attention indicators."""
    return reporting.attention(db)
