"""Cracking a case open, and undoing it.

One endpoint for now. Ripping a box and returning a card from grading are the same
primitive with a different cost split, and they get their own endpoints when their screens
exist rather than a `kind` parameter nobody can read at the call site.
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.dependencies import db_session, get_current_member
from src.models.ledger import BUCKET_INVENTORY, BUCKETS, STATUS_ACTIVE
from src.models.member import Member
from src.models.product import Product
from src.models.transformation import TRANSFORM_CRACK, Transformation, TransformationOutput
from src.schemas.ledger import VoidRequest
from src.schemas.money import MoneyOutOptional
from src.services import transformations

router = APIRouter()

MAX_OUTPUT_UNITS = 10_000


class OutputRequest(BaseModel):
    """One product coming out, into one bucket.

    The same product into two buckets is two entries - "6 boxes: 4 to the Store, 1 to
    Inventory, 1 to the Vault" is three - because a bucket belongs to stock, not to a
    product.
    """

    product_id: uuid.UUID
    quantity: int = Field(gt=0, le=MAX_OUTPUT_UNITS)
    bucket: str = Field(default=BUCKET_INVENTORY, pattern=f"^({'|'.join(BUCKETS)})$")


class CrackRequest(BaseModel):
    """Open sealed cases into what was inside them."""

    product_id: uuid.UUID
    #: How many cases. Usually one.
    quantity: int = Field(default=1, gt=0, le=1_000)
    from_bucket: str = Field(default=BUCKET_INVENTORY, pattern=f"^({'|'.join(BUCKETS)})$")
    outputs: list[OutputRequest] = Field(min_length=1)
    occurred_on: date = Field(default_factory=date.today)
    notes: str | None = None

    @field_validator("notes", mode="after")
    @classmethod
    def blank_to_none(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None

    @model_validator(mode="after")
    def one_entry_per_product_and_bucket(self) -> "CrackRequest":
        seen = {(output.product_id, output.bucket) for output in self.outputs}
        if len(seen) != len(self.outputs):
            raise ValueError("each product and bucket combination can only appear once")
        return self


class OutputRead(BaseModel):
    # populate_by_name so these can be built by field name here as well as read off
    # the ORM through the *_cents aliases.
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    product_id: uuid.UUID
    product_name: str
    quantity: int
    bucket: str
    #: This row's share of what the source cost. null when the source's cost is unknown.
    cost: MoneyOutOptional = Field(validation_alias="cost_cents")


class TransformationRead(BaseModel):
    # populate_by_name so these can be built by field name here as well as read off
    # the ORM through the *_cents aliases.
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: uuid.UUID
    kind: str
    source_product_id: uuid.UUID
    source_product_name: str
    source_quantity: int
    source_bucket: str
    occurred_on: date | None
    #: What the outputs are dated from - the lot the source came out of, not the day it
    #: was opened. This is what stops cracking from resetting the ageing clock.
    inherited_purchase_date: date | None
    source_cost: MoneyOutOptional = Field(validation_alias="source_cost_cents")
    outputs: list[OutputRead]
    notes: str | None
    status: str


def _read(db: Session, record: Transformation) -> TransformationRead:
    rows = db.execute(
        select(TransformationOutput, Product.name)
        .join(Product, Product.id == TransformationOutput.product_id)
        .where(TransformationOutput.transformation_id == record.id)
        .order_by(TransformationOutput.bucket, Product.name)
    ).all()
    source_name = db.scalar(select(Product.name).where(Product.id == record.source_product_id))

    return TransformationRead(
        id=record.id,
        kind=record.kind,
        source_product_id=record.source_product_id,
        source_product_name=source_name or "",
        source_quantity=record.source_quantity,
        source_bucket=record.source_bucket,
        occurred_on=record.occurred_on,
        inherited_purchase_date=record.inherited_purchase_date,
        source_cost=record.source_cost_cents,
        outputs=[
            OutputRead(
                product_id=output.product_id,
                product_name=name,
                quantity=output.quantity,
                bucket=output.bucket,
                cost=output.cost_cents,
            )
            for output, name in rows
        ],
        notes=record.notes,
        status=record.status,
    )


@router.post("/crack", response_model=TransformationRead, status_code=status.HTTP_201_CREATED)
def crack_case(
    payload: CrackRequest,
    member: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> TransformationRead:
    """Open sealed cases into the boxes inside them.

    Refused when the bucket does not hold enough, for the same reason a move is: opening a
    case you do not have describes nothing that happened, so the honest fix is the data.

    Cracking is always a decision. A case can equally be sold whole, so nothing here
    happens automatically.
    """
    if db.get(Product, payload.product_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    available = transformations.available_in_bucket(
        db, payload.product_id, payload.from_bucket
    )
    if payload.quantity > available:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"{payload.from_bucket} holds {available}, so {payload.quantity} cannot be "
                "opened out of it"
            ),
        )

    for output in payload.outputs:
        if db.get(Product, output.product_id) is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="One of the products coming out does not exist",
            )
        if output.product_id == payload.product_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="A case cannot come out of itself",
            )

    record = transformations.transform(
        db,
        kind=TRANSFORM_CRACK,
        source_product_id=payload.product_id,
        source_quantity=payload.quantity,
        source_bucket=payload.from_bucket,
        outputs=[
            transformations.OutputSpec(
                product_id=output.product_id, quantity=output.quantity, bucket=output.bucket
            )
            for output in payload.outputs
        ],
        occurred_on=payload.occurred_on,
        member_id=member.id,
        notes=payload.notes,
    )
    return _read(db, record)


@router.get("", response_model=list[TransformationRead])
def list_transformations(
    product_id: uuid.UUID | None = Query(default=None),
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> list[TransformationRead]:
    """What has been opened, newest first.

    Filtered by `product_id` this answers both directions: what this product was opened
    into, and what it came out of.
    """
    statement = select(Transformation)
    if product_id is not None:
        statement = statement.where(
            (Transformation.source_product_id == product_id)
            | (
                Transformation.id.in_(
                    select(TransformationOutput.transformation_id).where(
                        TransformationOutput.product_id == product_id
                    )
                )
            )
        )

    records = db.scalars(
        statement.order_by(
            Transformation.occurred_on.desc().nullslast(), Transformation.created_at.desc()
        )
    ).all()
    return [_read(db, record) for record in records]


@router.post("/{transformation_id}/void", response_model=TransformationRead)
def void_transformation(
    transformation_id: uuid.UUID,
    payload: VoidRequest,
    member: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> TransformationRead:
    """Undo it. The case comes back, the boxes go away, and the row stays as the reason."""
    record = db.get(Transformation, transformation_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Transformation not found"
        )
    if record.status != STATUS_ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This has already been voided"
        )

    transformations.void(db, record, member_id=member.id, reason=payload.reason)
    return _read(db, record)
