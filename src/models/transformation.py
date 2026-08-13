"""Transformations: stock of one product becoming stock of another.

Case into boxes, box into cards, raw card into a graded card. All the same operation -
consume stock of one product, produce stock of another, carry the cost across - which is
why it is one table rather than three features.

Two things travel with the cost and make every downstream report possible:

**The original purchase date.** Boxes out of a case inherit the case's date, not the day it
was cracked. Otherwise cracking resets the ageing clock and the money-asleep report quietly
forgets the group has held it a year.

**Parentage.** Every produced row knows what it came from, so "this graded card was a hit
out of a box out of the Fabled case" is a chain something can walk. Without it the lineage
rollup cannot exist at all.

Nothing here holds a quantity or a cost of its own that the ledger does not also hold. A
transformation writes an adjustment that consumes the source and purchases that produce the
outputs, and those rows are what stock and cost basis are computed from - exactly as they
are for anything else.
"""

import uuid
from datetime import date

from sqlalchemy import (
    BigInteger,
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
from src.models.ledger import BUCKET_INVENTORY, STATUS_ACTIVE
from src.models.mixins import TimestampMixin

#: A sealed case opened into the boxes it contained. Deterministic: N identical boxes,
#: cost split N ways.
TRANSFORM_CRACK = "crack"
#: A box or packs opened for what is inside. A lottery, not a division - see the rip screen.
TRANSFORM_RIP = "rip"
#: A raw card back from the grader as a graded one. One in, one out, plus fees.
TRANSFORM_GRADE = "grade"
TRANSFORM_KINDS = (TRANSFORM_CRACK, TRANSFORM_RIP, TRANSFORM_GRADE)

_KIND_CHECK = "kind IN ('crack', 'rip', 'grade')"
_STATUS_CHECK = "status IN ('active', 'voided')"


class Transformation(Base, TimestampMixin):
    """One thing becoming another. The outputs live in `transformation_outputs`."""

    __tablename__ = "transformations"
    __table_args__ = (
        CheckConstraint(_KIND_CHECK, name="ck_transformations_kind"),
        CheckConstraint(_STATUS_CHECK, name="ck_transformations_status"),
        CheckConstraint("source_quantity > 0", name="ck_transformations_source_positive"),
        Index("ix_transformations_source", "source_product_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)

    source_product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id"), nullable=False
    )
    source_quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    #: Which bucket the source came out of.
    source_bucket: Mapped[str] = mapped_column(
        String(16), nullable=False, default=BUCKET_INVENTORY
    )

    #: The day it was opened. Deliberately *not* what the outputs inherit - see below.
    occurred_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    #: The purchase date the outputs carry, taken from the lot the source came from. This
    #: is the field that stops cracking from resetting the ageing clock.
    inherited_purchase_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    #: What the consumed units cost, per FIFO, at the moment it happened. Split across the
    #: outputs. NULL when the source's cost is genuinely unknown, which stays unknown.
    source_cost_cents: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    #: Cost the outputs did not take, written off as bulk. A ripped box's leftovers are
    #: never an asset - the group has said outright it would never rip something to sell
    #: the bulk - so the remainder is a write-off at rip time and a bad rip looks bad
    #: straight away rather than at some tidier moment later.
    bulk_cost_cents: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)

    #: The adjustment that took the source out of stock. Voiding the transformation voids it.
    consuming_adjustment_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("inventory_adjustments.id"), nullable=True
    )

    status: Mapped[str] = mapped_column(String(10), nullable=False, default=STATUS_ACTIVE)
    void_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by_member_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id"), nullable=True
    )


class TransformationOutput(Base):
    """One product that came out, in one bucket, with its share of the source's cost.

    The same product in two buckets is two rows - "6 boxes: 4 to the Store, 1 to Inventory,
    1 to the Vault" is three rows, because a bucket is a property of stock and not of the
    product.
    """

    __tablename__ = "transformation_outputs"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_transformation_outputs_quantity_positive"),
        CheckConstraint(
            "cost_cents IS NULL OR cost_cents >= 0",
            name="ck_transformation_outputs_cost_non_negative",
        ),
        Index("ix_transformation_outputs_transformation", "transformation_id"),
        Index("ix_transformation_outputs_product", "product_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    transformation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("transformations.id", ondelete="CASCADE"), nullable=False
    )
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    bucket: Mapped[str] = mapped_column(String(16), nullable=False, default=BUCKET_INVENTORY)

    #: This row's share of `source_cost_cents`. NULL when the source's cost is unknown.
    cost_cents: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    #: The purchase this became. That row is what stock and FIFO actually see; this one is
    #: the record of where it came from.
    purchase_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("purchases.id"), nullable=True
    )
