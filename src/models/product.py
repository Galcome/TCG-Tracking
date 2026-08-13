"""Products - a reusable description of something the store can own.

A product carries no quantity and no money. Stock and cost basis are always derived
from the transactions that reference it, never stored here.

`search_text` is a stored generated column concatenating the fields worth searching.
It exists so one trigram index can serve name, set, collector number, certification
number and free-text notes at once, and so the search query never has to build that
concatenation at runtime.
"""

import uuid

from sqlalchemy import Boolean, CheckConstraint, Computed, ForeignKey, Index, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.database import Base
from src.models.card_set import CardSet
from src.models.member import Member
from src.models.mixins import TimestampMixin
from src.models.taxonomy import Game, ProductType

SEARCH_TEXT_EXPRESSION = (
    "coalesce(name, '') || ' ' || "
    "coalesce(set_name, '') || ' ' || "
    "coalesce(collector_number, '') || ' ' || "
    "coalesce(cert_number, '') || ' ' || "
    "coalesce(storage_location, '') || ' ' || "
    "coalesce(notes, '')"
)


class Product(Base, TimestampMixin):
    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint("length(trim(name)) > 0", name="ck_products_name_present"),
        # Declared here as well as in the migration so `alembic check` stays clean and
        # a future --autogenerate does not helpfully drop the search index.
        Index(
            "ix_products_search_text_trgm",
            "search_text",
            postgresql_using="gin",
            postgresql_ops={"search_text": "gin_trgm_ops"},
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    game_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("games.id"), nullable=False, index=True)
    product_type_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("product_types.id"), nullable=False, index=True
    )

    # Optional identity detail. None of this is required to track an item.
    #: The set this belongs to. Authoritative - `set_name` below is a copy of its name.
    set_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("card_sets.id"), nullable=True, index=True
    )
    #: Denormalised from `set_id`, and written only by the resolver that assigns it.
    #:
    #: It exists because `search_text` is a stored generated column, and a generated column
    #: cannot join to another table. Dropping it would mean either losing set names from
    #: product search or replacing the generated column with a trigger, both worse than one
    #: copy maintained in one place.
    set_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    collector_number: Mapped[str | None] = mapped_column(String(40), nullable=True)
    variant: Mapped[str | None] = mapped_column(String(80), nullable=True)
    language: Mapped[str | None] = mapped_column(String(40), nullable=True)
    condition: Mapped[str | None] = mapped_column(String(40), nullable=True)
    grading_company: Mapped[str | None] = mapped_column(String(40), nullable=True)
    grade: Mapped[str | None] = mapped_column(String(20), nullable=True)
    cert_number: Mapped[str | None] = mapped_column(String(40), nullable=True)
    external_ref: Mapped[str | None] = mapped_column(String(120), nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    storage_location: Mapped[str | None] = mapped_column(String(120), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    created_by_member_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id"), nullable=True
    )

    search_text: Mapped[str] = mapped_column(
        Text, Computed(SEARCH_TEXT_EXPRESSION, persisted=True), nullable=False
    )

    card_set: Mapped["CardSet | None"] = relationship(lazy="joined")
    game: Mapped[Game] = relationship(lazy="joined")
    product_type: Mapped[ProductType] = relationship(lazy="joined")
    created_by: Mapped[Member | None] = relationship(lazy="joined")
