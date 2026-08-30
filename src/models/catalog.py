"""Provider-neutral catalog identities attached to products.

A mapping is a human-confirmed link between one product in this store and one external
catalog product. It is deliberately separate from prices: a catalog identity can survive
many daily quote refreshes, and creating one never changes the ledger.
"""

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.database import Base
from src.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from src.models.product import Product

CATALOG_PROVIDER_TCGCSV = "tcgcsv"
CATALOG_PROVIDERS = (CATALOG_PROVIDER_TCGCSV,)

MAPPING_CONFIRMED = "confirmed"
MAPPING_DISABLED = "disabled"
CATALOG_MAPPING_STATUSES = (MAPPING_CONFIRMED, MAPPING_DISABLED)


class CatalogMapping(Base, TimestampMixin):
    """A manually confirmed product-to-provider catalog link."""

    __tablename__ = "catalog_mappings"
    __table_args__ = (
        CheckConstraint("length(trim(provider)) > 0", name="ck_catalog_mappings_provider_present"),
        CheckConstraint(
            "length(trim(external_product_id)) > 0",
            name="ck_catalog_mappings_external_product_present",
        ),
        CheckConstraint(
            "length(trim(subtype_name)) > 0", name="ck_catalog_mappings_subtype_present"
        ),
        CheckConstraint(
            "match_status IN ('confirmed', 'disabled')",
            name="ck_catalog_mappings_status",
        ),
        # A product has one active identity per provider. The subtype/printing is still
        # stored and used for price selection; it is not part of a global external-ID
        # uniqueness rule because several local products can share one catalog product.
        UniqueConstraint("product_id", "provider", name="uq_catalog_mappings_product_provider"),
        Index("ix_catalog_mappings_provider_status", "provider", "match_status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    external_product_id: Mapped[str] = mapped_column(String(120), nullable=False)
    #: TCGCSV needs the category and group to locate its per-group price file. Other
    #: providers may use this as an opaque grouping key later.
    external_group_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    external_category_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    #: TCGCSV calls this `subTypeName`; it distinguishes Normal, Holofoil, etc.
    subtype_name: Mapped[str] = mapped_column(String(80), nullable=False)
    #: Kept for the local product's identity. TCGCSV's market price is not condition-specific.
    condition: Mapped[str | None] = mapped_column(String(40), nullable=True)
    language: Mapped[str | None] = mapped_column(String(40), nullable=True)
    match_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=MAPPING_CONFIRMED
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_member_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id", ondelete="SET NULL"), nullable=True
    )

    # Kept as a relationship rather than denormalising product eligibility fields into
    # this identity table.  The string target avoids importing Product while the models
    # package is still registering all mapped classes.
    product: Mapped["Product"] = relationship("Product", lazy="joined")
