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

from src.models.ledger import ADJUSTMENT_REASONS, BUCKET_INVENTORY, BUCKETS
from src.schemas.money import MoneyIn, MoneyOut, MoneyOutOptional
from src.schemas.money_ledger import FundingLeg, ProceedsLeg
from src.schemas.taxonomy import TaxonomyRead

MAX_QUANTITY = 1_000_000

#: Where stock lands, is sold from, or is adjusted. Defaults to inventory - the bucket
#: something is in when you have simply bought it and have not decided anything else yet.
BucketField = Field(default=BUCKET_INVENTORY, pattern=f"^({'|'.join(BUCKETS)})$")

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
    bucket: str = BucketField
    notes: str | None = None
    #: Who paid, and how much of it. Omitted, it goes on whoever bought it - the same rule
    #: as a sale's proceeds. An empty list records no money movement at all.
    funding: list[FundingLeg] | None = None

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
    #: Sent, this replaces who paid. Left out, existing funding is rescaled in the same
    #: proportions to whatever the purchase now costs.
    funding: list[FundingLeg] | None = None

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
    bucket: str
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
    #: Which bucket the stock left from.
    bucket: str = BucketField
    notes: str | None = None
    #: Where the money landed. Omitted, it follows the seller, because that is where an
    #: eBay payout actually goes. Moving it to the joint account is a separate, later act.
    #: A leg naming a `store` is store credit: value received, and no cash anywhere.
    proceeds: list[ProceedsLeg] | None = None
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
    #: Sent, this moves where the money landed. Left out, an existing proceeds record
    #: follows the sale's new net amount, keeping any split in proportion.
    proceeds: list[ProceedsLeg] | None = None

    @model_validator(mode="after")
    def reject_explicit_nulls(self) -> "SaleUpdate":
        for name in ("quantity", "amount", "platform_fees", "payment_fees", "shipping_paid"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


class ProductSummary(BaseModel):
    """Just enough product for a sales row to render.

    Defined here rather than imported from schemas.product because that module already
    imports this one; duplicating four fields beats a circular import.
    """

    model_config = _READ_CONFIG

    id: uuid.UUID
    name: str
    game: TaxonomyRead
    product_type: TaxonomyRead
    #: Carried so an exported sale can be pivoted by set without a second lookup. Set is
    #: the unit the group buys and sells in, and a sales export without it forces the
    #: reader to rebuild the mapping by hand in the spreadsheet.
    set_name: str | None = None
    language: str | None = None


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
    #: Quantity-weighted shelf time of the units sold. null when any consumed lot has
    #: no purchase date - never a guess. 0 is real: bought and sold the same day.
    days_held_weighted: int | None
    sale_date: date | None
    sold_by_member_id: uuid.UUID | None
    marketplace: str | None
    bucket: str
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
    bucket: str = BucketField
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


class AdjustmentUpdate(BaseModel):
    """Corrections to a stock adjustment.

    Same rules as creating one: a non-zero delta, a known reason, and a cost only when
    stock is being added.
    """

    quantity_delta: int | None = Field(default=None, ge=-MAX_QUANTITY, le=MAX_QUANTITY)
    reason: str | None = None
    cost: MoneyIn | None = None
    adjustment_date: date | None = None
    member_id: uuid.UUID | None = None
    notes: str | None = None
    #: Recorded on the audit entry, not on the adjustment.
    audit_reason: str | None = Field(default=None, max_length=500)

    @field_validator("notes", mode="after")
    @classmethod
    def blank_to_none(cls, value: str | None) -> str | None:
        return _strip_optional(value)

    @field_validator("quantity_delta")
    @classmethod
    def non_zero(cls, value: int | None) -> int | None:
        if value == 0:
            raise ValueError("an adjustment of zero changes nothing")
        return value

    @field_validator("reason")
    @classmethod
    def known_reason(cls, value: str | None) -> str | None:
        if value is not None and value not in ADJUSTMENT_REASONS:
            raise ValueError(f"reason must be one of: {', '.join(ADJUSTMENT_REASONS)}")
        return value

    @model_validator(mode="after")
    def reject_explicit_nulls(self) -> "AdjustmentUpdate":
        for name in ("quantity_delta", "reason", "adjustment_date"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
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
    bucket: str
    notes: str | None
    status: str


# --------------------------------------------------------------------------- moves


class MoveCreate(BaseModel):
    """Stock changing bucket. Carries no money and never changes how much there is."""

    product_id: uuid.UUID
    quantity: int = Field(gt=0, le=MAX_QUANTITY)
    from_bucket: str = Field(pattern=f"^({'|'.join(BUCKETS)})$")
    to_bucket: str = Field(pattern=f"^({'|'.join(BUCKETS)})$")
    moved_on: date = Field(default_factory=date.today)
    member_id: uuid.UUID | None = None
    notes: str | None = None

    @field_validator("notes", mode="after")
    @classmethod
    def blank_to_none(cls, value: str | None) -> str | None:
        return _strip_optional(value)

    @model_validator(mode="after")
    def buckets_differ(self) -> "MoveCreate":
        if self.from_bucket == self.to_bucket:
            raise ValueError("a move needs two different buckets")
        return self


class MoveRead(BaseModel):
    model_config = _READ_CONFIG

    id: uuid.UUID
    product_id: uuid.UUID
    quantity: int
    from_bucket: str
    to_bucket: str = Field(validation_alias="bucket")
    moved_on: date | None
    member_id: uuid.UUID | None
    notes: str | None
    status: str


# ------------------------------------------------------------------------- history


class SalePreviewRequest(BaseModel):
    """A hypothetical sale, for the live-math panel in the record-sale form."""

    product_id: uuid.UUID
    quantity: int = Field(gt=0, le=MAX_QUANTITY)
    amount: MoneyIn = 0
    platform_fees: MoneyIn = 0
    payment_fees: MoneyIn = 0
    shipping_paid: MoneyIn = 0
    sale_date: date = Field(default_factory=date.today)


class SalePreview(BaseModel):
    """What this sale would do, computed by the real engine without writing anything.

    Exists so the client never re-implements FIFO or does money arithmetic in
    JavaScript, where 19.99 * 100 is not 1999.
    """

    quantity: int
    gross: MoneyOut
    fees: MoneyOut
    net_proceeds: MoneyOut
    #: null when the units have no known cost - never render it as zero.
    cost_basis: MoneyOutOptional
    realized_profit: MoneyOutOptional
    roi: float | None
    has_unknown_cost: bool

    #: Stock available before this sale, and what would remain after it.
    quantity_available: int
    quantity_remaining: int
    remaining_cost: MoneyOut
    #: True when this would sell more than is recorded, which needs allow_oversell.
    exceeds_stock: bool


class SaleListItem(SaleRead):
    """A sale plus its product, for the cross-product ledger.

    The product is denormalised into the row so a client rendering 50 sales makes one
    request, not 51.
    """

    product: ProductSummary


class SaleList(BaseModel):
    """Same envelope shape as ProductList, so paging works identically everywhere."""

    items: list[SaleListItem]
    total: int
    limit: int
    offset: int


class TransactionRead(BaseModel):
    """One row of a product's history, flattened so the UI renders a single list."""

    kind: str  #: purchase | sale | adjustment | move
    id: uuid.UUID
    occurred_on: date | None
    #: Signed - positive adds stock, negative removes it. Always 0 for a move, which
    #: relocates stock rather than changing how much there is.
    quantity: int
    #: Where the row acted. A move also carries `from_bucket`; everything else does not.
    bucket: str | None = None
    from_bucket: str | None = None
    amount: MoneyOutOptional = None
    #: Purchases only. `amount` is the landed total, which is what history should show but
    #: is not a column - editing it back as `amount` would add shipping and tax a second
    #: time. These are the fields a correction actually writes to.
    base_amount: MoneyOutOptional = None
    shipping: MoneyOutOptional = None
    tax: MoneyOutOptional = None
    fees: MoneyOutOptional = None
    #: Sales only, for the same reason: `amount` is gross, and a correction has to be able
    #: to reach the deductions rather than fold them into the price.
    platform_fees: MoneyOutOptional = None
    payment_fees: MoneyOutOptional = None
    shipping_paid: MoneyOutOptional = None
    cost: MoneyOutOptional = None
    profit: MoneyOutOptional = None
    has_unknown_cost: bool = False
    member_id: uuid.UUID | None = None
    label: str | None = None  #: source, marketplace, or adjustment reason
    notes: str | None = None
    status: str = "active"
