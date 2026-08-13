"""Sets - the release a product belongs to.

`products.set_name` was free text, and free text plus a suggestion list breeds near twins:
"Fable", "Fabled", "Lorcana Fable". A set rollup then splits across three rows and
undercounts all of them, which is a data-integrity problem rather than a convenience one.

So a set is a record, unique per game and case-insensitively by name. It is still created by
typing a new one - nobody should be blocked at 11pm because a set is missing - but typing
something close to an existing one is answered with "did you mean Fabled?" instead of a
silent duplicate.

`released_on` is what makes the seeded calendar maintenance-free: a set is seeded with its
date and simply starts appearing on the day it comes out. A set somebody typed themselves
has no date and is always offered, which is also what makes pre-orders work.
"""

import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, Index, String, Uuid, text
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base
from src.models.mixins import TimestampMixin


class CardSet(Base, TimestampMixin):
    __tablename__ = "card_sets"
    __table_args__ = (
        # One set per name per game, case-insensitively. This is the constraint the whole
        # feature exists for: it is what stops "Fabled" and "fabled" being two rows.
        Index(
            "uq_card_sets_game_name",
            "game_id",
            text("lower(name)"),
            unique=True,
        ),
        # Same machinery that makes product search forgiving, pointed at set names, so
        # "fab" finds Fabled and "Fable" can be told it probably means it.
        Index(
            "ix_card_sets_name_trgm",
            "name",
            postgresql_using="gin",
            postgresql_ops={"name": "gin_trgm_ops"},
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    game_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("games.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)

    #: When it came out. NULL means somebody typed it, and it is offered immediately.
    #: A seeded set with a future date stays out of the suggestions until the day itself,
    #: so the calendar needs no maintenance and cannot confidently name the wrong latest set.
    released_on: Mapped[date | None] = mapped_column(Date, nullable=True)

    created_by_member_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id"), nullable=True
    )

    # Deliberately no `game` relationship. Nothing needs it, and an eagerly joined one
    # silently broke the grouped suggestion query by adding ungrouped columns to it.
