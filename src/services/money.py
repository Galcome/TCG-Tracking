"""Money-ledger write paths and balances.

This is the only module that writes `money_movements` and `money_postings`. Read the
docstring in `src/models/money.py` first: postings store signed cash flow through an
account, and the liability flip for member accounts happens here at read time, once.

Funding and proceeds movements are *derived* from purchases and sales. They are created,
rescaled and voided alongside the transaction that caused them, so a purchase whose price is
corrected never leaves a funding record claiming the old number.
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from src.models.ledger import STATUS_ACTIVE, STATUS_VOIDED, Purchase, Sale
from src.models.member import Member
from src.models.money import (
    ACCOUNT_JOINT,
    ACCOUNT_MEMBER,
    JOINT_ACCOUNT_NAME,
    MOVEMENT_FUNDING,
    MOVEMENT_PROCEEDS,
    MoneyAccount,
    MoneyMovement,
    MoneyPosting,
)
from src.services import ledger


def proportional_split(weights: list[int], total: int) -> list[int]:
    """Divide `total` across `weights` in proportion, losing nothing.

    Used when a purchase's landed cost is corrected and its funding has to follow: a $200
    purchase funded 150/50 that becomes $300 is refunded as 225/75, not left claiming $200.

    Largest-remainder, like `costing.split_cost`, so the parts sum back to `total` exactly.
    Equal weights therefore behave identically to an even split.
    """
    magnitudes = [abs(weight) for weight in weights]
    pool = sum(magnitudes)
    if pool == 0:
        raise ValueError("cannot split against weights that sum to zero")

    # Exact shares, then hand the leftover pennies to the largest remainders. Sorting by
    # index as the tiebreak keeps the result deterministic for equal weights.
    scaled = [total * magnitude for magnitude in magnitudes]
    shares = [value // pool for value in scaled]
    leftover = total - sum(shares)

    # Flooring loses under a penny per weight, so `leftover` is always smaller than the
    # number of weights and this never has to wrap.
    order = sorted(range(len(weights)), key=lambda i: (-(scaled[i] % pool), i))
    for position in range(leftover):
        shares[order[position]] += 1

    # Signs come back from the weights: every leg of a funding movement points the same way,
    # and a rescale must not silently turn money out into money in.
    return [share if weight >= 0 else -share for share, weight in zip(shares, weights)]


# --------------------------------------------------------------------------- accounts


def ensure_accounts(db: Session) -> None:
    """Make sure the joint account and one account per active member exist.

    Idempotent and safe to call on every request that touches money. `ON CONFLICT DO
    NOTHING` rather than a check-then-insert, so two people opening the Money page at the
    same moment cannot create two joint accounts.
    """
    db.execute(
        pg_insert(MoneyAccount)
        .values(id=uuid.uuid4(), kind=ACCOUNT_JOINT, name=JOINT_ACCOUNT_NAME, is_active=True)
        .on_conflict_do_nothing(
            index_elements=["kind"], index_where=MoneyAccount.kind == ACCOUNT_JOINT
        )
    )

    # Every member, not only the active ones - see account_for_member.
    members = db.scalars(select(Member)).all()
    if members:
        db.execute(
            pg_insert(MoneyAccount)
            .values(
                [
                    {
                        "id": uuid.uuid4(),
                        "kind": ACCOUNT_MEMBER,
                        "name": member.display_name,
                        "member_id": member.id,
                        "is_active": member.is_active,
                    }
                    for member in members
                ]
            )
            .on_conflict_do_nothing(index_elements=["member_id"])
        )
    db.flush()


def account_for_member(db: Session, member_id: uuid.UUID) -> MoneyAccount:
    """The account belonging to a member, created if this is the first time anyone asked.

    Every member gets one, including deactivated ones: they may still be owed money, and a
    balance that vanishes when someone leaves the group is worse than useless.
    """
    ensure_accounts(db)
    return db.scalars(select(MoneyAccount).where(MoneyAccount.member_id == member_id)).one()


def balances(db: Session) -> dict[uuid.UUID, int]:
    """Signed cash flow per account, over active movements only.

    Raw flow, not the display balance: the liability flip for member accounts is applied by
    `balance_for`, so there is exactly one place that knows about it.
    """
    rows = db.execute(
        select(MoneyPosting.account_id, func.coalesce(func.sum(MoneyPosting.delta_cents), 0))
        .join(MoneyMovement, MoneyMovement.id == MoneyPosting.movement_id)
        .where(MoneyMovement.status == STATUS_ACTIVE)
        .group_by(MoneyPosting.account_id)
    )
    return {account_id: int(total) for account_id, total in rows}


def balance_for(account: MoneyAccount, flow: int) -> int:
    """What this account's balance means, from its raw flow.

    Joint is an asset: its balance is the cash in it. A member account is a liability: its
    balance is what the business owes that person, which is the negative of the cash that
    has flowed through their hands on the store's behalf.
    """
    return -flow if account.is_liability else flow


# -------------------------------------------------------------------------- movements


def record_movement(
    db: Session,
    *,
    kind: str,
    legs: list[tuple[uuid.UUID, int]],
    occurred_on: date | None,
    member_id: uuid.UUID | None,
    notes: str | None = None,
    purchase_id: uuid.UUID | None = None,
    sale_id: uuid.UUID | None = None,
) -> MoneyMovement:
    """Write one movement and its legs. `legs` are (account_id, signed cents)."""
    movement = MoneyMovement(
        kind=kind,
        occurred_on=occurred_on,
        purchase_id=purchase_id,
        sale_id=sale_id,
        notes=notes,
        created_by_member_id=member_id,
    )
    db.add(movement)
    db.flush()

    for account_id, delta in legs:
        db.add(
            MoneyPosting(movement_id=movement.id, account_id=account_id, delta_cents=delta)
        )
    db.flush()
    return movement


def void_movement(
    db: Session, movement: MoneyMovement, *, member_id: uuid.UUID | None, reason: str | None
) -> None:
    """Retire a movement without deleting it. Balances stop counting it immediately."""
    movement.status = STATUS_VOIDED
    movement.void_reason = reason
    db.flush()
    ledger.record_audit(
        db,
        entity_type="money_movement",
        entity_id=movement.id,
        action="void",
        member_id=member_id,
        before={"status": STATUS_ACTIVE},
        after={"status": STATUS_VOIDED},
        reason=reason,
    )


def _derived_movement(
    db: Session, *, purchase_id: uuid.UUID | None = None, sale_id: uuid.UUID | None = None
) -> MoneyMovement | None:
    """The live funding or proceeds movement for a stock transaction, if there is one."""
    column = MoneyMovement.purchase_id if sale_id is None else MoneyMovement.sale_id
    value = purchase_id if sale_id is None else sale_id
    return db.scalars(
        select(MoneyMovement).where(column == value, MoneyMovement.status == STATUS_ACTIVE)
    ).first()


def _replace_legs(db: Session, movement: MoneyMovement, legs: list[tuple[uuid.UUID, int]]) -> None:
    db.execute(delete(MoneyPosting).where(MoneyPosting.movement_id == movement.id))
    for account_id, delta in legs:
        db.add(
            MoneyPosting(movement_id=movement.id, account_id=account_id, delta_cents=delta)
        )
    db.flush()


def _legs_of(db: Session, movement: MoneyMovement) -> list[MoneyPosting]:
    return list(
        db.scalars(
            select(MoneyPosting)
            .where(MoneyPosting.movement_id == movement.id)
            .order_by(MoneyPosting.id)
        )
    )


# ---------------------------------------------------------------- funding and proceeds


def sync_funding(
    db: Session,
    purchase: Purchase,
    *,
    funding: list[tuple[uuid.UUID, int]] | None,
    member_id: uuid.UUID | None,
) -> None:
    """Keep a purchase's funding record in step with the purchase.

    `funding` given: those accounts paid, in those amounts, replacing whatever was there.
    `funding` omitted: an existing record is rescaled to the new landed cost in the same
    proportions - a 150/50 split of a $200 purchase corrected to $300 becomes 225/75. It is
    never invented for a purchase that had none, because "who paid" is not derivable.
    """
    movement = _derived_movement(db, purchase_id=purchase.id)
    total = purchase.landed_cost_cents

    if funding is None:
        if movement is None:
            return
        if total <= 0:
            # A purchase corrected down to nothing moved no money. Rescaling would write
            # zero-value legs, which the ledger refuses on purpose.
            void_movement(db, movement, member_id=member_id, reason="the purchase cost nothing")
            return
        existing = _legs_of(db, movement)
        weights = [posting.delta_cents for posting in existing]
        rescaled = proportional_split(weights, total)
        for posting, delta in zip(existing, rescaled):
            posting.delta_cents = delta
        movement.occurred_on = purchase.purchase_date
        db.flush()
        return

    # Money out of every funding source, so each leg is negative.
    legs = [(account_id, -amount) for account_id, amount in funding if amount]
    if not legs:
        if movement is not None:
            void_movement(db, movement, member_id=member_id, reason="funding removed")
        return

    if movement is None:
        record_movement(
            db,
            kind=MOVEMENT_FUNDING,
            legs=legs,
            occurred_on=purchase.purchase_date,
            member_id=member_id,
            purchase_id=purchase.id,
        )
        return

    _replace_legs(db, movement, legs)
    movement.occurred_on = purchase.purchase_date
    db.flush()


def sync_proceeds(
    db: Session,
    sale: Sale,
    *,
    account_id: uuid.UUID | None,
    member_id: uuid.UUID | None,
) -> None:
    """Keep a sale's proceeds record in step with the sale.

    The amount tracked is **net proceeds** - what actually landed after the platform and
    payment took their cut, because that is the money someone can spend. A sale whose fees
    swallow it whole moves no money and gets no record.
    """
    movement = _derived_movement(db, sale_id=sale.id)
    net = sale.net_proceeds_cents

    if account_id is None:
        # No destination given: follow the amount on whatever is already recorded.
        if movement is None:
            return
        if net <= 0:
            void_movement(db, movement, member_id=member_id, reason="sale nets nothing")
            return
        existing = _legs_of(db, movement)
        for posting in existing:
            posting.delta_cents = net
        movement.occurred_on = sale.sale_date
        db.flush()
        return

    if net <= 0:
        if movement is not None:
            void_movement(db, movement, member_id=member_id, reason="sale nets nothing")
        return

    if movement is None:
        record_movement(
            db,
            kind=MOVEMENT_PROCEEDS,
            legs=[(account_id, net)],
            occurred_on=sale.sale_date,
            member_id=member_id,
            sale_id=sale.id,
        )
        return

    _replace_legs(db, movement, [(account_id, net)])
    movement.occurred_on = sale.sale_date
    db.flush()


def void_derived(
    db: Session,
    *,
    purchase_id: uuid.UUID | None = None,
    sale_id: uuid.UUID | None = None,
    member_id: uuid.UUID | None,
) -> None:
    """Void the money movement a voided purchase or sale caused, if any."""
    movement = _derived_movement(db, purchase_id=purchase_id, sale_id=sale_id)
    if movement is not None:
        void_movement(
            db, movement, member_id=member_id, reason="the transaction it came from was voided"
        )
