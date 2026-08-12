"""The ledger: purchases, sales, inventory adjustments, and their cost allocations.

Every money column is BIGINT cents. Nothing here stores a quantity on hand or a profit -
those are always derived from these rows by src/services/costing.py, so there is no second
source of truth to drift.

Rows are never deleted. `status` moves to 'voided' and the costing engine simply stops
seeing them, which keeps financial history auditable.
"""

import uuid
from datetime import date

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base
from src.models.mixins import TimestampMixin

STATUS_ACTIVE = "active"
STATUS_VOIDED = "voided"

DEFAULT_CURRENCY = "CAD"

# Adjustment reasons. Positive deltas add stock, negative ones remove it; the sign lives in
# quantity_delta rather than being implied by the reason, so a correction can go either way.
ADJUSTMENT_REASONS = (
    "opening_inventory",
    "correction",
    "damaged",
    "missing",
    "opened",
    "given_away",
    "personal_use",
    "returned",
    "written_off",
    "other",
)

_STATUS_CHECK = "status IN ('active', 'voided')"

# Where stock sits. These are *intent*, not a place: all three can be the same basement.
# Whose house it is in stays `products.storage_location`, which answers a different question.
#
#   inventory - bought and held
#   store     - moved there to sell
#   vault     - a deliberate long-term hold
#
# Deliberately orthogonal to cost. A unit's cost basis comes from its purchase lot wherever
# it sits, so FIFO stays product-wide and the costing engine never has to know buckets exist.
BUCKET_INVENTORY = "inventory"
BUCKET_STORE = "store"
BUCKET_VAULT = "vault"
BUCKETS = (BUCKET_INVENTORY, BUCKET_STORE, BUCKET_VAULT)

_BUCKET_CHECK = "bucket IN ('inventory', 'store', 'vault')"


class _LedgerEntry(TimestampMixin):
    """Columns every ledger row carries."""

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default=STATUS_ACTIVE)
    void_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default=DEFAULT_CURRENCY)
    #: Which bucket this row lands stock in, sells it from, or adjusts. Existing rows
    #: backfill to `inventory`, which is what they always implicitly were.
    bucket: Mapped[str] = mapped_column(String(16), nullable=False, default=BUCKET_INVENTORY)


class Purchase(Base, _LedgerEntry):
    """Adds stock and establishes cost basis."""

    __tablename__ = "purchases"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_purchases_quantity_positive"),
        CheckConstraint("gross_amount_cents >= 0", name="ck_purchases_gross_non_negative"),
        CheckConstraint("shipping_cents >= 0", name="ck_purchases_shipping_non_negative"),
        CheckConstraint("tax_cents >= 0", name="ck_purchases_tax_non_negative"),
        CheckConstraint("fees_cents >= 0", name="ck_purchases_fees_non_negative"),
        CheckConstraint(_STATUS_CHECK, name="ck_purchases_status"),
        CheckConstraint(_BUCKET_CHECK, name="ck_purchases_bucket"),
        Index("ix_purchases_product_status", "product_id", "status"),
    )

    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)

    gross_amount_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    shipping_cents: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    tax_cents: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    fees_cents: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)

    purchase_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    source: Mapped[str | None] = mapped_column(String(160), nullable=True)

    purchased_by_member_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id"), nullable=True
    )
    created_by_member_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id"), nullable=True
    )

    @property
    def landed_cost_cents(self) -> int:
        """What the store actually paid to get these units on the shelf."""
        return self.gross_amount_cents + self.shipping_cents + self.tax_cents + self.fees_cents


class Sale(Base, _LedgerEntry):
    """Removes stock and records revenue.

    `sale_date` is nullable on purpose: imported history often has no date, and inventing
    one would put fiction into time-filtered reports.
    """

    __tablename__ = "sales"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_sales_quantity_positive"),
        CheckConstraint("gross_amount_cents >= 0", name="ck_sales_gross_non_negative"),
        CheckConstraint("platform_fees_cents >= 0", name="ck_sales_platform_fees_non_negative"),
        CheckConstraint("payment_fees_cents >= 0", name="ck_sales_payment_fees_non_negative"),
        CheckConstraint("shipping_paid_cents >= 0", name="ck_sales_shipping_non_negative"),
        CheckConstraint(_STATUS_CHECK, name="ck_sales_status"),
        CheckConstraint(_BUCKET_CHECK, name="ck_sales_bucket"),
        Index("ix_sales_product_status", "product_id", "status"),
    )

    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)

    gross_amount_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    platform_fees_cents: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    payment_fees_cents: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    shipping_paid_cents: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)

    sale_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    marketplace: Mapped[str | None] = mapped_column(String(120), nullable=True)

    sold_by_member_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id"), nullable=True
    )
    created_by_member_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id"), nullable=True
    )

    # Maintained by the costing engine, never set by hand. NULL means the cost is genuinely
    # unknown, which is different from zero and must stay distinguishable.
    cost_basis_cents: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    has_unknown_cost: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    #: Quantity-weighted shelf time of the units sold, in days. Engine-maintained.
    #: NULL when any consumed lot has no purchase date - never a guess.
    days_held_weighted: Mapped[int | None] = mapped_column(Integer, nullable=True)

    @property
    def net_proceeds_cents(self) -> int:
        return (
            self.gross_amount_cents
            - self.platform_fees_cents
            - self.payment_fees_cents
            - self.shipping_paid_cents
        )

    @property
    def realized_profit_cents(self) -> int | None:
        """None when cost is unknown. Never a guess."""
        if self.cost_basis_cents is None:
            return None
        return self.net_proceeds_cents - self.cost_basis_cents


class InventoryAdjustment(Base, _LedgerEntry):
    """Stock moving for any reason other than a purchase or a sale.

    A positive delta with no `landed_cost_cents` is stock of unknown cost - counting in
    something the store already had. A negative delta consumes lots like a sale does, but
    its cost is reported as written off rather than as a cost of sale.
    """

    __tablename__ = "inventory_adjustments"
    __table_args__ = (
        CheckConstraint("quantity_delta <> 0", name="ck_adjustments_delta_non_zero"),
        CheckConstraint(
            "landed_cost_cents IS NULL OR landed_cost_cents >= 0",
            name="ck_adjustments_cost_non_negative",
        ),
        # A cost only means anything when stock is being added.
        CheckConstraint(
            "quantity_delta > 0 OR landed_cost_cents IS NULL",
            name="ck_adjustments_cost_only_on_additions",
        ),
        CheckConstraint(
            "reason IN ('opening_inventory', 'correction', 'damaged', 'missing', 'opened', "
            "'given_away', 'personal_use', 'returned', 'written_off', 'other')",
            name="ck_adjustments_reason",
        ),
        CheckConstraint(_STATUS_CHECK, name="ck_adjustments_status"),
        CheckConstraint(_BUCKET_CHECK, name="ck_adjustments_bucket"),
        Index("ix_adjustments_product_status", "product_id", "status"),
    )

    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id"), nullable=False)
    quantity_delta: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(String(24), nullable=False)
    landed_cost_cents: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    adjustment_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    member_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("members.id"), nullable=True)
    created_by_member_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id"), nullable=True
    )

    #: Cost removed from inventory by a negative adjustment. Engine-maintained.
    cost_removed_cents: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    has_unknown_cost: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class StockMove(Base, _LedgerEntry):
    """Stock changing bucket. Never changes how much there is, only where it sits.

    A move is a transaction like any other so the history stays reconstructable - which is
    what makes "moved to Vault after 180 days in Store" answerable, and stops the Vault
    quietly becoming where slow stock goes to be forgotten.

    It carries no money at all. Cost basis follows the purchase lot, not the bucket, so the
    costing engine never sees these rows.

    `bucket` on the base class is the destination; `from_bucket` is the source.
    """

    __tablename__ = "stock_moves"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_moves_quantity_positive"),
        CheckConstraint("from_bucket <> bucket", name="ck_moves_buckets_differ"),
        CheckConstraint(
            "from_bucket IN ('inventory', 'store', 'vault')", name="ck_moves_from_bucket"
        ),
        CheckConstraint(_STATUS_CHECK, name="ck_moves_status"),
        CheckConstraint(_BUCKET_CHECK, name="ck_moves_bucket"),
        Index("ix_moves_product_status", "product_id", "status"),
    )

    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    from_bucket: Mapped[str] = mapped_column(String(16), nullable=False)
    moved_on: Mapped[date | None] = mapped_column(Date, nullable=True)

    member_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("members.id"), nullable=True)
    created_by_member_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id"), nullable=True
    )


class CostAllocation(Base):
    """Which supply event funded which consumer, and for how much.

    Wholly rebuilt by the costing engine on every write; never edited by hand. Exists so
    "this sale consumed 2 units from the March 14 purchase" is a checkable fact rather than
    something recomputed differently by each reader.

    `cost_cents IS NULL` marks a slice of genuinely unknown cost.
    """

    __tablename__ = "cost_allocations"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_allocations_quantity_positive"),
        CheckConstraint(
            "cost_cents IS NULL OR cost_cents >= 0", name="ck_allocations_cost_non_negative"
        ),
        # Exactly one consumer. Real foreign keys instead of a polymorphic id, so the
        # database can still enforce referential integrity.
        CheckConstraint(
            "(sale_id IS NOT NULL)::int + (adjustment_consumer_id IS NOT NULL)::int = 1",
            name="ck_allocations_one_consumer",
        ),
        # At most one supply. Zero means the shortfall case: sold more than was ever bought.
        CheckConstraint(
            "(purchase_id IS NOT NULL)::int + (adjustment_supply_id IS NOT NULL)::int <= 1",
            name="ck_allocations_at_most_one_supply",
        ),
        # A slice with no supply cannot claim a cost.
        CheckConstraint(
            "purchase_id IS NOT NULL OR adjustment_supply_id IS NOT NULL OR cost_cents IS NULL",
            name="ck_allocations_shortfall_has_no_cost",
        ),
        Index("ix_allocations_product", "product_id"),
        Index("ix_allocations_sale", "sale_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id"), nullable=False
    )

    purchase_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("purchases.id"), nullable=True
    )
    adjustment_supply_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("inventory_adjustments.id"), nullable=True
    )

    sale_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("sales.id"), nullable=True)
    adjustment_consumer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("inventory_adjustments.id"), nullable=True
    )

    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    cost_cents: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
