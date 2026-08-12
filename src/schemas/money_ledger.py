"""Request and response models for the money ledger.

Named `money_ledger` rather than `money` because `schemas/money.py` already owns the
cents-to-decimal-string boundary that every other schema imports.

Balances are signed and mean different things per account kind, so each one is returned with
the label that says which - never a bare number the reader has to interpret.
"""

import uuid
from datetime import date

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from src.models.money import ACCOUNT_KINDS, MOVEMENT_KINDS
from src.schemas.money import MoneyIn, MoneyOut

_READ_CONFIG = ConfigDict(from_attributes=True, populate_by_name=True)

#: Signed money on the wire: a transfer leg or an opening balance can be negative, which
#: the shared MoneyIn deliberately refuses. Cents, as a plain integer, with the sign kept.
SignedMoney = int

MAX_MOVEMENT_CENTS = 100_000_000_000


def _strip_optional(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip() or None


# -------------------------------------------------------------------------- accounts


class AccountRead(BaseModel):
    model_config = _READ_CONFIG

    id: uuid.UUID
    kind: str = Field(pattern=f"^({'|'.join(ACCOUNT_KINDS)})$")
    name: str
    member_id: uuid.UUID | None
    is_active: bool

    #: What this account's balance means. For `joint` it is cash sitting in the account;
    #: for `member` it is what the business owes that person. Negative on a member account
    #: means they are holding money that belongs to the group.
    balance: MoneyOut
    #: `cash` or `owed`, so a client never has to infer which from the kind.
    balance_means: str


class AccountList(BaseModel):
    items: list[AccountRead]
    #: Cash in the joint account.
    joint_balance: MoneyOut
    #: Sum of what the business owes its members. Deliberately not added to `joint_balance`
    #: - one is money you have, the other is money you owe.
    total_owed: MoneyOut


# ------------------------------------------------------------------------- movements


class TransferCreate(BaseModel):
    """Money moving between two accounts.

    One shape covers paying a partner back out of the joint account, a partner putting
    personal cash in, and one partner settling up with another. Which of those it reads as
    is a consequence of the two accounts and the direction, not a mode the user picks.
    """

    from_account_id: uuid.UUID
    to_account_id: uuid.UUID
    amount: MoneyIn = Field(gt=0)
    occurred_on: date = Field(default_factory=date.today)
    notes: str | None = None

    @field_validator("notes", mode="after")
    @classmethod
    def blank_to_none(cls, value: str | None) -> str | None:
        return _strip_optional(value)

    @model_validator(mode="after")
    def accounts_differ(self) -> "TransferCreate":
        if self.from_account_id == self.to_account_id:
            raise ValueError("a transfer needs two different accounts")
        return self


class AdjustmentCreate(BaseModel):
    """A correction, or an opening balance carried over from the spreadsheet.

    Signed on purpose: "Jason was already owed $5,000 when we started" and "we double
    counted a payback" are the same operation in opposite directions.
    """

    account_id: uuid.UUID
    #: What the balance should move by, in that account's own terms - `owed` for a member
    #: account, `cash` for the joint one. The sign flip to raw flow happens server-side.
    amount: SignedMoney = Field(ge=-MAX_MOVEMENT_CENTS, le=MAX_MOVEMENT_CENTS)
    occurred_on: date = Field(default_factory=date.today)
    notes: str | None = None

    @field_validator("notes", mode="after")
    @classmethod
    def blank_to_none(cls, value: str | None) -> str | None:
        return _strip_optional(value)

    @field_validator("amount")
    @classmethod
    def non_zero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("an adjustment of zero changes nothing")
        return value


class PostingRead(BaseModel):
    model_config = _READ_CONFIG

    account_id: uuid.UUID
    account_name: str
    account_kind: str
    #: Signed cash flow through the account. Positive is money arriving.
    amount: MoneyOut = Field(validation_alias="delta_cents")


class MovementRead(BaseModel):
    model_config = _READ_CONFIG

    id: uuid.UUID
    kind: str = Field(pattern=f"^({'|'.join(MOVEMENT_KINDS)})$")
    occurred_on: date | None
    #: The size of the movement: the total money that changed hands, always positive.
    #: Legs carry the direction.
    amount: MoneyOut
    legs: list[PostingRead]
    purchase_id: uuid.UUID | None
    sale_id: uuid.UUID | None
    #: Filled for funding and proceeds so the ledger can say what it was for.
    product_name: str | None = None
    notes: str | None
    status: str


class MovementList(BaseModel):
    items: list[MovementRead]
    total: int
    limit: int
    offset: int


# -------------------------------------------------- funding attached to a purchase


class FundingLeg(BaseModel):
    """Who paid for a purchase, and how much of it.

    `amount` may be omitted only when a single account funded the whole thing, which is the
    normal case and the one that has to stay fast to enter.
    """

    account_id: uuid.UUID
    amount: MoneyIn | None = None
