"""Product request and response models."""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from src.models.ledger import BUCKETS
from src.schemas.ledger import BucketField, TransactionRead
from src.schemas.money import MoneyIn, MoneyOut, MoneyOutOptional
from src.schemas.taxonomy import TaxonomyRead

NAME_MAX_LENGTH = 200

# Fields on ProductUpdate that back NOT NULL columns. Omitting them leaves the value
# alone; sending an explicit null is invalid input, not a request to clear them.
NON_NULLABLE_UPDATE_FIELDS = ("name", "game_id", "product_type_id", "is_archived")


class ProductBase(BaseModel):
    set_name: str | None = Field(default=None, max_length=120)
    collector_number: str | None = Field(default=None, max_length=40)
    variant: str | None = Field(default=None, max_length=80)
    language: str | None = Field(default=None, max_length=40)
    condition: str | None = Field(default=None, max_length=40)
    grading_company: str | None = Field(default=None, max_length=40)
    grade: str | None = Field(default=None, max_length=20)
    cert_number: str | None = Field(default=None, max_length=40)
    external_ref: str | None = Field(default=None, max_length=120)
    image_url: str | None = Field(default=None, max_length=500)
    storage_location: str | None = Field(default=None, max_length=120)
    notes: str | None = None

    @field_validator(
        "set_name",
        "collector_number",
        "variant",
        "language",
        "condition",
        "grading_company",
        "grade",
        "cert_number",
        "external_ref",
        "image_url",
        "storage_location",
        "notes",
        mode="after",
    )
    @classmethod
    def blank_to_none(cls, value: str | None) -> str | None:
        """Treat whitespace-only optional input as absent rather than storing it."""
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class InitialPurchase(BaseModel):
    """The purchase recorded alongside a brand-new product.

    Optional on the API because opening-inventory and future imports create products with
    no purchase, but the UI always sends it - "how many and how much" is the whole point.
    """

    quantity: int = Field(gt=0, le=1_000_000)
    amount: MoneyIn
    shipping: MoneyIn = 0
    tax: MoneyIn = 0
    fees: MoneyIn = 0
    purchase_date: date = Field(default_factory=date.today)
    purchased_by_member_id: uuid.UUID | None = None
    source: str | None = Field(default=None, max_length=160)
    #: Where the stock lands. A case bought for the Store never has to pass through
    #: Inventory first.
    bucket: str = BucketField


class ProductCreate(ProductBase):
    name: str = Field(min_length=1, max_length=NAME_MAX_LENGTH)
    game_id: uuid.UUID
    product_type_id: uuid.UUID
    initial_purchase: InitialPurchase | None = None

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("name cannot be blank")
        return stripped


class ProductUpdate(ProductBase):
    """Every field optional - only what is sent gets changed.

    `None` here means "not supplied". Sending an explicit null for a field backing a
    NOT NULL column is rejected as invalid input rather than allowed through to fail
    as a 500.
    """

    name: str | None = Field(default=None, min_length=1, max_length=NAME_MAX_LENGTH)
    game_id: uuid.UUID | None = None
    product_type_id: uuid.UUID | None = None
    is_archived: bool | None = None

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("name cannot be blank")
        return stripped

    @model_validator(mode="after")
    def reject_explicit_nulls(self) -> "ProductUpdate":
        for field in NON_NULLABLE_UPDATE_FIELDS:
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class ProductStatsRead(BaseModel):
    """Everything derived from the ledger. Never stored, always recomputed.

    populate_by_name lets this be built either from the ProductStats dataclass (via the
    `*_cents` aliases) or from plain field names, which is how EMPTY_STATS works.
    """

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    quantity_purchased: int
    quantity_sold: int
    quantity_adjusted: int
    #: Signed on purpose. Negative stock is a data error the dashboard surfaces.
    quantity_on_hand: int

    total_invested: MoneyOut = Field(validation_alias="total_invested_cents")
    remaining_cost: MoneyOut = Field(validation_alias="remaining_cost_cents")
    cost_of_sales: MoneyOut = Field(validation_alias="cost_of_sales_cents")
    cost_written_off: MoneyOut = Field(validation_alias="cost_written_off_cents")
    gross_revenue: MoneyOut = Field(validation_alias="gross_revenue_cents")
    net_proceeds: MoneyOut = Field(validation_alias="net_proceeds_cents")
    realized_profit: MoneyOut = Field(validation_alias="realized_profit_cents")
    average_unit_cost: MoneyOutOptional = Field(validation_alias="average_unit_cost_cents")

    roi: float | None
    sale_count: int
    #: How many sales were left out of realized profit because their cost is unknown.
    sales_missing_cost: int
    #: Stock split by bucket. Sums to `quantity_on_hand` - a move takes from one bucket and
    #: gives to another, so it nets to zero.
    by_bucket: dict[str, int]


EMPTY_STATS = {
    "quantity_purchased": 0,
    "quantity_sold": 0,
    "quantity_adjusted": 0,
    "quantity_on_hand": 0,
    "total_invested": 0,
    "remaining_cost": 0,
    "cost_of_sales": 0,
    "cost_written_off": 0,
    "gross_revenue": 0,
    "net_proceeds": 0,
    "realized_profit": 0,
    "average_unit_cost": None,
    "roi": None,
    "sale_count": 0,
    "sales_missing_cost": 0,
    "by_bucket": dict.fromkeys(BUCKETS, 0),
}


class ProductRead(ProductBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    game: TaxonomyRead
    product_type: TaxonomyRead
    is_archived: bool
    created_by_member_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    stats: ProductStatsRead


class ProductDetail(ProductRead):
    """A product plus its complete, chronological transaction history."""

    history: list[TransactionRead]


class ProductList(BaseModel):
    """Explicit envelope so pagination never has to be inferred from the array."""

    items: list[ProductRead]
    total: int
    limit: int
    offset: int
    #: Units per bucket across everything the search and stock filters matched, *before*
    #: the bucket filter narrows it. That is what makes the counts on the bucket tabs
    #: describe what you would see if you pressed them, rather than what you are seeing now.
    bucket_totals: dict[str, int]
