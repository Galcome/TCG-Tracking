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
from src.models.price_snapshot import PriceSnapshot
from src.models.product import Product
from src.models.transformation import (
    TRANSFORM_CRACK,
    TRANSFORM_RIP,
    Transformation,
    TransformationOutput,
)
from src.schemas.ledger import VoidRequest
from src.schemas.money import MoneyIn, MoneyOut, MoneyOutOptional
from src.services import inventory, transformations
from src.services.money import proportional_split

router = APIRouter()

MAX_OUTPUT_UNITS = 10_000

BUCKET_PATTERN = f"^({chr(124).join(BUCKETS)})$"


class OutputRequest(BaseModel):
    """One product coming out, into one bucket.

    The same product into two buckets is two entries - "6 boxes: 4 to the Store, 1 to
    Inventory, 1 to the Vault" is three - because a bucket belongs to stock, not to a
    product.
    """

    product_id: uuid.UUID
    quantity: int = Field(gt=0, le=MAX_OUTPUT_UNITS)
    bucket: str = Field(default=BUCKET_INVENTORY, pattern=BUCKET_PATTERN)


class CrackRequest(BaseModel):
    """Open sealed cases into what was inside them."""

    product_id: uuid.UUID
    #: How many cases. Usually one.
    quantity: int = Field(default=1, gt=0, le=1_000)
    from_bucket: str = Field(default=BUCKET_INVENTORY, pattern=BUCKET_PATTERN)
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
    #: What the outputs did not take, written off where it happened.
    bulk_cost: MoneyOut = Field(validation_alias="bulk_cost_cents")
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
        bulk_cost=record.bulk_cost_cents,
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

    # The client hides the button, but the client is a convenience and this is the
    # contract. A tab left open from before the button moved still points here.
    refusal = transformations.opening_refusal(db, payload.product_id, TRANSFORM_CRACK)
    if refusal:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=refusal)

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


class HitRequest(BaseModel):
    """One card worth recording out of a rip, and what it looked worth on the day.

    `value` is an estimate, not a cost. It decides how the box's cost is shared out and it
    is kept as a dated snapshot, but it never touches cost basis or realized profit -
    those follow what the box really cost. Estimates inform decisions; they do not score
    them, or the group would be marking its own homework.
    """

    product_id: uuid.UUID
    quantity: int = Field(default=1, gt=0, le=MAX_OUTPUT_UNITS)
    bucket: str = Field(default=BUCKET_INVENTORY, pattern=BUCKET_PATTERN)
    value: MoneyIn = 0
    #: Overrides the proportional share. Whatever the hits leave is written off as bulk.
    cost: MoneyIn | None = None


class RipRequest(BaseModel):
    """Open boxes or packs for what is inside them."""

    product_id: uuid.UUID
    quantity: int = Field(default=1, gt=0, le=1_000)
    from_bucket: str = Field(default=BUCKET_INVENTORY, pattern=BUCKET_PATTERN)
    #: The cards worth tracking. Everything else is bulk, and bulk is not an asset.
    hits: list[HitRequest] = Field(default_factory=list)
    occurred_on: date = Field(default_factory=date.today)
    notes: str | None = None

    @field_validator("notes", mode="after")
    @classmethod
    def blank_to_none(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None

    @model_validator(mode="after")
    def one_entry_per_product_and_bucket(self) -> "RipRequest":
        seen = {(hit.product_id, hit.bucket) for hit in self.hits}
        if len(seen) != len(self.hits):
            raise ValueError("each product and bucket combination can only appear once")
        return self


def _hit_costs(db: Session, payload: RipRequest) -> list[int]:
    """Each hit's share of the box, in proportion to what it is thought to be worth.

    Anything given an explicit `cost` keeps it and the rest share what is left. Hits with
    no value at all fall back to an even split: a box has to land somewhere, and refusing
    to record a rip because nobody put a number on it would be the wrong trade.
    """
    if not payload.hits:
        return []

    stats = inventory.product_stats(db, [payload.product_id]).get(payload.product_id)
    unit_cost = stats.average_unit_cost_cents if stats else None
    total = (unit_cost or 0) * payload.quantity

    explicit = [hit.cost for hit in payload.hits]
    if all(value is not None for value in explicit):
        return [value or 0 for value in explicit]

    remaining = max(total - sum(value for value in explicit if value is not None), 0)
    open_rows = [index for index, value in enumerate(explicit) if value is None]
    # A hit's value is a per-unit estimate (and is stored that way below), while the
    # allocated transformation cost belongs to the whole output row.  Account for
    # quantity here so two $10 copies carry the same weight as one $20 copy.
    weights = [payload.hits[index].value * payload.hits[index].quantity for index in open_rows]
    if not any(weights):
        weights = [1] * len(open_rows)

    shared = proportional_split(weights, remaining)

    costs = [value or 0 for value in explicit]
    for index, share in zip(open_rows, shared):
        costs[index] = share
    return costs


@router.post("/rip", response_model=TransformationRead, status_code=status.HTTP_201_CREATED)
def rip_open(
    payload: RipRequest,
    member: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> TransformationRead:
    """Open boxes or packs, and record the hits worth tracking.

    Unlike cracking a case, this is a lottery rather than a division. Thirty-six packs make
    roughly 360 cards and three of them matter, so the box's cost is shared **in proportion
    to what the hits are thought to be worth** - three hits at $500, $50 and $10 out of a
    $150 box come to $134, $13 and $3. An even split would price a $10 card the same as a
    $500 one and make per-card ROI meaningless.

    Whatever the hits do not take is written off as bulk, immediately. The group has said
    outright it would never rip something in order to sell the bulk, so the leftovers are
    not an asset - and a bad rip should look bad straight away rather than at some tidier
    moment later.

    A rip with no hits at all is allowed, and is the honest record of a bad one: the box is
    gone and its whole cost is a write-off.
    """
    if db.get(Product, payload.product_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    refusal = transformations.opening_refusal(db, payload.product_id, TRANSFORM_RIP)
    if refusal:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=refusal)

    available = transformations.available_in_bucket(
        db, payload.product_id, payload.from_bucket
    )
    if payload.quantity > available:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"{payload.from_bucket} holds {available}, so {payload.quantity} cannot be "
                "ripped out of it"
            ),
        )

    for hit in payload.hits:
        if db.get(Product, hit.product_id) is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="One of the hits does not exist"
            )
        if hit.product_id == payload.product_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="A box cannot be a hit out of itself",
            )

    costs = _hit_costs(db, payload)

    record = transformations.transform(
        db,
        kind=TRANSFORM_RIP,
        source_product_id=payload.product_id,
        source_quantity=payload.quantity,
        source_bucket=payload.from_bucket,
        outputs=[
            transformations.OutputSpec(
                product_id=hit.product_id, quantity=hit.quantity, bucket=hit.bucket
            )
            for hit in payload.hits
        ],
        costs=costs,
        occurred_on=payload.occurred_on,
        member_id=member.id,
        notes=payload.notes,
    )

    # The typed values, kept as dated estimates. This is what turns "$50 on the day, $1,500
    # four hundred days later" into a journey the app can show rather than one number
    # quietly replacing another.
    for hit in payload.hits:
        db.add(
            PriceSnapshot(
                product_id=hit.product_id,
                value_cents=hit.value,
                captured_on=payload.occurred_on,
                created_by_member_id=member.id,
                notes="valued when ripped",
            )
        )
    db.flush()

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
