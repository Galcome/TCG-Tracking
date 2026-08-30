"""Display-only market quotes and their append-only history.

These tables are intentionally separate from ``price_snapshots``. The latter records a
manual estimate used by the Vault's appreciation report; these rows are provider quotes
that may become stale and must never be treated as cost or realized profit.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base
from src.models.mixins import TimestampMixin

QUOTE_FRESH = "fresh"
QUOTE_STALE = "stale"
QUOTE_UNAVAILABLE = "unavailable"
QUOTE_STATUSES = (QUOTE_FRESH, QUOTE_STALE, QUOTE_UNAVAILABLE)


class CurrentMarketQuote(Base, TimestampMixin):
    """The mutable last-known quote for one confirmed catalog mapping."""

    __tablename__ = "current_market_quotes"
    __table_args__ = (
        CheckConstraint(
            "status IN ('fresh', 'stale', 'unavailable')", name="ck_current_market_quotes_status"
        ),
        CheckConstraint(
            "original_value_cents IS NULL OR original_value_cents >= 0",
            name="ck_current_market_quotes_original_non_negative",
        ),
        CheckConstraint(
            "cad_value_cents IS NULL OR cad_value_cents >= 0",
            name="ck_current_market_quotes_cad_non_negative",
        ),
        UniqueConstraint("mapping_id", name="uq_current_market_quotes_mapping"),
        Index("ix_current_market_quotes_product", "product_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    mapping_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("catalog_mappings.id", ondelete="CASCADE"), nullable=False
    )
    #: Denormalised for a cheap product-list lookup. The mapping owns the identity.
    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=QUOTE_UNAVAILABLE)
    original_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    original_value_cents: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    cad_value_cents: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    #: CAD per unit of the original currency, e.g. CAD per USD.
    fx_rate: Mapped[Decimal | None] = mapped_column(Numeric(20, 10), nullable=True)
    fx_as_of: Mapped[date | None] = mapped_column(Date, nullable=True)
    #: TCGCSV's last-updated marker, retained so a daily refresh can skip unchanged data.
    source_revision: Mapped[str | None] = mapped_column(String(120), nullable=True)
    source_as_of: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_attempted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_successful_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)


class MarketPriceSnapshot(Base, TimestampMixin):
    """One successful provider quote, retained for trend/history inspection."""

    __tablename__ = "market_price_snapshots"
    __table_args__ = (
        CheckConstraint(
            "length(trim(original_currency)) = 3",
            name="ck_market_price_snapshots_currency",
        ),
        CheckConstraint(
            "original_value_cents >= 0", name="ck_market_price_snapshots_original_non_negative"
        ),
        CheckConstraint(
            "cad_value_cents >= 0", name="ck_market_price_snapshots_cad_non_negative"
        ),
        Index("ix_market_price_snapshots_product_date", "product_id", "captured_on"),
        Index("ix_market_price_snapshots_mapping_date", "mapping_id", "captured_on"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    mapping_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("catalog_mappings.id", ondelete="CASCADE"), nullable=False
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    external_product_id: Mapped[str] = mapped_column(String(120), nullable=False)
    subtype_name: Mapped[str] = mapped_column(String(80), nullable=False)
    condition: Mapped[str | None] = mapped_column(String(40), nullable=True)
    original_currency: Mapped[str] = mapped_column(String(3), nullable=False)
    original_value_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    cad_value_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    fx_rate: Mapped[Decimal] = mapped_column(Numeric(20, 10), nullable=False)
    fx_as_of: Mapped[date] = mapped_column(Date, nullable=False)
    source_revision: Mapped[str] = mapped_column(String(120), nullable=False)
    source_as_of: Mapped[date] = mapped_column(Date, nullable=False)
    captured_on: Mapped[date] = mapped_column(Date, nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
