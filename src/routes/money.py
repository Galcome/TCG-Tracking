"""The money ledger: accounts, balances, transfers and corrections.

Funding and proceeds are not created here - they belong to the purchase and the sale that
caused them, and are written by those endpoints through `services.money`. What lives here is
everything with no stock behind it: seeing where the money is, moving it between accounts,
and setting the opening balances carried over from the spreadsheet.

Permissions are flat, as everywhere else in this app. Three trusted people do not need an
approval step; the audit trail is what makes a mistake recoverable.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.dependencies import db_session, get_current_member
from src.models.ledger import STATUS_ACTIVE, Purchase, Sale
from src.models.member import Member
from src.models.money import (
    MOVEMENT_ADJUSTMENT,
    MOVEMENT_KINDS,
    MOVEMENT_TRANSFER,
    MoneyAccount,
    MoneyMovement,
    MoneyPosting,
)
from src.models.product import Product
from src.schemas.ledger import VoidRequest
from src.schemas.money_ledger import (
    AccountList,
    AccountRead,
    AdjustmentCreate,
    FundingLeg,
    MovementList,
    MovementRead,
    PostingRead,
    TransferCreate,
)
from src.services import ledger, money

router = APIRouter()

DEFAULT_MOVEMENT_LIMIT = 50
MAX_MOVEMENT_LIMIT = 200


def movement_amount(deltas: list[int]) -> int:
    """How much money this movement moved, as one positive number.

    A transfer's legs cancel out, so its total absolute value counts the same money twice;
    a funding or proceeds movement has no counterparty inside the system and does not.
    """
    total = sum(abs(delta) for delta in deltas)
    return total // 2 if sum(deltas) == 0 else total


def _require_account(db: Session, account_id: uuid.UUID) -> MoneyAccount:
    account = db.get(MoneyAccount, account_id)
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    return account


def resolve_funding(
    db: Session,
    *,
    legs: list[FundingLeg] | None,
    landed_cost: int,
    default_member_id: uuid.UUID,
) -> list[tuple[uuid.UUID, int]]:
    """Turn a funding request into (account, amount) pairs, or fall back to a default.

    Omitted entirely, funding is attributed to whoever the purchase says bought it - the
    same rule that sends a sale's proceeds to whoever sold it, and for the same reason: it
    is what physically happened. One tap changes it, and it stays editable afterwards.

    The amounts have to add up to what the purchase actually cost. Money does not appear
    from nowhere, and letting the two ledgers disagree is how a spreadsheet stops being
    trusted.
    """
    if legs is None:
        return [(money.account_for_member(db, default_member_id).id, landed_cost)]

    if not legs:
        return []

    account_ids = [leg.account_id for leg in legs]
    if len(set(account_ids)) != len(account_ids):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Each account can only appear once in the funding split",
        )
    for account_id in account_ids:
        _require_account(db, account_id)

    if len(legs) == 1 and legs[0].amount is None:
        return [(legs[0].account_id, landed_cost)]

    if any(leg.amount is None for leg in legs):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Every funding source needs an amount when more than one paid",
        )

    total = sum(leg.amount or 0 for leg in legs)
    if total != landed_cost:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"Funding adds up to {total / 100:.2f} but the purchase cost "
                f"{landed_cost / 100:.2f}"
            ),
        )
    return [(leg.account_id, leg.amount or 0) for leg in legs]


def resolve_proceeds(
    db: Session, *, account_id: uuid.UUID | None, default_member_id: uuid.UUID
) -> uuid.UUID:
    """Where a sale's money landed. Defaults to the seller, because that is where it went.

    The eBay payout arrives in Patrick's account, not a shared one. Making the form ask at
    entry time would cost the ten-second sale for a decision that is reversible with a
    transfer later.
    """
    if account_id is not None:
        _require_account(db, account_id)
        return account_id
    return money.account_for_member(db, default_member_id).id


# -------------------------------------------------------------------------- accounts


@router.get("/accounts", response_model=AccountList)
def list_accounts(
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> AccountList:
    """Every pot, with what its balance means spelled out.

    `joint_balance` and `total_owed` are returned separately and are never summed. One is
    money the group has; the other is money it owes its own members. A single "net" figure
    would hide whichever of the two is the problem.
    """
    money.ensure_accounts(db)
    flows = money.balances(db)

    accounts = db.scalars(
        select(MoneyAccount).order_by(MoneyAccount.kind.desc(), MoneyAccount.name)
    ).all()

    items: list[AccountRead] = []
    joint_balance = 0
    total_owed = 0
    for account in accounts:
        balance = money.balance_for(account, flows.get(account.id, 0))
        if account.is_liability:
            total_owed += balance
        else:
            joint_balance += balance
        items.append(
            AccountRead(
                id=account.id,
                kind=account.kind,
                name=account.name,
                member_id=account.member_id,
                is_active=account.is_active,
                balance=balance,
                balance_means="owed" if account.is_liability else "cash",
            )
        )

    return AccountList(items=items, joint_balance=joint_balance, total_owed=total_owed)


# ------------------------------------------------------------------------- movements


def _serialise(
    movements: list[MoneyMovement],
    legs_by_movement: dict[uuid.UUID, list[tuple[MoneyPosting, MoneyAccount]]],
    product_names: dict[uuid.UUID, str],
) -> list[MovementRead]:
    items: list[MovementRead] = []
    for movement in movements:
        legs = legs_by_movement.get(movement.id, [])
        items.append(
            MovementRead(
                id=movement.id,
                kind=movement.kind,
                occurred_on=movement.occurred_on,
                amount=movement_amount([posting.delta_cents for posting, _ in legs]),
                legs=[
                    PostingRead(
                        account_id=account.id,
                        account_name=account.name,
                        account_kind=account.kind,
                        amount=posting.delta_cents,
                    )
                    for posting, account in legs
                ],
                purchase_id=movement.purchase_id,
                sale_id=movement.sale_id,
                product_name=product_names.get(movement.id),
                notes=movement.notes,
                status=movement.status,
            )
        )
    return items


def _product_names(db: Session, movements: list[MoneyMovement]) -> dict[uuid.UUID, str]:
    """What each funding or proceeds movement was for, in one query per side."""
    names: dict[uuid.UUID, str] = {}

    for model, attribute in ((Purchase, "purchase_id"), (Sale, "sale_id")):
        wanted = {
            getattr(movement, attribute): movement.id
            for movement in movements
            if getattr(movement, attribute) is not None
        }
        if not wanted:
            continue
        rows = db.execute(
            select(model.id, Product.name)
            .join(Product, Product.id == model.product_id)
            .where(model.id.in_(wanted))
        )
        for record_id, name in rows:
            names[wanted[record_id]] = name

    return names


@router.get("/movements", response_model=MovementList)
def list_movements(
    account_id: uuid.UUID | None = Query(default=None),
    kind: str | None = Query(default=None, pattern=f"^({'|'.join(MOVEMENT_KINDS)})$"),
    limit: int = Query(default=DEFAULT_MOVEMENT_LIMIT, ge=1, le=MAX_MOVEMENT_LIMIT),
    offset: int = Query(default=0, ge=0),
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> MovementList:
    """Every movement, newest first.

    Voided movements are listed and flagged rather than hidden, exactly as voided sales
    are: a voided row is the explanation for a balance changing.
    """
    filters = []
    if kind:
        filters.append(MoneyMovement.kind == kind)
    if account_id is not None:
        filters.append(
            MoneyMovement.id.in_(
                select(MoneyPosting.movement_id).where(MoneyPosting.account_id == account_id)
            )
        )

    total = db.scalar(select(func.count()).select_from(MoneyMovement).where(*filters))

    movements = list(
        db.scalars(
            select(MoneyMovement)
            .where(*filters)
            .order_by(
                MoneyMovement.occurred_on.desc().nullslast(),
                MoneyMovement.created_at.desc(),
                MoneyMovement.id.desc(),
            )
            .limit(limit)
            .offset(offset)
        )
    )

    legs_by_movement: dict[uuid.UUID, list[tuple[MoneyPosting, MoneyAccount]]] = {}
    if movements:
        rows = db.execute(
            select(MoneyPosting, MoneyAccount)
            .join(MoneyAccount, MoneyAccount.id == MoneyPosting.account_id)
            .where(MoneyPosting.movement_id.in_([movement.id for movement in movements]))
            .order_by(MoneyPosting.delta_cents)
        )
        for posting, account in rows:
            legs_by_movement.setdefault(posting.movement_id, []).append((posting, account))

    return MovementList(
        items=_serialise(movements, legs_by_movement, _product_names(db, movements)),
        total=total or 0,
        limit=limit,
        offset=offset,
    )


@router.post("/transfers", response_model=MovementRead, status_code=status.HTTP_201_CREATED)
def create_transfer(
    payload: TransferCreate,
    member: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> MovementRead:
    """Move money from one account to another.

    Paying a partner back, a partner putting cash in, and one partner settling with another
    are all this one operation. Nothing is approved and nothing is locked - the group said
    the requirement was fluidity, so a decision made at sale time is undone by transferring
    it back.
    """
    source = _require_account(db, payload.from_account_id)
    destination = _require_account(db, payload.to_account_id)

    movement = money.record_movement(
        db,
        kind=MOVEMENT_TRANSFER,
        legs=[(source.id, -payload.amount), (destination.id, payload.amount)],
        occurred_on=payload.occurred_on,
        member_id=member.id,
        notes=payload.notes,
    )
    ledger.record_audit(
        db,
        entity_type="money_movement",
        entity_id=movement.id,
        action="create",
        member_id=member.id,
        after={
            "kind": MOVEMENT_TRANSFER,
            "amount_cents": payload.amount,
            "from": str(source.id),
            "to": str(destination.id),
        },
    )
    return _one(db, movement)


@router.post("/adjustments", response_model=MovementRead, status_code=status.HTTP_201_CREATED)
def create_adjustment(
    payload: AdjustmentCreate,
    member: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> MovementRead:
    """Correct a balance, or set the one carried over from the spreadsheet.

    `amount` arrives in the account's own terms - "Jason is owed $5,000" is +5000 on Jason's
    account, not a sign the caller has to work out. The flip to raw cash flow happens here,
    in the one place that knows about it.
    """
    account = _require_account(db, payload.account_id)
    flow = money.balance_for(account, payload.amount)

    movement = money.record_movement(
        db,
        kind=MOVEMENT_ADJUSTMENT,
        legs=[(account.id, flow)],
        occurred_on=payload.occurred_on,
        member_id=member.id,
        notes=payload.notes,
    )
    ledger.record_audit(
        db,
        entity_type="money_movement",
        entity_id=movement.id,
        action="create",
        member_id=member.id,
        after={
            "kind": MOVEMENT_ADJUSTMENT,
            "account": str(account.id),
            "amount_cents": payload.amount,
        },
    )
    return _one(db, movement)


@router.post("/movements/{movement_id}/void", response_model=MovementRead)
def void_movement(
    movement_id: uuid.UUID,
    payload: VoidRequest,
    member: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> MovementRead:
    """Retire a movement. Balances stop counting it; the row stays as the explanation.

    Funding and proceeds movements are refused here: they describe a purchase or a sale,
    so the honest correction is to that transaction, which carries its money record along.
    """
    movement = db.get(MoneyMovement, movement_id)
    if movement is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Movement not found")
    if movement.status != STATUS_ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This movement has already been voided",
        )
    if movement.purchase_id is not None or movement.sale_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This came from a purchase or a sale. Edit or void that instead and its "
                "money record follows."
            ),
        )

    money.void_movement(db, movement, member_id=member.id, reason=payload.reason)
    return _one(db, movement)


def _one(db: Session, movement: MoneyMovement) -> MovementRead:
    """Serialise a single movement the same way the list does."""
    rows = db.execute(
        select(MoneyPosting, MoneyAccount)
        .join(MoneyAccount, MoneyAccount.id == MoneyPosting.account_id)
        .where(MoneyPosting.movement_id == movement.id)
        .order_by(MoneyPosting.delta_cents)
    )
    legs = {movement.id: [(posting, account) for posting, account in rows]}
    return _serialise([movement], legs, _product_names(db, [movement]))[0]


