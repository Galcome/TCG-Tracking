"""Sending cards to be graded, and taking them back.

The send moves nothing. Joseph chose a flag over an "Out" state, so the card keeps its
bucket and carries the date it went - and the day count that date makes possible is the
condition the flag was accepted on. It is what stops a card quietly sitting at PSA for
months.

The **return** is the transformation. The grade is unknown when it leaves, so there is
nothing to produce until it comes back.
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.dependencies import db_session, get_current_member
from src.models.grading import GRADING_OUT, GRADING_RETURNED, GRADING_VOIDED, GradingSubmission
from src.models.ledger import BUCKET_INVENTORY, BUCKETS
from src.models.member import Member
from src.models.product import Product
from src.models.transformation import TRANSFORM_GRADE
from src.schemas.ledger import VoidRequest
from src.schemas.money import MoneyIn, MoneyOut
from src.services import transformations

router = APIRouter()

BUCKET_PATTERN = f"^({'|'.join(BUCKETS)})$"


class SubmitRequest(BaseModel):
    """Send cards away. Nothing leaves stock; the card is flagged where it sits."""

    product_id: uuid.UUID
    quantity: int = Field(default=1, gt=0, le=1_000)
    bucket: str = Field(default=BUCKET_INVENTORY, pattern=BUCKET_PATTERN)
    grading_company: str | None = Field(default=None, max_length=40)
    sent_on: date = Field(default_factory=date.today)
    #: Grading, shipping and insurance together. Raises the cost basis of what comes back,
    #: exactly as shipping and tax raise a purchase's - without it every graded card's ROI
    #: is overstated by roughly the fee.
    fees: MoneyIn = 0
    notes: str | None = None

    @field_validator("grading_company", "notes", mode="after")
    @classmethod
    def blank_to_none(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class ReturnRequest(BaseModel):
    """It came back. Now there is a grade, so now there is something to produce."""

    #: The graded product it becomes. Created by the caller, named from the raw card plus
    #: the grader and grade - a default that is shown and editable, never silently applied.
    graded_product_id: uuid.UUID
    grade: str | None = Field(default=None, max_length=20)
    returned_on: date = Field(default_factory=date.today)
    #: Anything not known when it was sent. Added to the fees already recorded.
    extra_fees: MoneyIn = 0
    notes: str | None = None

    @field_validator("grade", "notes", mode="after")
    @classmethod
    def blank_to_none(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class SubmissionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: uuid.UUID
    product_id: uuid.UUID
    product_name: str
    quantity: int
    bucket: str
    grading_company: str | None
    sent_on: date
    fees: MoneyOut = Field(validation_alias="fees_cents")
    status: str
    returned_on: date | None
    grade: str | None
    #: How long it has been away, or how long it took. The number the flag exists for.
    days_out: int
    notes: str | None


def _read(db: Session, record: GradingSubmission, today: date | None = None) -> SubmissionRead:
    reference = today or date.today()
    finished = record.returned_on or reference
    name = db.scalar(select(Product.name).where(Product.id == record.product_id))

    return SubmissionRead(
        id=record.id,
        product_id=record.product_id,
        product_name=name or "",
        quantity=record.quantity,
        bucket=record.bucket,
        grading_company=record.grading_company,
        sent_on=record.sent_on,
        fees=record.fees_cents,
        status=record.status,
        returned_on=record.returned_on,
        grade=record.grade,
        days_out=(finished - record.sent_on).days,
        notes=record.notes,
    )


@router.post("", response_model=SubmissionRead, status_code=status.HTTP_201_CREATED)
def submit(
    payload: SubmitRequest,
    member: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> SubmissionRead:
    """Send cards to a grader.

    Deliberately does not move stock. The card is still the group's and still their money,
    so it stays in its bucket with a flag and a date on it.
    """
    if db.get(Product, payload.product_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    available = transformations.available_in_bucket(db, payload.product_id, payload.bucket)
    if payload.quantity > available:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{payload.bucket} holds {available}, so {payload.quantity} cannot be sent",
        )

    record = GradingSubmission(
        product_id=payload.product_id,
        quantity=payload.quantity,
        bucket=payload.bucket,
        grading_company=payload.grading_company,
        sent_on=payload.sent_on,
        fees_cents=payload.fees,
        notes=payload.notes,
        created_by_member_id=member.id,
    )
    db.add(record)
    db.flush()
    return _read(db, record)


@router.get("", response_model=list[SubmissionRead])
def list_submissions(
    product_id: uuid.UUID | None = Query(default=None),
    out_only: bool = Query(default=False, description="Only what is still away"),
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> list[SubmissionRead]:
    """What is at the grader, longest away first.

    Sorted that way on purpose: the whole reason a flag was acceptable instead of a
    separate state is that the oldest submission is the one worth chasing.
    """
    statement = select(GradingSubmission)
    if product_id is not None:
        statement = statement.where(GradingSubmission.product_id == product_id)
    if out_only:
        statement = statement.where(GradingSubmission.status == GRADING_OUT)

    records = db.scalars(
        statement.order_by(GradingSubmission.sent_on.asc(), GradingSubmission.created_at.asc())
    ).all()
    return [_read(db, record) for record in records]


@router.post("/{submission_id}/return", response_model=SubmissionRead)
def take_back(
    submission_id: uuid.UUID,
    payload: ReturnRequest,
    member: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> SubmissionRead:
    """It came back. The raw card is consumed and the graded one produced.

    Cost carries across **plus the fees**. A PSA 7 that comes back worth less than raw uses
    the identical mechanic - the loss is simply visible, which is the point of measuring
    grading at all.
    """
    record = db.get(GradingSubmission, submission_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found"
        )
    if record.status != GRADING_OUT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This submission is no longer out",
        )
    if db.get(Product, payload.graded_product_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="The graded product does not exist"
        )
    if payload.graded_product_id == record.product_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="The graded card has to be a different product from the raw one",
        )

    fees = record.fees_cents + payload.extra_fees

    produced = transformations.transform(
        db,
        kind=TRANSFORM_GRADE,
        source_product_id=record.product_id,
        source_quantity=record.quantity,
        source_bucket=record.bucket,
        outputs=[
            transformations.OutputSpec(
                product_id=payload.graded_product_id,
                quantity=record.quantity,
                bucket=record.bucket,
            )
        ],
        occurred_on=payload.returned_on,
        member_id=member.id,
        notes=payload.notes,
        # Whatever the raw card cost, plus what it cost to grade it. Both are real money
        # this card has absorbed, and leaving the fees out would overstate its ROI.
        added_cost=fees,
    )

    record.status = GRADING_RETURNED
    record.returned_on = payload.returned_on
    record.grade = payload.grade
    record.fees_cents = fees
    record.transformation_id = produced.id
    if payload.notes:
        record.notes = payload.notes
    db.flush()

    return _read(db, record)


@router.post("/{submission_id}/void", response_model=SubmissionRead)
def void_submission(
    submission_id: uuid.UUID,
    payload: VoidRequest,
    member: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> SubmissionRead:
    """Cancel a submission that never should have existed. Nothing moved, so nothing undoes."""
    record = db.get(GradingSubmission, submission_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found"
        )
    if record.status != GRADING_OUT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only something still out can be cancelled",
        )

    record.status = GRADING_VOIDED
    record.void_reason = payload.reason
    record.created_by_member_id = record.created_by_member_id or member.id
    db.flush()
    return _read(db, record)
