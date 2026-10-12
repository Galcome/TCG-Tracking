"""Cracking a case open, ripping a box, combining products into one, and undoing them.

Each is the same primitive with a different cost split, and each gets its own endpoint
rather than a `kind` parameter nobody can read at the call site.
"""

import uuid
from datetime import UTC, date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.dependencies import db_session, get_current_member
from src.models.ledger import BUCKET_INVENTORY, BUCKETS, STATUS_ACTIVE
from src.models.member import Member
from src.models.price_snapshot import PriceSnapshot
from src.models.product import Product
from src.models.taxonomy import Game, ProductType
from src.models.transformation import (
    TRANSFORM_COMBINE,
    TRANSFORM_CRACK,
    TRANSFORM_RIP,
    Transformation,
    TransformationInput,
    TransformationOutput,
)
from src.schemas.ledger import VoidRequest
from src.schemas.money import MoneyIn, MoneyOut, MoneyOutOptional
from src.schemas.product import NAME_MAX_LENGTH
from src.services import inventory, ledger, pricing, sets, transformations
from src.services.costing import Event, allocate

router = APIRouter()

MAX_OUTPUT_UNITS = 10_000

BUCKET_PATTERN = f"^({chr(124).join(BUCKETS)})$"

#: What marks a valuation as the estimate typed during a rip, so a corrected rip can find
#: its own estimates again instead of leaving the wrong ones behind.
RIP_VALUE_NOTE = "valued when ripped"
#: What marks the bundle's valuation as the sum of its parts on the day it was made.
COMBINE_VALUE_NOTE = "valued when combined"

#: A whole set of singles is a few hundred rows; this only stops a runaway request.
MAX_COMBINE_INPUTS = 2_000


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
    #: What a rip's hit was thought to be worth each on the day. null for anything else.
    value: MoneyOutOptional = None


class InputRead(BaseModel):
    product_id: uuid.UUID
    product_name: str
    quantity: int
    bucket: str
    #: What FIFO said these units cost when they went in. null when that is unknown.
    cost: MoneyOutOptional


class TransformationRead(BaseModel):
    # populate_by_name so these can be built by field name here as well as read off
    # the ORM through the *_cents aliases.
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: uuid.UUID
    kind: str
    #: null for a combine, whose sources are `inputs`.
    source_product_id: uuid.UUID | None
    source_product_name: str | None
    #: For a combine, every unit across all its inputs.
    source_quantity: int
    source_bucket: str | None
    occurred_on: date | None
    #: What the outputs are dated from - the lot the source came out of, not the day it
    #: was opened. This is what stops cracking from resetting the ageing clock.
    inherited_purchase_date: date | None
    source_cost: MoneyOutOptional = Field(validation_alias="source_cost_cents")
    #: What the outputs did not take, written off where it happened.
    bulk_cost: MoneyOut = Field(validation_alias="bulk_cost_cents")
    outputs: list[OutputRead]
    #: What went into a combine. Empty for everything else.
    inputs: list[InputRead] = []
    notes: str | None
    status: str


def _rip_snapshots(
    db: Session, record: Transformation, note: str = RIP_VALUE_NOTE
) -> list[PriceSnapshot]:
    """The estimates this rip (or combine) wrote, oldest first."""
    produced = select(TransformationOutput.product_id).where(
        TransformationOutput.transformation_id == record.id
    )
    return list(
        db.scalars(
            select(PriceSnapshot)
            .where(
                PriceSnapshot.product_id.in_(produced),
                PriceSnapshot.captured_on == record.occurred_on,
                PriceSnapshot.notes == note,
            )
            .order_by(PriceSnapshot.created_at)
        )
    )


_VALUE_NOTES = {TRANSFORM_RIP: RIP_VALUE_NOTE, TRANSFORM_COMBINE: COMBINE_VALUE_NOTE}


def _rip_values(db: Session, record: Transformation) -> dict[uuid.UUID, int]:
    note = _VALUE_NOTES.get(record.kind)
    if note is None:
        return {}
    return {
        snapshot.product_id: snapshot.value_cents
        for snapshot in _rip_snapshots(db, record, note)
    }


def _read(db: Session, record: Transformation) -> TransformationRead:
    rows = db.execute(
        select(TransformationOutput, Product.name)
        .join(Product, Product.id == TransformationOutput.product_id)
        .where(TransformationOutput.transformation_id == record.id)
        .order_by(TransformationOutput.bucket, Product.name)
    ).all()
    source_name = (
        db.scalar(select(Product.name).where(Product.id == record.source_product_id))
        if record.source_product_id is not None
        else None
    )
    values = _rip_values(db, record)
    inputs = db.execute(
        select(TransformationInput, Product.name)
        .join(Product, Product.id == TransformationInput.product_id)
        .where(TransformationInput.transformation_id == record.id)
        .order_by(Product.name, TransformationInput.bucket)
    ).all()

    return TransformationRead(
        id=record.id,
        kind=record.kind,
        source_product_id=record.source_product_id,
        source_product_name=source_name,
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
                value=values.get(output.product_id),
            )
            for output, name in rows
        ],
        inputs=[
            InputRead(
                product_id=item.product_id,
                product_name=name,
                quantity=item.quantity,
                bucket=item.bucket,
                cost=item.cost_cents,
            )
            for item, name in inputs
        ],
        notes=record.notes,
        status=record.status,
    )


def _crack(db: Session, payload: CrackRequest, member: Member) -> Transformation:
    """Validate and write one crack. Shared by recording a crack and correcting one."""
    if db.get(Product, payload.product_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    # The client hides the button, but the client is a convenience and this is the
    # contract. A tab left open from before the button moved still points here.
    refusal = transformations.opening_refusal(db, payload.product_id, TRANSFORM_CRACK)
    if refusal:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=refusal)

    available = transformations.available_in_bucket(db, payload.product_id, payload.from_bucket)
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

    return transformations.transform(
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


@router.post("/crack", response_model=TransformationRead, status_code=status.HTTP_201_CREATED)
def crack_case(
    payload: CrackRequest,
    member: Member = Depends(get_current_member),
    db: Session = Depends(db_session, scope="function"),
) -> TransformationRead:
    """Open sealed cases into the boxes inside them.

    Refused when the bucket does not hold enough, for the same reason a move is: opening a
    case you do not have describes nothing that happened, so the honest fix is the data.

    Cracking is always a decision. A case can equally be sold whole, so nothing here
    happens automatically.
    """
    return _read(db, _crack(db, payload, member))


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


def _hit_costs(payload: RipRequest) -> list[transformations.RipCostSpec]:
    """Pass rip estimates and explicit decisions to the FIFO-backed service.

    This deliberately does not inspect inventory or derive a cost. The source may span
    multiple lots, so only the locked consuming adjustment can provide the authoritative
    cost after the transformation starts.
    """
    return [
        transformations.RipCostSpec(quantity=hit.quantity, value=hit.value, cost=hit.cost)
        for hit in payload.hits
    ]


def _rip(db: Session, payload: RipRequest, member: Member) -> Transformation:
    """Validate and write one rip. Shared by recording a rip and correcting one."""
    if db.get(Product, payload.product_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    refusal = transformations.opening_refusal(db, payload.product_id, TRANSFORM_RIP)
    if refusal:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=refusal)

    available = transformations.available_in_bucket(db, payload.product_id, payload.from_bucket)
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

    rip_policy = _hit_costs(payload)

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
        rip_policy=rip_policy,
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
                notes=RIP_VALUE_NOTE,
            )
        )
    db.flush()
    return record


@router.post("/rip", response_model=TransformationRead, status_code=status.HTTP_201_CREATED)
def rip_open(
    payload: RipRequest,
    member: Member = Depends(get_current_member),
    db: Session = Depends(db_session, scope="function"),
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
    return _read(db, _rip(db, payload, member))


_KIND_LABELS = {TRANSFORM_CRACK: "case crack", TRANSFORM_RIP: "rip"}


def _held(db: Session, product_ids: set[uuid.UUID]) -> dict[tuple[uuid.UUID, str], int]:
    """What each bucket of each product holds right now."""
    stats = inventory.product_stats(db, list(product_ids))
    return {
        (product_id, bucket): quantity
        for product_id, entry in stats.items()
        for bucket, quantity in entry.by_bucket.items()
    }


def _retire(
    db: Session, transformation_id: uuid.UUID, kind: str, member: Member
) -> tuple[set[uuid.UUID], dict[tuple[uuid.UUID, str], int]]:
    """Undo the record being corrected, and report what its outputs held beforehand.

    A correction is the old record undone and the right one written, in one transaction, so
    the cost shares are always FIFO's answer for what is actually recorded rather than a
    patched-up version of the wrong one. The old row stays, voided, as the history.
    """
    record = db.get(Transformation, transformation_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Transformation not found"
        )
    if record.kind != kind:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This is not a {_KIND_LABELS[kind]}",
        )
    if record.status != STATUS_ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This has already been voided"
        )

    produced = set(
        db.scalars(
            select(TransformationOutput.product_id).where(
                TransformationOutput.transformation_id == record.id
            )
        )
    )
    ledger.lock_products(db, [record.source_product_id, *produced])
    before = _held(db, produced)

    # The estimates belong to the rip that typed them. Left behind, a corrected value would
    # sit next to the wrong one on the same day and the chart could show either.
    if kind == TRANSFORM_RIP:
        for snapshot in _rip_snapshots(db, record):
            db.delete(snapshot)

    transformations.void(db, record, member_id=member.id, reason="Corrected")
    return produced, before


def _refuse_overdrawn(
    db: Session, produced: set[uuid.UUID], before: dict[tuple[uuid.UUID, str], int]
) -> None:
    """Refuse a correction that takes away something already sold, moved or opened.

    Only what the correction itself made worse is refused, so stock that was already
    negative for some unrelated reason does not make every later correction impossible.
    """
    for (product_id, bucket), held in _held(db, produced).items():
        if held < 0 and held < before.get((product_id, bucket), 0):
            name = db.scalar(select(Product.name).where(Product.id == product_id))
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"{name} would be left holding {held} in {bucket}. Some of what came "
                    "out has already been sold, moved or opened."
                ),
            )


@router.put("/{transformation_id}/crack", response_model=TransformationRead)
def correct_crack(
    transformation_id: uuid.UUID,
    payload: CrackRequest,
    member: Member = Depends(get_current_member),
    db: Session = Depends(db_session, scope="function"),
) -> TransformationRead:
    """Correct a case crack: how many, where from, what came out and where it went."""
    # One savepoint, so a refusal part-way leaves the original exactly as it was.
    with db.begin_nested():
        produced, before = _retire(db, transformation_id, TRANSFORM_CRACK, member)
        record = _crack(db, payload, member)
        _refuse_overdrawn(db, produced, before)
    return _read(db, record)


@router.put("/{transformation_id}/rip", response_model=TransformationRead)
def correct_rip(
    transformation_id: uuid.UUID,
    payload: RipRequest,
    member: Member = Depends(get_current_member),
    db: Session = Depends(db_session, scope="function"),
) -> TransformationRead:
    """Correct a rip: how many, where from, the hits and what they were thought worth."""
    with db.begin_nested():
        produced, before = _retire(db, transformation_id, TRANSFORM_RIP, member)
        record = _rip(db, payload, member)
        _refuse_overdrawn(db, produced, before)
    return _read(db, record)


class RipPreviewHit(BaseModel):
    key: str = Field(min_length=1, max_length=100)
    quantity: int = Field(default=1, gt=0, le=MAX_OUTPUT_UNITS)
    value: MoneyIn = 0
    cost: MoneyIn | None = None

    @field_validator("key")
    @classmethod
    def nonblank_key(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("hit key cannot be blank")
        return value


class RipPreviewRequest(BaseModel):
    product_id: uuid.UUID
    quantity: int = Field(default=1, gt=0, le=1_000)
    from_bucket: str = Field(default=BUCKET_INVENTORY, pattern=BUCKET_PATTERN)
    occurred_on: date = Field(default_factory=date.today)
    hits: list[RipPreviewHit] = Field(default_factory=list, max_length=MAX_OUTPUT_UNITS)

    @model_validator(mode="after")
    def unique_keys(self) -> "RipPreviewRequest":
        if len({hit.key for hit in self.hits}) != len(self.hits):
            raise ValueError("hit keys must be unique")
        return self


class RipPreviewOutput(BaseModel):
    key: str
    quantity: int
    cost: MoneyOutOptional


class RipPreviewRead(BaseModel):
    source_cost: MoneyOutOptional
    has_unknown_cost: bool
    quantity_available: int
    hits: list[RipPreviewOutput]
    bulk_cost: MoneyOutOptional
    nonbinding: Literal[True] = True


@router.post("/rip/preview", response_model=RipPreviewRead)
def preview_rip(
    payload: RipPreviewRequest,
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session, scope="function"),
) -> RipPreviewRead:
    """Simulate product-wide FIFO without product or accounting writes/reservations."""
    if db.get(Product, payload.product_id) is None:
        raise HTTPException(status_code=404, detail="Product not found")
    refusal = transformations.opening_refusal(db, payload.product_id, TRANSFORM_RIP)
    if refusal:
        raise HTTPException(status_code=422, detail=refusal)
    available = transformations.available_in_bucket(db, payload.product_id, payload.from_bucket)
    if payload.quantity > available:
        raise HTTPException(
            status_code=409,
            detail=(
                f"{payload.from_bucket} holds {available}, so "
                f"{payload.quantity} cannot be ripped out of it"
            ),
        )

    # Bucket availability is current stock; costing remains product-wide at occurred_on,
    # exactly as the writer and sale preview. Never filter FIFO lots by the bucket.
    events, _sources = ledger.load_events(db, payload.product_id)
    hypothetical = Event(
        id=uuid.uuid4(),
        quantity=payload.quantity,
        is_supply=False,
        occurred_on=payload.occurred_on,
        created_at=datetime.max.replace(tzinfo=UTC),
    )
    outcome = allocate([*events, hypothetical]).consumers[hypothetical.id]
    try:
        shares, bulk = transformations.allocate_rip_costs(
            outcome.cost_basis_cents,
            [
                transformations.RipCostSpec(quantity=hit.quantity, value=hit.value, cost=hit.cost)
                for hit in payload.hits
            ],
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return RipPreviewRead(
        source_cost=outcome.cost_basis_cents,
        has_unknown_cost=outcome.has_unknown_cost,
        quantity_available=available,
        bulk_cost=bulk,
        hits=[
            RipPreviewOutput(key=hit.key, quantity=hit.quantity, cost=share)
            for hit, share in zip(payload.hits, shares)
        ],
    )


class InputRequest(BaseModel):
    """One product going into a combine, out of one bucket."""

    product_id: uuid.UUID
    quantity: int = Field(default=1, gt=0, le=MAX_OUTPUT_UNITS)
    bucket: str = Field(default=BUCKET_INVENTORY, pattern=BUCKET_PATTERN)


class CombinePreviewRequest(BaseModel):
    inputs: list[InputRequest] = Field(min_length=1, max_length=MAX_COMBINE_INPUTS)
    occurred_on: date = Field(default_factory=date.today)

    @model_validator(mode="after")
    def one_entry_per_product_and_bucket(self) -> "CombinePreviewRequest":
        seen = {(item.product_id, item.bucket) for item in self.inputs}
        if len(seen) != len(self.inputs):
            raise ValueError("each product and bucket combination can only appear once")
        return self


class CombineRequest(CombinePreviewRequest):
    """Bundle products into one new product - a whole set of singles sold as one unit."""

    name: str = Field(min_length=1, max_length=NAME_MAX_LENGTH)
    product_type_id: uuid.UUID
    #: Omitted, the game every input shares. Inputs from different games must name one.
    game_id: uuid.UUID | None = None
    set_name: str | None = Field(default=None, max_length=120)
    #: Where the bundle lands.
    bucket: str = Field(default=BUCKET_INVENTORY, pattern=BUCKET_PATTERN)
    notes: str | None = None

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("name cannot be blank")
        return stripped

    @field_validator("set_name", "notes", mode="after")
    @classmethod
    def blank_to_none(cls, value: str | None) -> str | None:
        return (value or "").strip() or None


class CombinePreviewInput(BaseModel):
    product_id: uuid.UUID
    product_name: str
    quantity: int
    bucket: str
    #: What that bucket holds now. Less than `quantity` and the combine will be refused.
    available: int
    cost: MoneyOutOptional
    #: The display estimate for the whole row. null when nothing prices it.
    value: MoneyOutOptional


class CombinePreviewRead(BaseModel):
    inputs: list[CombinePreviewInput]
    #: The bundle's cost: every input's FIFO cost added up. null when any is unknown.
    total_cost: MoneyOutOptional
    has_unknown_cost: bool
    #: What the priced inputs are worth together. A floor when some have no price.
    estimated_value: MoneyOut
    unpriced: int
    nonbinding: Literal[True] = True


def _combine_products(db: Session, inputs: list[InputRequest]) -> dict[uuid.UUID, Product]:
    found = {
        product.id: product
        for product in db.scalars(
            select(Product).where(Product.id.in_({item.product_id for item in inputs}))
        )
    }
    if len(found) != len({item.product_id for item in inputs}):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="One of the products going in does not exist",
        )
    return found


def _row_values(db: Session, inputs: list[InputRequest]) -> list[int | None]:
    """Each input row's estimated worth: the display estimate per unit times the quantity."""
    estimates = pricing.display_estimates(db, list({item.product_id for item in inputs}))
    values: list[int | None] = []
    for item in inputs:
        estimate = estimates.get(item.product_id)
        unit = estimate.value_cents if estimate is not None else None
        values.append(None if unit is None else unit * item.quantity)
    return values


@router.post("/combine/preview", response_model=CombinePreviewRead)
def preview_combine(
    payload: CombinePreviewRequest,
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session, scope="function"),
) -> CombinePreviewRead:
    """What a combine would cost and be worth, without writing anything.

    Short stock is reported per row rather than refused, so the form can point at the
    exact card that is missing.
    """
    products = _combine_products(db, payload.inputs)
    held = _held(db, set(products))
    values = _row_values(db, payload.inputs)

    rows: list[CombinePreviewInput] = []
    total: int | None = 0
    unknown = False
    for item, value in zip(payload.inputs, values):
        events, _sources = ledger.load_events(db, item.product_id)
        hypothetical = Event(
            id=uuid.uuid4(),
            quantity=item.quantity,
            is_supply=False,
            occurred_on=payload.occurred_on,
            created_at=datetime.max.replace(tzinfo=UTC),
        )
        outcome = allocate([*events, hypothetical]).consumers[hypothetical.id]
        cost = None if outcome.has_unknown_cost else outcome.cost_basis_cents
        if cost is None:
            unknown = True
            total = None
        elif total is not None:
            total += cost
        rows.append(
            CombinePreviewInput(
                product_id=item.product_id,
                product_name=products[item.product_id].name,
                quantity=item.quantity,
                bucket=item.bucket,
                available=held.get((item.product_id, item.bucket), 0),
                cost=cost,
                value=value,
            )
        )

    return CombinePreviewRead(
        inputs=rows,
        total_cost=total,
        has_unknown_cost=unknown,
        estimated_value=sum(value for value in values if value is not None),
        unpriced=sum(1 for value in values if value is None),
    )


@router.post("/combine", response_model=TransformationRead, status_code=status.HTTP_201_CREATED)
def combine_products(
    payload: CombineRequest,
    member: Member = Depends(get_current_member),
    db: Session = Depends(db_session, scope="function"),
) -> TransformationRead:
    """Bundle products into one new product, carrying their cost and their worth across.

    The cards leave stock and one bundle arrives. Its cost is what FIFO says the cards cost,
    added up, so selling the bundle reports the same profit selling them one by one would
    have. Its estimated value is what the cards were worth together today, kept as a dated
    valuation - an estimate, never a cost.

    Undo it to break the bundle apart: every card goes back where it came from.
    """
    products = _combine_products(db, payload.inputs)

    if db.get(ProductType, payload.product_type_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Unknown product type"
        )
    game_id = payload.game_id
    if game_id is None:
        games = {product.game_id for product in products.values()}
        if len(games) > 1:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="These come from different games. Pick the game the bundle belongs to.",
            )
        game_id = games.pop()
    elif db.get(Game, game_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Unknown game"
        )

    card_set = (
        sets.resolve(db, game_id=game_id, name=payload.set_name, member_id=member.id)
        if payload.set_name
        else None
    )
    bundle = Product(
        name=payload.name,
        game_id=game_id,
        product_type_id=payload.product_type_id,
        set_id=card_set.id if card_set else None,
        set_name=card_set.name if card_set else None,
        created_by_member_id=member.id,
    )
    db.add(bundle)
    db.flush()

    # Valued before the cards leave stock: a sold-out card can still carry a quote, but
    # reading first keeps the figure the same one the preview showed.
    values = _row_values(db, payload.inputs)

    record = transformations.combine(
        db,
        product_id=bundle.id,
        bucket=payload.bucket,
        inputs=[
            transformations.InputSpec(
                product_id=item.product_id, quantity=item.quantity, bucket=item.bucket
            )
            for item in payload.inputs
        ],
        occurred_on=payload.occurred_on,
        member_id=member.id,
        notes=payload.notes,
    )

    # Nothing priced means nothing known about its worth. A zero would claim it is worthless.
    priced = [value for value in values if value is not None]
    if priced:
        db.add(
            PriceSnapshot(
                product_id=bundle.id,
                value_cents=sum(priced),
                captured_on=payload.occurred_on,
                created_by_member_id=member.id,
                notes=COMBINE_VALUE_NOTE,
            )
        )
        db.flush()
    return _read(db, record)


@router.get("", response_model=list[TransformationRead])
def list_transformations(
    product_id: uuid.UUID | None = Query(default=None),
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session, scope="function"),
) -> list[TransformationRead]:
    """What has been opened or combined, newest first.

    Filtered by `product_id` this answers both directions: what this product was opened
    or combined into, and what it came out of.
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
            | (
                Transformation.id.in_(
                    select(TransformationInput.transformation_id).where(
                        TransformationInput.product_id == product_id
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
    db: Session = Depends(db_session, scope="function"),
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

    if record.kind != TRANSFORM_COMBINE:
        transformations.void(db, record, member_id=member.id, reason=payload.reason)
        return _read(db, record)

    # Breaking a bundle apart after it was sold would put the cards back and leave the
    # bundle owing one. Refuse that, exactly as a correction would.
    with db.begin_nested():
        produced = set(
            db.scalars(
                select(TransformationOutput.product_id).where(
                    TransformationOutput.transformation_id == record.id
                )
            )
        )
        before = _held(db, produced)
        transformations.void(db, record, member_id=member.id, reason=payload.reason)
        _refuse_overdrawn(db, produced, before)
    return _read(db, record)
