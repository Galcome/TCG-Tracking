"""Games and product types - the user-extensible taxonomy products are filed under.

These are lookup tables rather than enums because members must be able to add their
own values (a new TCG, an unusual product format) without a migration. Rows seeded by
the initial migration are marked `is_system` so the UI can discourage renaming them.
"""

import uuid

from sqlalchemy import Boolean, CheckConstraint, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base
from src.models.mixins import TimestampMixin

DEFAULT_SORT_ORDER = 100


class _TaxonomyMixin(TimestampMixin):
    """Shared shape for the lookup tables. Not a table itself."""

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(60), nullable=False, unique=True)
    slug: Mapped[str] = mapped_column(String(60), nullable=False, unique=True)
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=DEFAULT_SORT_ORDER)


class Game(Base, _TaxonomyMixin):
    __tablename__ = "games"
    __table_args__ = (
        CheckConstraint("length(trim(name)) > 0", name="ck_games_name_present"),
        CheckConstraint("length(trim(slug)) > 0", name="ck_games_slug_present"),
    )


class ProductType(Base, _TaxonomyMixin):
    __tablename__ = "product_types"
    __table_args__ = (
        CheckConstraint("length(trim(name)) > 0", name="ck_product_types_name_present"),
        CheckConstraint("length(trim(slug)) > 0", name="ck_product_types_slug_present"),
    )
