"""What something was thought to be worth, on a day.

A snapshot is an **estimate**, and estimates never touch cost basis or realized profit.
They inform decisions; they do not score them. Letting a typed value move profit would be
the group marking its own homework.

The reason this table exists now, rather than with the parked price feed, is the rip
screen. Pulling a card and calling it $50 out of a $150 box reads as being $100 down that
day - and that is a true statement of that day, not a bug. What the app owes is the
*journey*: cost fixed at $150, estimate $50 on day zero, sold for $1,500 on day 400. One
number cannot say that; two dated ones can.
"""

import uuid
from datetime import date

from sqlalchemy import BigInteger, CheckConstraint, Date, ForeignKey, Index, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base
from src.models.mixins import TimestampMixin

#: Somebody typed it. The only source there is today; a price feed would add its own.
SOURCE_TYPED = "typed"
SNAPSHOT_SOURCES = (SOURCE_TYPED,)


class PriceSnapshot(Base, TimestampMixin):
    __tablename__ = "price_snapshots"
    __table_args__ = (
        CheckConstraint("value_cents >= 0", name="ck_price_snapshots_value_non_negative"),
        CheckConstraint("source IN ('typed')", name="ck_price_snapshots_source"),
        Index("ix_price_snapshots_product_date", "product_id", "captured_on"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id"), nullable=False)

    #: Per unit, in cents. What one of these was thought to be worth that day.
    value_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    captured_on: Mapped[date] = mapped_column(Date, nullable=False)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default=SOURCE_TYPED)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_member_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id"), nullable=True
    )
