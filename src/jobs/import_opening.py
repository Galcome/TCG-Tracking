"""Load the group's real opening position from a reviewed CSV.

The records that matter lived in a spreadsheet for three years. This turns the reviewed
part of it into ordinary app entries - products, purchases, sales, expenses and money
postings - so that from the cutover date on, the app is the record and the spreadsheet is
history.

**Everything it writes is an ordinary editable entry.** There is no import-only row type,
no locked field and no hidden marker. A wrong number is corrected in the app exactly like
one somebody typed in, and re-running the import will not fight that correction: a row is
skipped when its `key` is already present, so a second run changes nothing.

**One CSV, one reviewed decision per line.** Joseph approves the sheet before it loads,
so every judgement call - which purchase row a sold line matched, what something cost, who
paid - is visible next to the row it affects rather than buried in this file. Rows the
review could not confirm are simply absent from the file; this job never guesses.

Three kinds of row:

``stock``
    A product and how it came to be held. With a `unit_cost` that is a real purchase; with
    the cost left blank it is stock counted in at unknown cost, which is what most of the
    Vault is. Optionally a sale (making it a confirmed buy-and-sold pair, with FIFO profit
    computed by the ledger, not here) and optionally a valuation, which is what the Vault
    tab's yearly numbers become.
``expense``
    Overhead: subscriptions and anything else that left the business with no stock back.
``balance``
    What an account is believed to be worth now. Written as one adjustment for the
    difference between the computed balance and that figure, so the gap between what the
    entries add up to and what the group believes is a visible line, not a silent edit.

Run it against the database in DATABASE_URL. It reports and writes nothing by default:

    uv run python -m src.jobs.import_opening opening.csv
    uv run python -m src.jobs.import_opening opening.csv --apply
"""

from __future__ import annotations

import argparse
import csv
import logging
import sys
import uuid
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.database import get_db
from src.models.ledger import BUCKETS, InventoryAdjustment, Purchase, Sale
from src.models.member import Member
from src.models.money import (
    ACCOUNT_JOINT,
    EXPENSE_CATEGORIES,
    MOVEMENT_ADJUSTMENT,
    MOVEMENT_EXPENSE,
    MoneyAccount,
)
from src.models.price_snapshot import PriceSnapshot
from src.models.product import Product
from src.models.taxonomy import Game, ProductType
from src.services import ledger, money, sets

logger = logging.getLogger(__name__)

ROW_KINDS = ("stock", "expense", "balance")

#: Token for the shared pot in a funding or balance cell. A brokerage account the group
#: owns (the workbook's WealthSimple column) is the same thing as far as this app is
#: concerned: money the business holds, owed to nobody, so it maps here rather than
#: inventing a fourth account kind.
JOINT_TOKEN = "joint"

#: Prefix marking a store-credit account in a funding cell, e.g. ``credit:Wizards Tower``.
CREDIT_PREFIX = "credit:"

#: Separator between funding legs, and between an account and its amount.
LEG_SEPARATOR = "|"
AMOUNT_SEPARATOR = ":"


class RowError(ValueError):
    """A row could not be loaded.

    Raised rather than logged-and-skipped: the file is one reviewed position, and half of a
    reviewed position is a set of books that balances against nothing. The whole run rolls
    back, the row number is reported, and it goes again after a fix.
    """


@dataclass
class Summary:
    """What the run did, or would do. Printed either way."""

    products: int = 0
    purchases: int = 0
    counted_in: int = 0
    sales: int = 0
    valuations: int = 0
    expenses: int = 0
    balances: int = 0
    skipped: list[str] = field(default_factory=list)

    def as_log(self) -> str:
        return (
            f"products={self.products} purchases={self.purchases} "
            f"counted_in={self.counted_in} sales={self.sales} "
            f"valuations={self.valuations} expenses={self.expenses} "
            f"balances={self.balances} skipped={len(self.skipped)}"
        )


# ------------------------------------------------------------------ cell parsing


def cents(value: str, *, label: str) -> int:
    """Dollars as written in the sheet to integer cents, never through a float.

    `1439.92` is not representable in binary floating point, and a tenth of a cent lost per
    row is how a reconciliation that should be exact stops being exact.
    """
    text = (value or "").strip().replace("$", "").replace(",", "")
    if not text:
        raise RowError(f"{label} is required")
    try:
        return int((Decimal(text) * 100).quantize(Decimal("1")))
    except (InvalidOperation, ArithmeticError) as error:
        raise RowError(f"{label} is not an amount: {value!r}") from error


def whole(value: str, *, label: str) -> int:
    """A count. Text like `3 + 2` never reaches here - the review sheet resolves it."""
    text = (value or "").strip()
    if not text.isdigit() or int(text) <= 0:
        raise RowError(f"{label} must be a positive whole number, got {value!r}")
    return int(text)


def day(value: str, *, label: str) -> date:
    """ISO dates only. The workbook's `21/03/26` and `11/5/20424` are fixed in review."""
    text = (value or "").strip()
    try:
        return date.fromisoformat(text)
    except ValueError as error:
        raise RowError(f"{label} must be an ISO date (YYYY-MM-DD), got {value!r}") from error


def _maybe_day(value: str, *, label: str) -> date | None:
    """A date if the sheet has one. Stock counted in at unknown cost often has neither."""
    return day(value, label=label) if (value or "").strip() else None


def _account(db: Session, token: str) -> MoneyAccount:
    """Resolve one funding token to an account, creating people and shops as needed."""
    name = token.strip()
    if not name:
        raise RowError("an account name is required")
    if name.lower() == JOINT_TOKEN:
        money.ensure_accounts(db)
        return db.scalars(select(MoneyAccount).where(MoneyAccount.kind == ACCOUNT_JOINT)).one()
    if name.lower().startswith(CREDIT_PREFIX):
        return money.store_account(db, name[len(CREDIT_PREFIX) :].strip())
    return money.account_for_member(db, _member(db, name).id)


def _member(db: Session, display_name: str) -> Member:
    """The person who paid. Created without an auth id if they have never signed in.

    That is the same shape the model already allows, and it is what lets a purchase Patrick
    made in 2024 be attributed to Patrick before Patrick has opened the app.
    """
    existing = db.scalars(
        select(Member).where(func.lower(Member.display_name) == display_name.lower())
    ).first()
    if existing is not None:
        return existing
    member = Member(display_name=display_name.strip())
    db.add(member)
    db.flush()
    money.ensure_accounts(db)
    return member


def funding_legs(db: Session, value: str, *, total: int) -> list[tuple[uuid.UUID, int]]:
    """`Patrick:695.96|Jason:2196.61`, or one name, or blank for the joint account.

    The legs have to add up to what was paid. Letting them disagree is how the two ledgers
    start telling different stories about the same purchase.
    """
    text = (value or "").strip()
    if not text:
        return [(_account(db, JOINT_TOKEN).id, total)]

    parts = [part for part in text.split(LEG_SEPARATOR) if part.strip()]
    if len(parts) == 1 and AMOUNT_SEPARATOR not in parts[0].removeprefix(CREDIT_PREFIX):
        return [(_account(db, parts[0]).id, total)]

    legs: list[tuple[uuid.UUID, int]] = []
    for part in parts:
        token, _, amount = part.rpartition(AMOUNT_SEPARATOR)
        legs.append((_account(db, token).id, cents(amount, label=f"funding leg {part!r}")))

    paid = sum(amount for _, amount in legs)
    if paid != total:
        raise RowError(f"funding adds up to {paid} cents but the amount is {total}")
    if len({account_id for account_id, _ in legs}) != len(legs):
        raise RowError("an account appears twice in one funding split")
    return legs


# ------------------------------------------------------------------ row handlers


def _taxonomy(db: Session, model: type, name: str, *, label: str):
    """Games and product types are picked from the sheet by name, never created here.

    A typo that silently created a tenth game is how "why are there two Pokémons" happens.
    """
    text = (name or "").strip()
    record = db.scalars(select(model).where(func.lower(model.name) == text.lower())).first()
    if record is None:
        raise RowError(f"unknown {label}: {name!r}")
    return record


def _existing(db: Session, key: str) -> Product | None:
    return db.scalars(select(Product).where(Product.external_ref == key)).first()


def stock_row(db: Session, row: dict, *, member_id: uuid.UUID, summary: Summary) -> None:
    """A product, how it came to be held, and optionally its sale and value.

    A blank `unit_cost` is a statement, not an omission: the item is certainly held and its
    cost is not findable. See `_counted_in`.
    """
    key = (row.get("key") or "").strip()
    if not key:
        raise RowError("every stock row needs a key")
    if _existing(db, key) is not None:
        summary.skipped.append(f"{key} (already imported)")
        return

    game = _taxonomy(db, Game, row.get("game", ""), label="game")
    product_type = _taxonomy(db, ProductType, row.get("product_type", ""), label="product type")
    bucket = (row.get("bucket") or "").strip()
    if bucket not in BUCKETS:
        raise RowError(f"bucket must be one of {BUCKETS}, got {bucket!r}")

    card_set = sets.resolve(db, game_id=game.id, name=row.get("set", ""), member_id=member_id)
    product = Product(
        name=(row.get("name") or "").strip(),
        game_id=game.id,
        product_type_id=product_type.id,
        set_id=card_set.id if card_set else None,
        set_name=card_set.name if card_set else None,
        external_ref=key,
        image_url=(row.get("image_url") or "").strip() or None,
        notes=(row.get("notes") or "").strip() or None,
        created_by_member_id=member_id,
    )
    db.add(product)
    db.flush()
    summary.products += 1

    quantity = whole(row.get("quantity", ""), label="quantity")
    held = _counted_in if not (row.get("unit_cost") or "").strip() else _bought
    held(
        db,
        row,
        product=product,
        quantity=quantity,
        bucket=bucket,
        member_id=member_id,
        summary=summary,
    )

    _maybe_sale(db, row, product=product, quantity=quantity, member_id=member_id, summary=summary)
    _maybe_valuation(db, row, product=product, member_id=member_id, summary=summary)


def _counted_in(
    db: Session,
    row: dict,
    *,
    product: Product,
    quantity: int,
    bucket: str,
    member_id: uuid.UUID,
    summary: Summary,
) -> None:
    """Stock that is certainly held but whose cost nobody can find.

    Most of the Vault is this: the collection export lists what is on the shelf, and the
    spreadsheet calls the same box by a nickname three years and two tabs away. Inventing a
    plausible cost would make every future sale report a profit that is partly fiction.

    So it goes in the way the app already handles stock of unknown cost - an
    `opening_inventory` adjustment with no cost on it. The quantity is real, the holding
    shows up, no money moves, and the costing engine marks any later sale as unknown-cost
    rather than quietly crediting it with profit. When the cost turns up, the adjustment is
    edited or replaced with a real purchase; nothing here is a dead end.
    """
    if (row.get("funding") or "").strip():
        raise RowError("funding needs a unit_cost - who paid how much for a cost nobody knows?")

    adjustment = InventoryAdjustment(
        product_id=product.id,
        quantity_delta=quantity,
        reason="opening_inventory",
        landed_cost_cents=None,
        adjustment_date=_maybe_day(row.get("purchase_date", ""), label="purchase_date"),
        member_id=member_id,
        bucket=bucket,
        notes=(row.get("notes") or "").strip() or "Opening position, cost unknown",
        created_by_member_id=member_id,
    )
    db.add(adjustment)
    db.flush()
    ledger.recompute_product(db, product.id)
    ledger.record_audit(
        db,
        entity_type="adjustment",
        entity_id=adjustment.id,
        action="create",
        member_id=member_id,
        after=ledger.snapshot(adjustment, ["quantity_delta", "reason", "adjustment_date"]),
        reason="opening position import",
    )
    summary.counted_in += 1


def _bought(
    db: Session,
    row: dict,
    *,
    product: Product,
    quantity: int,
    bucket: str,
    member_id: uuid.UUID,
    summary: Summary,
) -> None:
    """A real purchase: a known cost, a known date, and money that left an account."""
    amount = cents(row.get("unit_cost", ""), label="unit_cost") * quantity
    purchase = Purchase(
        product_id=product.id,
        quantity=quantity,
        gross_amount_cents=amount,
        purchase_date=day(row.get("purchase_date", ""), label="purchase_date"),
        purchased_by_member_id=member_id,
        source=(row.get("source") or "").strip() or None,
        bucket=bucket,
        created_by_member_id=member_id,
    )
    db.add(purchase)
    db.flush()
    ledger.recompute_product(db, product.id)
    money.sync_funding(
        db,
        purchase,
        funding=funding_legs(db, row.get("funding", ""), total=purchase.landed_cost_cents),
        member_id=member_id,
    )
    ledger.record_audit(
        db,
        entity_type="purchase",
        entity_id=purchase.id,
        action="create",
        member_id=member_id,
        after=ledger.snapshot(purchase, ["quantity", "gross_amount_cents", "purchase_date"]),
        reason="opening position import",
    )
    summary.purchases += 1


def _maybe_sale(
    db: Session,
    row: dict,
    *,
    product: Product,
    quantity: int,
    member_id: uuid.UUID,
    summary: Summary,
) -> None:
    """The other half of a confirmed pair: bought for X, sold for Z.

    Profit is left to the ledger's FIFO allocation rather than taken from the sheet's own
    profit column, so the number in the app is one the app can defend.
    """
    if not (row.get("sale_amount") or "").strip():
        return

    sold = whole(row.get("sale_quantity") or str(quantity), label="sale_quantity")
    if sold > quantity:
        raise RowError(f"sold {sold} of {product.name} but only {quantity} were bought")

    sale = Sale(
        product_id=product.id,
        quantity=sold,
        gross_amount_cents=cents(row.get("sale_amount", ""), label="sale_amount"),
        sale_date=day(row.get("sale_date", ""), label="sale_date"),
        sold_by_member_id=member_id,
        bucket=(row.get("bucket") or "").strip(),
        notes=(row.get("sale_notes") or "").strip() or None,
        created_by_member_id=member_id,
    )
    db.add(sale)
    db.flush()
    ledger.recompute_product(db, product.id)
    money.sync_proceeds(
        db,
        sale,
        proceeds=funding_legs(
            db, row.get("proceeds", ""), total=sale.net_proceeds_cents
        ),
        member_id=member_id,
    )
    ledger.record_audit(
        db,
        entity_type="sale",
        entity_id=sale.id,
        action="create",
        member_id=member_id,
        after=ledger.snapshot(sale, ["quantity", "gross_amount_cents", "sale_date"]),
        reason="opening position import",
    )
    summary.sales += 1


def _maybe_valuation(
    db: Session, row: dict, *, product: Product, member_id: uuid.UUID, summary: Summary
) -> None:
    """What the Vault tab says it is worth. An estimate, and it stays one."""
    if not (row.get("value") or "").strip():
        return
    db.add(
        PriceSnapshot(
            product_id=product.id,
            value_cents=cents(row.get("value", ""), label="value"),
            captured_on=day(row.get("valued_on", ""), label="valued_on"),
            notes=(row.get("value_notes") or "").strip() or None,
            created_by_member_id=member_id,
        )
    )
    db.flush()
    summary.valuations += 1


def expense_row(db: Session, row: dict, *, member_id: uuid.UUID, summary: Summary) -> None:
    """Overhead. Legs are negative: money out, and nothing came back as stock."""
    category = (row.get("category") or "").strip()
    if category not in EXPENSE_CATEGORIES:
        raise RowError(f"category must be one of {EXPENSE_CATEGORIES}, got {category!r}")

    amount = cents(row.get("amount", ""), label="amount")
    legs = funding_legs(db, row.get("funding", ""), total=amount)
    money.record_movement(
        db,
        kind=MOVEMENT_EXPENSE,
        legs=[(account_id, -paid) for account_id, paid in legs],
        occurred_on=day(row.get("occurred_on", ""), label="occurred_on"),
        member_id=member_id,
        notes=(row.get("notes") or "").strip() or None,
        expense_category=category,
    )
    summary.expenses += 1


def balance_row(db: Session, row: dict, *, member_id: uuid.UUID, summary: Summary) -> None:
    """Move one account to the balance the group believes it has.

    Deliberately the difference rather than a replacement: the funding legs above it stay
    exactly as they happened, and whatever the spreadsheet knows that they do not shows up
    as its own adjustment somebody can read, question and edit.
    """
    account = _account(db, row.get("account", ""))
    target = cents(row.get("target_balance", ""), label="target_balance")
    current = money.balance_for(account, money.balances(db).get(account.id, 0))
    if target == current:
        summary.skipped.append(f"{account.name} (already at {current} cents)")
        return

    difference = target - current
    # A member account is a liability, so its flow runs opposite to its balance.
    delta = -difference if account.is_liability else difference
    money.record_movement(
        db,
        kind=MOVEMENT_ADJUSTMENT,
        legs=[(account.id, delta)],
        occurred_on=day(row.get("occurred_on", ""), label="occurred_on"),
        member_id=member_id,
        notes=(row.get("notes") or "").strip() or "Opening balance per spreadsheet",
    )
    summary.balances += 1


HANDLERS: dict[str, Callable[..., None]] = {
    "stock": stock_row,
    "expense": expense_row,
    "balance": balance_row,
}


# ------------------------------------------------------------------ the run


def load(db: Session, rows: list[dict], *, member_id: uuid.UUID) -> Summary:
    """Apply every row, in file order, inside the caller's transaction.

    Balance rows come last in the sheet for a reason: they reconcile against whatever the
    rows above them posted.
    """
    summary = Summary()
    for number, row in enumerate(rows, start=2):  # row 1 is the header
        kind = (row.get("kind") or "").strip()
        handler = HANDLERS.get(kind)
        if handler is None:
            raise RowError(f"row {number}: kind must be one of {ROW_KINDS}, got {kind!r}")
        try:
            handler(db, row, member_id=member_id, summary=summary)
        except RowError as error:
            raise RowError(f"row {number}: {error}") from error
    return summary


def read_rows(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def _importing_member(db: Session) -> Member:
    """Who the entries are attributed to: the first member, or a placeholder.

    Every imported row is editable by anyone, so this only decides whose name is on the
    audit trail for the load itself.
    """
    existing = db.scalars(select(Member).order_by(Member.created_at)).first()
    return existing if existing is not None else _member(db, "Import")


def main(
    argv: list[str] | None = None,
    *,
    db_factory: Callable[[], AbstractContextManager] = get_db,
) -> int:
    parser = argparse.ArgumentParser(description="Load a reviewed opening position CSV.")
    parser.add_argument("csv_path", type=Path, help="The reviewed CSV to load")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write the rows. Without it the file is parsed and reported, and nothing is saved.",
    )
    args = parser.parse_args(argv)

    rows = read_rows(args.csv_path)
    with db_factory() as db:
        try:
            summary = load(db, rows, member_id=_importing_member(db).id)
        except RowError as error:
            db.rollback()
            logger.error("import_failed %s", error)
            return 2

        for skip in summary.skipped:
            logger.info("import_skipped %s", skip)
        if args.apply:
            db.commit()
            logger.info("import_applied %s", summary.as_log())
        else:
            db.rollback()
            logger.info("import_dry_run %s (nothing written)", summary.as_log())
    return 0


if __name__ == "__main__":  # pragma: no cover - module entry point
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    sys.exit(main())
