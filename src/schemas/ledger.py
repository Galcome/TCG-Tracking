"""Request and response models for the ledger.

Dates default to today rather than staying null. An undated event sorts before every dated
one in the costing engine - correct for imported history, wrong for something entered this
afternoon. Nullability survives in the database purely so a future import can express
"genuinely unknown", but nothing entered through the API is ever undated by accident.

Read models use `validation_alias` to pull from the ORM's `*_cents` columns while presenting
friendly names, so a field called `amount` never holds something called cents.
"""

import uuid
from datetime import date

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from src.models.ledger import ADJUSTMENT_REASONS
from src.schemas.money import MoneyIn, MoneyOut, MoneyOutOptional

MAX_QUANTITY = 1_000_000

_READ_CONFIG = ConfigDict(from_attributes=True, populate_by_name=True)


def _strip_optional(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip() or None


class VoidRequest(BaseModel):
    """Voiding always asks why. The number changing is the point of the audit trail."""

    reason: str = Field(min_length=1, max_length=500)

    @field_validator("reason")
    @classmethod
    def strip_reason(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("a reason is required")
        return stripped


# ----------------------------------------------------------------------- purchases


class PurchaseCreate(BaseModel):
    product_id: uuid.UUID
    quantity: int = Field(gt=0, le=MAX_QUANTITY)
    amount: MoneyIn
    shipping: MoneyIn = 0
    tax: MoneyIn = 0
    fees: MoneyIn = 0
    purchase_date: date = Field(default_factory=date.today)
    purchased_by_member_id: uuid.UUID | None = None
    source: str | None = Field(default=None, max_length=160)
    notes: str | None = None

    @field_validator("source", "notes", mode="after")
    @classmethod
    def blank_to_none(cls, value: str | None) -> str | None:
        return _strip_optional(value)


class PurchaseUpdate(BaseModel):
    quantity: int | None = Field(default=None, gt=0, le=MAX_QUANTITY)
    amount: MoneyIn | None = None
    shipping: MoneyIn | None = None
    tax: MoneyIn | None = None
    fees: MoneyIn | None = None
    purchase_date: date | None = None
    purchased_by_member_id: uuid.UUID | None = None
    source: str | None = Field(default=None, max_length=160)
    notes: str | None = None
    reason: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def reject_explicit_nulls(self) -> "PurchaseUpdate":
        for name in ("quantity", "amount", "shipping", "tax", "fees", "purchase_date"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


class PurchaseRead(BaseModel):
    model_config = _READ_CONFIG

    id: uuid.UUID
    product_id: uuid.UUID
    quantity: int
    amount: MoneyOut = Field(validation_alias="gross_amount_cents")
    shipping: MoneyOut = Field(validation_alias="shipping_cents")
    tax: MoneyOut = Field(validation_alias="tax_cents")
    fees: MoneyOut = Field(validation_alias="fees_cents")
    landed_cost: MoneyOut = Field(validation_alias="landed_cost_cents")
    purchase_date: date | None
    purchased_by_member_id: uuid.UUID | None
    source: str | None
    notes: str | None
    status: str


# --------------------------------------------------------------------------- sales


class SaleCreate(BaseModel):
    product_id: uuid.UUID
    quantity: int = Field(gt=0, le=MAX_QUANTITY)
    amount: MoneyIn
    platform_fees: MoneyIn = 0
    payment_fees: MoneyIn = 0
    shipping_paid: MoneyIn = 0
    sale_date: date = Field(default_factory=date.today)
    sold_by_member_id: uuid.UUID | None = None
    marketplace: str | None = Field(default=None, max_length=120)
    notes: str | None = None
    #: Deliberate override for correcting history. Without it, overselling is a 409.
    allow_oversell: bool = False

    @field_validator("marketplace", "notes", mode="after")
    @classmethod
    def blank_to_none(cls, value: str | None) -> str | None:
        return _strip_optional(value)


class SaleUpdate(BaseModel):
    quantity: int | None = Field(default=None, gt=0, le=MAX_QUANTITY)
    amount: MoneyIn | None = None
    platform_fees: MoneyIn | None = None
    payment_fees: MoneyIn | None = None
    shipping_paid: MoneyIn | None = None
    sale_date: date | None = None
    sold_by_member_id: uuid.UUID | None = None
    marketplace: str | None = Field(default=None, max_length=120)
    notes: str | None = None
    reason: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def reject_explicit_nulls(self) -> "SaleUpdate":
        for name in ("quantity", "amount", "platform_fees", "payment_fees", "shipping_paid"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


class SaleRead(BaseModel):
    model_config = _READ_CONFIG

    id: uuid.UUID
    product_id: uuid.UUID
    quantity: int
    amount: MoneyOut = Field(validation_alias="gross_amount_cents")
    platform_fees: MoneyOut = Field(validation_alias="platform_fees_cents")
    payment_fees: MoneyOut = Field(validation_alias="payment_fees_cents")
    shipping_paid: MoneyOut = Field(validation_alias="shipping_paid_cents")
    net_proceeds: MoneyOut = Field(validation_alias="net_proceeds_cents")
    #: null means genuinely unknown - never render it as zero.
    cost_basis: MoneyOutOptional = Field(validation_alias="cost_basis_cents")
    realized_profit: MoneyOutOptional = Field(validation_alias="realized_profit_cents")
    has_unknown_cost: bool
    sale_date: date | None
    sold_by_member_id: uuid.UUID | None
    marketplace: str | None
    notes: str | None
    status: str


# --------------------------------------------------------------------- adjustments


class AdjustmentCreate(BaseModel):
    product_id: uuid.UUID
    quantity_delta: int = Field(ge=-MAX_QUANTITY, le=MAX_QUANTITY)
    reason: str
    cost: MoneyIn | None = None
    adjustment_date: date = Field(default_factory=date.today)
    member_id: uuid.UUID | None = None
    notes: str | None = None

    @field_validator("notes", mode="after")
    @classmethod
    def blank_to_none(cls, value: str | None) -> str | None:
        return _strip_optional(value)

    @field_validator("quantity_delta")
    @classmethod
    def non_zero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("an adjustment of zero changes nothing")
        return value

    @field_validator("reason")
    @classmethod
    def known_reason(cls, value: str) -> str:
        if value not in ADJUSTMENT_REASONS:
            raise ValueError(f"reason must be one of: {', '.join(ADJUSTMENT_REASONS)}")
        return value

    @model_validator(mode="after")
    def cost_only_when_adding_stock(self) -> "AdjustmentCreate":
        if self.cost is not None and self.quantity_delta < 0:
            raise ValueError("a cost can only be given when adding stock")
        return self


class AdjustmentRead(BaseModel):
    model_config = _READ_CONFIG

    id: uuid.UUID
    product_id: uuid.UUID
    quantity_delta: int
    reason: str
    cost: MoneyOutOptional = Field(validation_alias="landed_cost_cents")
    cost_removed: MoneyOutOptional = Field(validation_alias="cost_removed_cents")
    has_unknown_cost: bool
    adjustment_date: date | None
    member_id: uuid.UUID | None
    notes: str | None
    status: str


# ------------------------------------------------------------------------- history


class TransactionRead(BaseModel):
    """One row of a product's history, flattened so the UI renders a single list."""

    kind: str  #: purchase | sale | adjustment
    id: uuid.UUID
    occurred_on: date | None
    quantity: int  #: signed - positive adds stock, negative removes it
    amount: MoneyOutOptional = None
    cost: MoneyOutOptional = None
    profit: MoneyOutOptional = None
    has_unknown_cost: bool = False
    member_id: uuid.UUID | None = None
    label: str | None = None  #: source, marketplace, or adjustment reason
    notes: str | None = None
    status: str = "active"
