"""What the priced stock was worth, one row per day.

The dashboard's value chart needs history. Rebuilding it on every read from per-product price
history would cost products x days, and grow forever; the daily pricing job writes one row
instead, from the same figures the dashboard headline shows, so the two never disagree.

Display-only, like every market figure: nothing here touches cost basis or profit.
"""

import uuid
from datetime import date

from sqlalchemy import BigInteger, CheckConstraint, Date, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base
from src.models.mixins import TimestampMixin


class PortfolioSnapshot(Base, TimestampMixin):
    __tablename__ = "portfolio_snapshots"
    __table_args__ = (
        UniqueConstraint("captured_on", name="uq_portfolio_snapshots_captured_on"),
        CheckConstraint(
            "market_value_cents >= 0", name="ck_portfolio_snapshots_value_non_negative"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    captured_on: Mapped[date] = mapped_column(Date, nullable=False)
    #: Market value of the stock that had a price that day.
    market_value_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    #: What that same priced stock cost, so the gap between the lines is unrealized gain.
    priced_cost_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
