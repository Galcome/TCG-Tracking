"""The money ledger: where the cash actually is, and who is owed what.

This answers a different question from the stock ledger. `purchases` and `sales` say what
was spent on stock and what came back; these tables say whose money paid for it and where
the proceeds went. Both are true at once and they are not the same number - the dashboard's
"Since day one" block is the first, this is the second.

**One sign convention.** A posting records cash flowing *through* an account: money in is
positive, money out is negative. Nothing else. What differs is how a balance reads:

- The **joint** account is an asset. Its balance is cash sitting in it, so it is the plain
  sum of its postings.
- A **member** account is a liability. Its balance is what the business owes that person, so
  it is the sum *negated*. Jason paying $5,000 out of his own pocket for stock is money
  flowing out of his account (-5000), which is the business owing him $5,000.

That single flip is why every event the group described falls out of one rule:

| Event | Postings | Reads as |
| --- | --- | --- |
| Purchase paid from Joint | Joint -X | Joint cash down, nobody owed |
| Purchase paid by Jason | Jason -X | Jason owed X |
| Sale, seller keeps the cash | Seller +X | Seller owed X less - he is holding it |
| Sale, proceeds to Joint | Joint +X | Joint cash up, nobody's balance moves |
| Jason draws $3,000 from Joint | Joint -X, Jason +X | Both fall: cash out, debt settled |
| Patrick puts cash into Joint | Joint +X, Patrick -X | Cash in, and he is owed for it |
| Sale paid in store credit | That shop +X | Credit to spend there, and no cash anywhere |
| Purchase paid with store credit | That shop -X | Credit spent down |

**Store credit is value, not money.** A store-credit account sums like the joint one - it is
something the group owns and can spend - but it is never added into a cash figure. Selling a
$200 box for $500 of credit is $300 of realized profit and zero dollars, and both of those
are true at the same time.

Rows are never deleted, exactly as in the stock ledger: `status` moves to 'voided' and the
balance query stops seeing them.
"""

import uuid
from datetime import date

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    String,
    Text,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base
from src.models.ledger import DEFAULT_CURRENCY, STATUS_ACTIVE
from src.models.mixins import TimestampMixin

#: The shared pot. Exactly one exists, enforced by a partial unique index.
ACCOUNT_JOINT = "joint"
#: One per member. Its balance is what the business owes that person.
ACCOUNT_MEMBER = "member"
#: One per shop that pays in credit. Its balance is what is left to spend there.
#:
#: Deliberately its own kind rather than another joint account: credit at a card shop is
#: real value the group owns, and it is not money. Selling a $200 box for $500 of credit is
#: $300 of realized profit and zero dollars - both true, and different numbers.
ACCOUNT_STORE_CREDIT = "store_credit"
ACCOUNT_KINDS = (ACCOUNT_JOINT, ACCOUNT_MEMBER, ACCOUNT_STORE_CREDIT)

#: Name the joint account carries. Editable later; this is only what it is created as.
JOINT_ACCOUNT_NAME = "Joint account"

#: A purchase was paid for - money leaving whichever pockets funded it.
MOVEMENT_FUNDING = "funding"
#: A sale was received - money arriving wherever the payout landed.
MOVEMENT_PROCEEDS = "proceeds"
#: Money moving between two accounts. Covers paying a partner back, a partner putting cash
#: in, and one partner settling with another - all the same shape, told apart by direction.
MOVEMENT_TRANSFER = "transfer"
#: A correction, or an opening balance. One leg, signed, with no counterparty.
MOVEMENT_ADJUSTMENT = "adjustment"
MOVEMENT_KINDS = (
    MOVEMENT_FUNDING,
    MOVEMENT_PROCEEDS,
    MOVEMENT_TRANSFER,
    MOVEMENT_ADJUSTMENT,
)

_ACCOUNT_KIND_CHECK = "kind IN ('joint', 'member', 'store_credit')"
_MOVEMENT_KIND_CHECK = "kind IN ('funding', 'proceeds', 'transfer', 'adjustment')"
_STATUS_CHECK = "status IN ('active', 'voided')"


class MoneyAccount(Base, TimestampMixin):
    """A pot money can sit in, or a person money can be owed to."""

    __tablename__ = "money_accounts"
    __table_args__ = (
        CheckConstraint(_ACCOUNT_KIND_CHECK, name="ck_money_accounts_kind"),
        # A member account names a member; the joint account does not. Stops a member
        # account existing without a person, which would make its balance meaningless.
        CheckConstraint(
            "(kind = 'member') = (member_id IS NOT NULL)",
            name="ck_money_accounts_member_link",
        ),
        CheckConstraint(
            "length(trim(name)) > 0", name="ck_money_accounts_name_present"
        ),
        # Exactly one joint account, enforced by the database rather than by a check-then-
        # insert that two simultaneous first-page-loads could both pass.
        Index(
            "uq_money_accounts_joint",
            "kind",
            unique=True,
            postgresql_where=text("kind = 'joint'"),
        ),
        # One pot per shop, case-insensitively. "Card Shop" and "card shop" splitting the
        # balance across two rows is the Fable/Fabled problem with money attached.
        Index(
            "uq_money_accounts_store_name",
            text("lower(name)"),
            unique=True,
            postgresql_where=text("kind = 'store_credit'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    #: Unique, so one member cannot end up with two accounts and half a balance in each.
    member_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id"), nullable=True, unique=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    @property
    def is_liability(self) -> bool:
        """True when the balance means "owed to", so its postings read negated.

        Store credit is not one: it is value the group holds and can spend, so it sums the
        same way the joint account does. What makes it different is that it is not cash,
        which is a reporting distinction rather than a sign one.
        """
        return self.kind == ACCOUNT_MEMBER

    @property
    def balance_means(self) -> str:
        """What this account's balance is, in one word, so no client has to infer it."""
        if self.kind == ACCOUNT_MEMBER:
            return "owed"
        if self.kind == ACCOUNT_STORE_CREDIT:
            return "credit"
        return "cash"


class MoneyMovement(Base, TimestampMixin):
    """One event that moved money. Its legs live in `money_postings`.

    `purchase_id` and `sale_id` tie a movement back to the stock transaction that caused
    it, so editing what a purchase cost can carry its funding along and voiding it can void
    the funding too. At most one of them is set - a movement is caused by one thing.
    """

    __tablename__ = "money_movements"
    __table_args__ = (
        CheckConstraint(_MOVEMENT_KIND_CHECK, name="ck_money_movements_kind"),
        CheckConstraint(_STATUS_CHECK, name="ck_money_movements_status"),
        CheckConstraint(
            "(purchase_id IS NOT NULL)::int + (sale_id IS NOT NULL)::int <= 1",
            name="ck_money_movements_one_cause",
        ),
        Index("ix_money_movements_status_date", "status", "occurred_on"),
        Index("ix_money_movements_purchase", "purchase_id"),
        Index("ix_money_movements_sale", "sale_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    occurred_on: Mapped[date | None] = mapped_column(Date, nullable=True)

    purchase_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("purchases.id"), nullable=True
    )
    sale_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("sales.id"), nullable=True)

    status: Mapped[str] = mapped_column(String(10), nullable=False, default=STATUS_ACTIVE)
    void_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default=DEFAULT_CURRENCY)

    created_by_member_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id"), nullable=True
    )


class MoneyPosting(Base):
    """One account's share of one movement, as signed cash flow through that account.

    Positive is money arriving, negative is money leaving. Read
    `src/models/money.py`'s module docstring before changing that - the liability flip for
    member accounts happens at read time, not here, and doing it in both places would
    cancel out silently.
    """

    __tablename__ = "money_postings"
    __table_args__ = (
        CheckConstraint("delta_cents <> 0", name="ck_money_postings_delta_non_zero"),
        # One leg per account per movement, so "Jason funded 300 and also 200" is stored as
        # a single 500 rather than two rows that a later edit could rescale inconsistently.
        Index("uq_money_postings_movement_account", "movement_id", "account_id", unique=True),
        Index("ix_money_postings_account", "account_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    movement_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("money_movements.id", ondelete="CASCADE"), nullable=False
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("money_accounts.id"), nullable=False
    )
    delta_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
