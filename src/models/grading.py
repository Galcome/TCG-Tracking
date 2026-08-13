"""Cards sent away to be graded.

Joseph's decision: a card at the grader **keeps its bucket** and carries a flag, rather than
moving to an "Out" state. The argument for a separate state was that the card is not
physically in the house; the argument against is that it is still the group's stock and
still their money. The flag wins, with one condition attached to it - it carries the date it
was sent, and anything out shows a day count. That recovers most of the protection a
separate state would have given, which was stopping cards from quietly sitting at PSA for
months.

The **return** is the transformation, not the send. The grade is unknown when it leaves, so
there is nothing to produce until it comes back. On return the raw card is consumed and a
graded one is produced, carrying the raw cost **plus the fees** - without that every graded
card's ROI is overstated by roughly the fee.

A PSA 7 that comes back worth less than raw uses the identical mechanic. The loss is simply
visible, which is the point of measuring grading at all.
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
from src.models.ledger import BUCKET_INVENTORY
from src.models.mixins import TimestampMixin

#: At the grader. Still the group's stock, still in its bucket, with a day count on it.
GRADING_OUT = "out"
#: Back, and turned into a graded product.
GRADING_RETURNED = "returned"
#: Sent by mistake, or the submission was cancelled.
GRADING_VOIDED = "voided"
GRADING_STATUSES = (GRADING_OUT, GRADING_RETURNED, GRADING_VOIDED)


class GradingSubmission(Base, TimestampMixin):
    __tablename__ = "grading_submissions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('out', 'returned', 'voided')", name="ck_grading_status"
        ),
        CheckConstraint("quantity > 0", name="ck_grading_quantity_positive"),
        CheckConstraint("fees_cents >= 0", name="ck_grading_fees_non_negative"),
        Index("ix_grading_product_status", "product_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    #: The bucket it stays in while it is away. It never leaves.
    bucket: Mapped[str] = mapped_column(
        String(16), nullable=False, default=BUCKET_INVENTORY
    )

    #: What it is at the grader for, and when it went. The date is what makes the day count
    #: on the card possible, which is the whole reason the flag was acceptable.
    grading_company: Mapped[str | None] = mapped_column(String(40), nullable=True)
    sent_on: Mapped[date] = mapped_column(Date, nullable=False)

    #: Grading, shipping and insurance together. Real money, and it raises the cost basis
    #: of whatever comes back - the same way shipping and tax raise a purchase's.
    fees_cents: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)

    status: Mapped[str] = mapped_column(String(10), nullable=False, default=GRADING_OUT)
    returned_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    grade: Mapped[str | None] = mapped_column(String(20), nullable=True)
    #: The transformation the return produced. Null while it is still away.
    transformation_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("transformations.id"), nullable=True
    )

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    void_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_member_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id"), nullable=True
    )
