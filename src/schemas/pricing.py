"""Wire models for free, display-only market pricing."""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from src.models.catalog import CATALOG_MAPPING_STATUSES, CATALOG_PROVIDER_TCGCSV
from src.models.market_price import QUOTE_STATUSES
from src.schemas.money import MoneyOutOptional

MappingStatus = Literal["confirmed", "disabled"]
QuoteStatus = Literal["fresh", "stale", "unavailable"]


class CatalogMappingCreate(BaseModel):
    """A human-confirmed provider identity; the API never guesses a match."""

    product_id: uuid.UUID
    provider: Literal[CATALOG_PROVIDER_TCGCSV] = CATALOG_PROVIDER_TCGCSV
    external_product_id: str = Field(min_length=1, max_length=120)
    external_group_id: str | None = Field(default=None, max_length=80)
    external_category_id: str | None = Field(default=None, max_length=80)
    subtype_name: str = Field(default="Normal", min_length=1, max_length=80)
    condition: str | None = Field(default=None, max_length=40)
    language: str | None = Field(default=None, max_length=40)
    match_status: MappingStatus = "confirmed"
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator(
        "external_group_id",
        "external_category_id",
        "condition",
        "language",
        "notes",
        mode="after",
    )
    @classmethod
    def strip_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("external_product_id", "subtype_name", mode="after")
    @classmethod
    def required_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("value cannot be blank")
        return stripped


class CatalogMappingUpdate(BaseModel):
    """Editable mapping fields. Final provider requirements are checked by the route."""

    external_product_id: str | None = Field(default=None, min_length=1, max_length=120)
    external_group_id: str | None = Field(default=None, max_length=80)
    external_category_id: str | None = Field(default=None, max_length=80)
    subtype_name: str | None = Field(default=None, min_length=1, max_length=80)
    condition: str | None = Field(default=None, max_length=40)
    language: str | None = Field(default=None, max_length=40)
    match_status: MappingStatus | None = None
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator(
        "external_product_id",
        "external_group_id",
        "external_category_id",
        "subtype_name",
        "condition",
        "language",
        "notes",
        mode="after",
    )
    @classmethod
    def strip_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class MarketEstimateRead(BaseModel):
    """One provider estimate, separate from manual valuation and ledger money."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    value: MoneyOutOptional = Field(validation_alias="value_cents")
    captured_on: date | None
    status: QuoteStatus
    provider: str
    source_revision: str | None


class CatalogMappingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    product_id: uuid.UUID
    provider: str
    external_product_id: str
    external_group_id: str | None
    external_category_id: str | None
    subtype_name: str
    condition: str | None
    language: str | None
    match_status: MappingStatus
    notes: str | None
    created_by_member_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class PricingRefreshRead(BaseModel):
    attempted: int
    refreshed: int
    skipped: int
    stale: int
    unavailable: int
    source_revision: str | None
    errors: list[str]


__all__ = [
    "CATALOG_MAPPING_STATUSES",
    "CatalogMappingCreate",
    "CatalogMappingRead",
    "CatalogMappingUpdate",
    "MarketEstimateRead",
    "PricingRefreshRead",
    "QUOTE_STATUSES",
]
