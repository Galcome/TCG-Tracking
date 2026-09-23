"""Tests for the one-time load of the group's real opening position.

These run against the real ledger and money services rather than mocks, because the thing
worth proving is not that the importer calls them - it is that $1,439.92 in a spreadsheet
cell arrives as 143992 cents, in the right bucket, funded by the right people, with FIFO
profit the app computed itself.
"""

import logging
from contextlib import contextmanager

import pytest
from sqlalchemy import func, select

from src.jobs import import_opening as job
from src.models.ledger import Purchase, Sale
from src.models.member import Member
from src.models.money import ACCOUNT_JOINT, MoneyAccount, MoneyMovement, MoneyPosting
from src.models.price_snapshot import PriceSnapshot
from src.models.product import Product
from src.services import money


@pytest.fixture
def database(db):
    """`get_db`'s contract - a context manager yielding a session - over the test session."""

    @contextmanager
    def factory():
        yield db

    return factory


@pytest.fixture
def member(db) -> Member:
    person = Member(display_name="Joseph")
    db.add(person)
    db.flush()
    money.ensure_accounts(db)
    return person


def stock(**overrides) -> dict:
    row = {
        "kind": "stock",
        "key": "collectr:645298",
        "name": "Disney Lorcana: Fabled Booster Box",
        "game": "Lorcana",
        "product_type": "Booster Box",
        "set": "Fabled",
        "bucket": "vault",
        "quantity": "1",
        "unit_cost": "1439.92",
        "purchase_date": "2026-01-15",
        "funding": "",
        "source": "spreadsheet import",
    }
    row.update(overrides)
    return row


def write(tmp_path, rows: list[dict]):
    path = tmp_path / "opening.csv"
    fields = sorted({key for row in rows for key in row})
    with path.open("w", newline="", encoding="utf-8") as handle:
        import csv

        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    return path


def account_balance(db, account: MoneyAccount) -> int:
    return money.balance_for(account, money.balances(db).get(account.id, 0))


def joint(db) -> MoneyAccount:
    money.ensure_accounts(db)
    return db.scalars(select(MoneyAccount).where(MoneyAccount.kind == ACCOUNT_JOINT)).one()


# ------------------------------------------------------------------ cell parsing


@pytest.mark.parametrize(
    ("text", "expected"),
    [("1439.92", 143992), ("$1,439.92", 143992), ("0.01", 1), ("790", 79000), ("-12.50", -1250)],
)
def test_dollars_become_exact_cents(text, expected):
    """The reason the parser exists: no float ever touches a dollar figure."""
    assert job.cents(text, label="amount") == expected


@pytest.mark.parametrize("text", ["", "   ", "n/a", "3 + 2", "#VALUE!"])
def test_unparseable_amounts_are_refused_rather_than_guessed(text):
    with pytest.raises(job.RowError, match="amount"):
        job.cents(text, label="amount")


@pytest.mark.parametrize("text", ["0", "-1", "3 + 2", "", "4(32)"])
def test_quantities_must_be_whole_and_positive(text):
    with pytest.raises(job.RowError, match="quantity"):
        job.whole(text, label="quantity")


@pytest.mark.parametrize("text", ["21/03/26", "2028-13-01", "", "n/a"])
def test_only_iso_dates_are_accepted(text):
    """The workbook's `21/03/26` is ambiguous three ways. Review resolves it, not this."""
    with pytest.raises(job.RowError, match="ISO date"):
        job.day(text, label="purchase_date")


# ------------------------------------------------------------------ funding


def test_blank_funding_is_the_joint_pot(db, member):
    legs = job.funding_legs(db, "", total=10000)
    assert legs == [(joint(db).id, 10000)]


def test_one_name_takes_the_whole_amount_and_creates_the_person(db, member):
    legs = job.funding_legs(db, "Patrick", total=129622)
    patrick = db.scalars(select(Member).where(Member.display_name == "Patrick")).one()
    assert legs == [(money.account_for_member(db, patrick.id).id, 129622)]
    assert patrick.auth_user_id is None  # they have not signed in yet, and need not have


def test_a_split_is_kept_leg_by_leg(db, member):
    legs = job.funding_legs(db, "Patrick:695.96|Jason:2196.61", total=289257)
    assert [amount for _, amount in legs] == [69596, 219661]


def test_a_split_that_does_not_add_up_is_refused(db, member):
    with pytest.raises(job.RowError, match="funding adds up"):
        job.funding_legs(db, "Patrick:695.96|Jason:100.00", total=289257)


def test_the_same_account_cannot_appear_twice_in_one_split(db, member):
    with pytest.raises(job.RowError, match="twice"):
        job.funding_legs(db, "Patrick:50.00|Patrick:50.00", total=10000)


def test_store_credit_is_addressed_by_shop_name(db, member):
    legs = job.funding_legs(db, "credit:Wizards Tower", total=5000)
    account = db.get(MoneyAccount, legs[0][0])
    assert account.name == "Wizards Tower"


# ------------------------------------------------------------------ stock rows


def test_a_vault_line_lands_as_product_purchase_and_funding(db, member, database, tmp_path):
    path = write(tmp_path, [stock(funding="Patrick")])
    assert job.main([str(path), "--apply"], db_factory=database) == 0

    product = db.scalars(select(Product).where(Product.external_ref == "collectr:645298")).one()
    assert product.set_name == "Fabled"

    purchase = db.scalars(select(Purchase).where(Purchase.product_id == product.id)).one()
    assert purchase.bucket == "vault"
    assert purchase.gross_amount_cents == 143992

    patrick = db.scalars(select(Member).where(Member.display_name == "Patrick")).one()
    # A member account is a liability: the business owes Patrick what he laid out.
    assert account_balance(db, money.account_for_member(db, patrick.id)) == 143992


def test_quantity_multiplies_the_unit_cost(db, member, database, tmp_path):
    path = write(tmp_path, [stock(quantity="2", unit_cost="464.84")])
    job.main([str(path), "--apply"], db_factory=database)

    purchase = db.scalars(select(Purchase)).one()
    assert purchase.quantity == 2
    assert purchase.gross_amount_cents == 92968


def test_a_confirmed_pair_yields_profit_the_ledger_computed(db, member, database, tmp_path):
    """Bought for X, sold for Z - the thing Joseph asked to keep from three years of rows."""
    path = write(
        tmp_path,
        [
            stock(
                purchase_date="2025-06-01",
                unit_cost="400.00",
                sale_amount="650.00",
                sale_date="2025-12-31",
                sale_notes="spreadsheet import (date approximate)",
                proceeds="Jason",
            )
        ],
    )
    job.main([str(path), "--apply"], db_factory=database)

    sale = db.scalars(select(Sale)).one()
    assert sale.cost_basis_cents == 40000
    assert sale.realized_profit_cents == 25000
    assert sale.has_unknown_cost is False


def test_selling_more_than_was_bought_is_refused(db, member, database, tmp_path):
    path = write(
        tmp_path,
        [stock(quantity="1", sale_quantity="2", sale_amount="650.00", sale_date="2025-12-31")],
    )
    assert job.main([str(path), "--apply"], db_factory=database) == 2
    assert db.scalar(select(func.count()).select_from(Sale)) == 0


def test_a_vault_value_lands_as_an_estimate_not_cost(db, member, database, tmp_path):
    path = write(tmp_path, [stock(value="822.47", valued_on="2026-09-22")])
    job.main([str(path), "--apply"], db_factory=database)

    snapshot = db.scalars(select(PriceSnapshot)).one()
    assert snapshot.value_cents == 82247
    purchase = db.scalars(select(Purchase)).one()
    assert purchase.gross_amount_cents == 143992  # untouched by the estimate


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("game", "Pokeymon", "unknown game"),
        ("product_type", "Booster Crate", "unknown product type"),
        ("bucket", "warehouse", "bucket must be"),
        ("key", "", "needs a key"),
    ],
)
def test_a_bad_stock_row_names_the_problem(db, member, database, tmp_path, field, value, message):
    path = write(tmp_path, [stock(**{field: value})])
    assert job.main([str(path), "--apply"], db_factory=database) == 2
    assert db.scalar(select(func.count()).select_from(Product)) == 0


# ------------------------------------------------------------------ expenses


def test_an_expense_leaves_the_pot(db, member, database, tmp_path):
    path = write(
        tmp_path,
        [
            {
                "kind": "expense",
                "category": "subscriptions",
                "amount": "45.00",
                "occurred_on": "2026-01-01",
                "funding": "",
                "notes": "Stellar AIO",
            }
        ],
    )
    job.main([str(path), "--apply"], db_factory=database)

    assert account_balance(db, joint(db)) == -4500
    movement = db.scalars(select(MoneyMovement)).one()
    assert movement.expense_category == "subscriptions"


def test_an_invented_expense_category_is_refused(db, member, database, tmp_path):
    path = write(
        tmp_path,
        [
            {
                "kind": "expense",
                "category": "snacks",
                "amount": "45.00",
                "occurred_on": "2026-01-01",
            }
        ],
    )
    assert job.main([str(path), "--apply"], db_factory=database) == 2


# ------------------------------------------------------------------ balances


def balance_row(**overrides) -> dict:
    row = {
        "kind": "balance",
        "account": "Patrick",
        "target_balance": "1296.22",
        "occurred_on": "2026-09-22",
    }
    row.update(overrides)
    return row


def test_a_balance_row_moves_the_account_to_the_stated_figure(db, member, database, tmp_path):
    path = write(tmp_path, [balance_row()])
    job.main([str(path), "--apply"], db_factory=database)

    patrick = db.scalars(select(Member).where(Member.display_name == "Patrick")).one()
    assert account_balance(db, money.account_for_member(db, patrick.id)) == 129622


def test_a_balance_row_only_posts_the_difference(db, member, database, tmp_path):
    """The funding legs above it are real history and must survive the reconciliation."""
    path = write(
        tmp_path,
        [
            stock(unit_cost="1000.00", funding="Patrick"),
            balance_row(target_balance="1296.22"),
        ],
    )
    job.main([str(path), "--apply"], db_factory=database)

    patrick = db.scalars(select(Member).where(Member.display_name == "Patrick")).one()
    account = money.account_for_member(db, patrick.id)
    assert account_balance(db, account) == 129622

    postings = db.scalars(
        select(MoneyPosting).where(MoneyPosting.account_id == account.id)
    ).all()
    # One for what he actually paid, one for the gap the spreadsheet knows about.
    assert sorted(posting.delta_cents for posting in postings) == [-100000, -(129622 - 100000)]


def test_a_balance_already_correct_writes_nothing(db, member, database, tmp_path, caplog):
    caplog.set_level(logging.INFO)
    path = write(tmp_path, [balance_row(account="joint", target_balance="0")])
    job.main([str(path), "--apply"], db_factory=database)

    assert db.scalar(select(func.count()).select_from(MoneyMovement)) == 0
    assert "already at" in caplog.text


def test_the_joint_account_takes_the_brokerage_figure(db, member, database, tmp_path):
    path = write(tmp_path, [balance_row(account="joint", target_balance="790.00")])
    job.main([str(path), "--apply"], db_factory=database)

    assert account_balance(db, joint(db)) == 79000


# ------------------------------------------------------------------ the run


def test_a_dry_run_reports_and_writes_nothing(db, member, database, tmp_path, caplog):
    caplog.set_level(logging.INFO)
    path = write(tmp_path, [stock()])
    assert job.main([str(path)], db_factory=database) == 0

    assert "nothing written" in caplog.text
    assert db.scalar(select(func.count()).select_from(Product)) == 0


def test_running_twice_changes_nothing(db, member, database, tmp_path, caplog):
    """Idempotent by `key`, so a re-run after a fix cannot double the position."""
    caplog.set_level(logging.INFO)
    path = write(tmp_path, [stock()])
    job.main([str(path), "--apply"], db_factory=database)
    job.main([str(path), "--apply"], db_factory=database)

    assert db.scalar(select(func.count()).select_from(Purchase)) == 1
    assert "already imported" in caplog.text


def test_one_bad_row_rolls_back_the_whole_file(db, member, database, tmp_path, caplog):
    caplog.set_level(logging.INFO)
    path = write(
        tmp_path,
        [stock(), stock(key="collectr:651123", name="Ariel", unit_cost="not a number")],
    )
    assert job.main([str(path), "--apply"], db_factory=database) == 2
    assert db.scalar(select(func.count()).select_from(Product)) == 0
    assert "row 3" in caplog.text


def test_an_unknown_kind_is_refused(db, member, database, tmp_path):
    path = write(tmp_path, [{"kind": "transfer", "amount": "10.00"}])
    assert job.main([str(path), "--apply"], db_factory=database) == 2


def test_with_no_members_yet_the_import_attributes_itself(db, database, tmp_path):
    """A fresh database after the reset has no people in it, and the load still runs."""
    path = write(tmp_path, [stock()])
    assert job.main([str(path), "--apply"], db_factory=database) == 0
    assert db.scalars(select(Member).where(Member.display_name == "Import")).one() is not None


def test_the_summary_reads_as_one_line():
    line = job.Summary(products=2, purchases=2, sales=1).as_log()
    assert "products=2" in line and "sales=1" in line


def test_a_balance_row_with_no_account_named_is_refused(db, member, database, tmp_path):
    path = write(tmp_path, [balance_row(account="")])
    assert job.main([str(path), "--apply"], db_factory=database) == 2
