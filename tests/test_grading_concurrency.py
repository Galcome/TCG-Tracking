"""Real PostgreSQL transactions, with UUID-owned committed fixtures and precise cleanup."""

import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date
from threading import Barrier

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from src.database import engine
from src.models.audit import AuditLog
from src.models.grading import GradingSubmission
from src.models.ledger import CostAllocation, InventoryAdjustment, Purchase, Sale, StockMove
from src.models.member import Member
from src.models.product import Product
from src.models.taxonomy import Game, ProductType
from src.models.transformation import Transformation, TransformationOutput
from src.routes.grading import ReturnRequest, SubmitRequest, submit, take_back
from src.routes.ledger import create_move, create_sale, update_sale, void_sale
from src.schemas.ledger import MoveCreate, SaleCreate, SaleUpdate, VoidRequest
from src.services import inventory, ledger, transformations


@dataclass
class Stock:
    raw: uuid.UUID
    graded: uuid.UUID
    member: Member


@pytest.fixture
def concurrent_stock(request):
    # Unlike savepoint fixtures, concurrent sessions need committed seed rows. Refuse
    # anything except a local/CI test database before creating those rows.
    assert engine.url.host in {"127.0.0.1", "localhost", "postgres"}
    assert "test" in (engine.url.database or "").lower()
    ids = [uuid.uuid4(), uuid.uuid4()]
    member = Member(id=uuid.uuid4(), display_name="Concurrency test member")
    with Session(engine, expire_on_commit=False) as db:
        game = db.scalar(select(Game.id).where(Game.slug == "pokemon"))
        product_type = db.scalar(select(ProductType.id).where(ProductType.slug == "single"))
        assert game and product_type
        db.add(member)
        db.add_all(
            [
                Product(
                    id=product_id,
                    name=f"Concurrency {product_id}",
                    game_id=game,
                    product_type_id=product_type,
                )
                for product_id in ids
            ]
        )
        db.flush()
        db.add(
            Purchase(
                product_id=ids[0],
                quantity=getattr(request, "param", 2),
                gross_amount_cents=1001,
                purchase_date=date.today(),
            )
        )
        db.flush()
        ledger.recompute_product(db, ids[0])
        db.commit()
    try:
        yield Stock(ids[0], ids[1], member)
    finally:
        # Only this fixture's UUIDs/member are touched; never reset the database/schema.
        with Session(engine) as db:
            db.execute(delete(AuditLog).where(AuditLog.member_id == member.id))
            db.execute(delete(GradingSubmission).where(GradingSubmission.product_id.in_(ids)))
            db.execute(delete(CostAllocation).where(CostAllocation.product_id.in_(ids)))
            db.execute(delete(TransformationOutput).where(TransformationOutput.product_id.in_(ids)))
            db.execute(delete(Transformation).where(Transformation.source_product_id.in_(ids)))
            db.execute(delete(InventoryAdjustment).where(InventoryAdjustment.product_id.in_(ids)))
            db.execute(delete(Sale).where(Sale.product_id.in_(ids)))
            db.execute(delete(StockMove).where(StockMove.product_id.in_(ids)))
            db.execute(delete(Purchase).where(Purchase.product_id.in_(ids)))
            db.execute(delete(Product).where(Product.id.in_(ids)))
            db.execute(delete(Member).where(Member.id == member.id))
            db.commit()


def race(operation, other=None):
    barrier = Barrier(2)

    def transaction(run):
        with Session(engine) as db:
            db.execute(text("SET LOCAL lock_timeout = '5s'"))
            db.execute(text("SET LOCAL statement_timeout = '10s'"))
            barrier.wait(timeout=5)
            try:
                run(db)
                db.commit()
                return 200
            except HTTPException as error:
                db.rollback()
                return error.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(transaction, run) for run in [operation, other or operation]]
        return sorted(future.result(timeout=15) for future in futures)


@pytest.mark.parametrize("concurrent_stock", [1], indirect=True)
def test_simultaneous_sends_cannot_exceed_one_unit(concurrent_stock):
    stock = concurrent_stock
    assert race(lambda db: submit(SubmitRequest(product_id=stock.raw), stock.member, db)) == [
        200,
        409,
    ]
    with Session(engine) as db:
        submissions = db.scalars(
            select(GradingSubmission).where(GradingSubmission.product_id == stock.raw)
        ).all()
        assert len(submissions) == 1
        assert inventory.product_stats(db, [stock.raw])[stock.raw].quantity_on_hand == 1


def test_simultaneous_returns_use_fresh_submission_status_even_with_spare_stock(concurrent_stock):
    stock = concurrent_stock
    with Session(engine) as db:
        sent = submit(SubmitRequest(product_id=stock.raw), stock.member, db)
        submission_id = sent.id
        db.commit()
    payload = ReturnRequest(graded_product_id=stock.graded, grade="10")
    assert race(lambda db: take_back(submission_id, payload, stock.member, db)) == [200, 409]
    with Session(engine) as db:
        stats = inventory.product_stats(db, [stock.raw, stock.graded])
        assert stats[stock.raw].quantity_on_hand == 1
        assert stats[stock.graded].quantity_on_hand == 1
        assert (
            len(
                db.scalars(
                    select(Transformation).where(Transformation.source_product_id == stock.raw)
                ).all()
            )
            == 1
        )


@pytest.mark.parametrize("concurrent_stock", [1], indirect=True)
def test_grading_return_and_sale_cannot_consume_the_same_unit(concurrent_stock):
    stock = concurrent_stock
    with Session(engine) as db:
        sent = submit(SubmitRequest(product_id=stock.raw), stock.member, db)
        submission_id = sent.id
        db.commit()
    statuses = race(
        lambda db: take_back(
            submission_id, ReturnRequest(graded_product_id=stock.graded), stock.member, db
        ),
        lambda db: create_sale(
            SaleCreate(product_id=stock.raw, quantity=1, amount="20.00", proceeds=[]),
            stock.member,
            db,
        ),
    )
    assert statuses == [200, 409]
    with Session(engine) as db:
        assert inventory.product_stats(db, [stock.raw])[stock.raw].quantity_on_hand == 0


@pytest.mark.parametrize("concurrent_stock", [1], indirect=True)
def test_grading_return_and_bucket_move_share_fresh_stock_checks(concurrent_stock):
    stock = concurrent_stock
    with Session(engine) as db:
        sent = submit(SubmitRequest(product_id=stock.raw), stock.member, db)
        submission_id = sent.id
        db.commit()
    statuses = race(
        lambda db: take_back(
            submission_id, ReturnRequest(graded_product_id=stock.graded), stock.member, db
        ),
        lambda db: create_move(
            MoveCreate(
                product_id=stock.raw, quantity=1, from_bucket="inventory", to_bucket="vault"
            ),
            stock.member,
            db,
        ),
    )
    assert statuses == [200, 409]
    with Session(engine) as db:
        stats = inventory.product_stats(db, [stock.raw, stock.graded])
        assert stats[stock.raw].quantity_on_hand + stats[stock.graded].quantity_on_hand == 1
        assert all(value >= 0 for product in stats.values() for value in product.by_bucket.values())


@pytest.mark.parametrize("concurrent_stock", [2], indirect=True)
def test_grading_return_and_sale_update_cannot_overconsume_the_same_units(concurrent_stock):
    """A quantity edit must serialize with a return's fresh stock check."""
    stock = concurrent_stock
    with Session(engine) as db:
        sent = submit(
            SubmitRequest(product_id=stock.raw, quantity=1), stock.member, db
        )
        sale = create_sale(
            SaleCreate(product_id=stock.raw, quantity=1, amount="20.00", proceeds=[]),
            stock.member,
            db,
        )
        sale_id = sale.id
        db.commit()

    statuses = race(
        lambda db: take_back(
            sent.id, ReturnRequest(graded_product_id=stock.graded), stock.member, db
        ),
        lambda db: update_sale(
            sale_id, SaleUpdate(quantity=2), stock.member, db
        ),
    )
    assert statuses == [200, 409]
    with Session(engine) as db:
        stats = inventory.product_stats(db, [stock.raw, stock.graded])
        assert stats[stock.raw].quantity_on_hand == 0
        assert all(value >= 0 for product in stats.values() for value in product.by_bucket.values())


def test_sale_edit_and_void_share_product_first_lock(concurrent_stock):
    """An edit racing a void completes without a deadlock or duplicate void audit."""
    stock = concurrent_stock
    with Session(engine) as db:
        sale = create_sale(
            SaleCreate(product_id=stock.raw, quantity=1, amount="20.00", proceeds=[]),
            stock.member,
            db,
        )
        sale_id = sale.id
        db.commit()

    statuses = race(
        lambda db: update_sale(
            sale_id, SaleUpdate(notes="corrected"), stock.member, db
        ),
        lambda db: void_sale(
            sale_id, VoidRequest(reason="entered twice"), stock.member, db
        ),
    )
    # If the edit wins, the void follows it; if the void wins, the refreshed edit gets a
    # 409. Any database deadlock/500 propagates out of race() and fails this test.
    assert statuses in ([200, 200], [200, 409])
    with Session(engine) as db:
        final = db.get(Sale, sale_id)
        assert final is not None
        assert final.status == "voided"
        void_audits = db.scalars(
            select(AuditLog).where(
                AuditLog.entity_type == "sale",
                AuditLog.entity_id == sale_id,
                AuditLog.action == "void",
            )
        ).all()
        assert len(void_audits) == 1


def test_concurrent_transformation_voids_write_one_audit_and_restore_once(concurrent_stock):
    """A stale ORM transformation row cannot be voided twice after product locking."""
    stock = concurrent_stock
    with Session(engine) as db:
        record = transformations.transform(
            db,
            kind="grade",
            source_product_id=stock.raw,
            source_quantity=1,
            source_bucket="inventory",
            outputs=[
                transformations.OutputSpec(
                    product_id=stock.graded, quantity=1, bucket="inventory"
                )
            ],
            occurred_on=date.today(),
            member_id=stock.member.id,
        )
        transformation_id = record.id
        db.commit()

    barrier = Barrier(2)

    def void_with_stale_read(reason: str) -> int:
        with Session(engine) as db:
            stale = db.get(Transformation, transformation_id)
            assert stale is not None
            barrier.wait(timeout=5)
            try:
                transformations.void(
                    db, stale, member_id=stock.member.id, reason=reason
                )
                db.commit()
                return 200
            except HTTPException as error:
                db.rollback()
                return error.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(void_with_stale_read, "first void"),
            pool.submit(void_with_stale_read, "second void"),
        ]
        statuses = sorted(future.result(timeout=15) for future in futures)

    assert statuses == [200, 409]
    with Session(engine) as db:
        final = db.get(Transformation, transformation_id)
        assert final is not None
        assert final.status == "voided"
        assert final.void_reason in {"first void", "second void"}
        void_audits = db.scalars(
            select(AuditLog).where(
                AuditLog.entity_type == "transformation",
                AuditLog.entity_id == transformation_id,
                AuditLog.action == "void",
            )
        ).all()
        assert len(void_audits) == 1
        stats = inventory.product_stats(db, [stock.raw, stock.graded])
        assert stats[stock.raw].quantity_on_hand == 2
        graded_stats = stats.get(stock.graded)
        assert graded_stats is None or graded_stats.quantity_on_hand == 0
