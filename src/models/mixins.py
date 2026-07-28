"""Column mixins shared by every table."""

from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.orm import Mapped, mapped_column


class TimestampMixin:
    """created_at / updated_at, maintained by the database rather than the app.

    `created_at` is the costing engine's tiebreaker when two events share a date, so it
    must be strictly increasing per row - not merely non-null.

    That is why this uses `clock_timestamp()` and not `now()`. In Postgres `now()` is the
    *transaction* start time, identical for every row written in the same transaction. Two
    sales inserted together would tie, and the engine would fall through to comparing random
    UUIDs, making FIFO order non-deterministic. `clock_timestamp()` is the real wall clock at
    insert, so insertion order is preserved.
    """

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.clock_timestamp(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.clock_timestamp(),
        onupdate=func.clock_timestamp(),
        nullable=False,
    )
