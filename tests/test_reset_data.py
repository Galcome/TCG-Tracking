"""Tests for the going-live wipe.

The risk this file guards is not that the delete fails - it is that it succeeds when nobody
meant it to. So most of what is asserted here is about refusing.
"""

import logging
from contextlib import contextmanager

import pytest
from sqlalchemy import func, select

from src.jobs import reset_data as job
from src.models.ledger import Purchase
from src.models.member import Member
from src.models.money import ACCOUNT_JOINT, ACCOUNT_MEMBER, MoneyAccount
from src.models.product import Product
from src.models.taxonomy import Game, ProductType


@pytest.fixture
def database(db):
    @contextmanager
    def factory():
        yield db

    return factory


@pytest.fixture
def some_data(db, game_id, product_type_id):
    """A product with a purchase against it, the shape a wipe has to handle."""
    product = Product(name="Test Box", game_id=game_id, product_type_id=product_type_id)
    db.add(product)
    db.flush()
    db.add(
        Purchase(
            product_id=product.id, quantity=1, gross_amount_cents=10000, bucket="inventory"
        )
    )
    db.add(Member(display_name="Joseph"))
    db.flush()
    return product


def test_without_the_flag_it_only_reports(db, database, some_data, caplog):
    caplog.set_level(logging.INFO)
    assert job.main([], db_factory=database) == 1

    assert db.scalar(select(func.count()).select_from(Purchase)) == 1
    assert "reset_would_delete" in caplog.text
    assert "flag_missing" in caplog.text


def test_a_mistyped_confirmation_deletes_nothing(db, database, some_data):
    with pytest.raises(job.ResetAborted):
        job.main([job.FLAG], db_factory=database, prompt=lambda _: "delete all data")

    assert db.scalar(select(func.count()).select_from(Purchase)) == 1


def test_confirmed_it_empties_the_data_tables(db, database, some_data):
    assert job.main([job.FLAG], db_factory=database, prompt=lambda _: job.CONFIRM_PHRASE) == 0

    assert db.scalar(select(func.count()).select_from(Purchase)) == 0
    assert db.scalar(select(func.count()).select_from(Product)) == 0


def test_taxonomy_and_people_survive(db, database, some_data):
    """Games and product types are seeded by migration; members are access, not data."""
    job.main([job.FLAG], db_factory=database, prompt=lambda _: job.CONFIRM_PHRASE)

    assert db.scalar(select(func.count()).select_from(Game)) > 0
    assert db.scalar(select(func.count()).select_from(ProductType)) > 0
    assert db.scalars(select(Member).where(Member.display_name == "Joseph")).one() is not None


def test_the_money_accounts_are_put_back(db, database, some_data):
    """They are infrastructure the app expects, not something somebody entered.

    One joint pot, and one account per surviving member - the same state a first request
    against an untouched database would create.
    """
    job.main([job.FLAG], db_factory=database, prompt=lambda _: job.CONFIRM_PHRASE)

    kinds = db.scalars(select(MoneyAccount.kind)).all()
    assert kinds.count(ACCOUNT_JOINT) == 1
    assert kinds.count(ACCOUNT_MEMBER) == db.scalar(select(func.count()).select_from(Member))


def test_the_prompt_says_how_much_is_at_stake(db, database, some_data):
    """Whoever types the phrase should be told the number before they type it."""
    asked = []
    job.main(
        [job.FLAG],
        db_factory=database,
        prompt=lambda text: asked.append(text) or job.CONFIRM_PHRASE,
    )

    assert job.CONFIRM_PHRASE in asked[0]
    assert "rows" in asked[0]


def test_nothing_to_delete_means_nothing_to_confirm(db, database, monkeypatch):
    """A database with no data in it is not a trap to re-run against."""
    monkeypatch.setattr(job, "counts", lambda _db: {})

    def refuse(_prompt):  # pragma: no cover - proving it is never reached
        raise AssertionError("should not have prompted")

    assert job.main([job.FLAG], db_factory=database, prompt=refuse) == 0


def test_counts_skip_tables_that_are_already_empty(db, some_data):
    tallies = job.counts(db)
    assert tallies["purchases"] == 1
    assert "sales" not in tallies
