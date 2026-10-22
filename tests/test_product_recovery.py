"""Recovering a deleted product from the audit log, as a last resort.

A delete keeps a full copy of everything it removed. Putting it back restores every row with
its original id, so the product, its stock, its profit and the money balances read exactly
as they did before the delete.
"""

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import select

from src.models.audit import ACTION_DELETE, ACTION_RESTORE, AuditLog
from src.models.catalog import CatalogMapping
from src.models.ledger import BUCKET_STORE, BUCKET_VAULT
from src.models.market_price import CurrentMarketQuote, MarketPriceSnapshot
from src.models.price_snapshot import PriceSnapshot
from src.services import recovery
from tests.test_pricing_api import mapping_payload
from tests.test_product_delete import TODAY, accounts, balances, buy

DELETED = "/api/v1/audit/deleted-products"
FETCHED = datetime(2026, 10, 11, 9, 30, tzinfo=UTC)


def deleted(client) -> list[dict]:
    response = client.get(DELETED)
    assert response.status_code == 200, response.text
    return response.json()


def restore(client, audit_id):
    return client.post(f"{DELETED}/{audit_id}/restore")


def priced(client, db, product) -> None:
    """A catalog mapping with a live quote and a day of market history."""
    created = client.post("/api/v1/pricing/mappings", json=mapping_payload(product["id"]))
    assert created.status_code == 201, created.text
    mapping = db.get(CatalogMapping, uuid.UUID(created.json()["id"]))
    db.add(
        CurrentMarketQuote(
            mapping_id=mapping.id,
            product_id=mapping.product_id,
            status="fresh",
            original_currency="USD",
            original_value_cents=10000,
            cad_value_cents=13700,
            fx_rate=Decimal("1.3700000000"),
            fx_as_of=TODAY,
            source_as_of=TODAY,
            last_successful_at=FETCHED,
        )
    )
    db.add(
        MarketPriceSnapshot(
            mapping_id=mapping.id,
            product_id=mapping.product_id,
            provider="tcgcsv",
            external_product_id="42",
            subtype_name="Normal",
            original_currency="USD",
            original_value_cents=10000,
            cad_value_cents=13700,
            fx_rate=Decimal("1.3700000000"),
            fx_as_of=TODAY,
            source_revision="r1",
            source_as_of=TODAY,
            captured_on=TODAY,
            fetched_at=FETCHED,
        )
    )
    db.add(PriceSnapshot(product_id=product["id"], value_cents=15000, captured_on=TODAY))
    db.flush()


def busy_product(client, db, make_product, name="Restore Test Box") -> dict:
    """Shared buys, a voided buy, a sale, a move, an adjustment and a market price."""
    product = make_product(name)
    joint = next(item for item in accounts(client) if item["kind"] == "joint")
    buy(client, product["id"], "300.00")
    buy(client, product["id"], "200.00", funding=[{"account_id": joint["id"]}])
    voided = buy(client, product["id"], "100.00")
    client.post(f"/api/v1/purchases/{voided['id']}/void", json={"reason": "typo"})
    sale = client.post(
        "/api/v1/sales",
        json={
            "product_id": product["id"],
            "quantity": 1,
            "amount": "250.00",
            "sale_date": TODAY.isoformat(),
            "bucket": BUCKET_STORE,
        },
    )
    assert sale.status_code == 201, sale.text
    move = client.post(
        "/api/v1/moves",
        json={
            "product_id": product["id"],
            "quantity": 1,
            "from_bucket": BUCKET_STORE,
            "to_bucket": BUCKET_VAULT,
        },
    )
    assert move.status_code == 201, move.text
    adjustment = client.post(
        "/api/v1/adjustments",
        json={"product_id": product["id"], "quantity_delta": 1, "reason": "opening_inventory"},
    )
    assert adjustment.status_code == 201, adjustment.text
    priced(client, db, product)
    return product


def test_a_deleted_product_comes_back_exactly_as_it_was(client, db, make_product):
    product = busy_product(client, db, make_product)
    detail = client.get(f"/api/v1/products/{product['id']}").json()
    money = balances(client)
    rows = recovery.capture(db, uuid.UUID(product["id"]))
    assert client.delete(f"/api/v1/products/{product['id']}").status_code == 204

    [entry] = deleted(client)
    assert entry["product_id"] == product["id"]
    assert entry["name"] == "Restore Test Box"
    assert entry["deleted_by"]
    assert (entry["purchases"], entry["sales"]) == (3, 1)
    assert entry["recoverable"] is True

    response = restore(client, entry["id"])

    assert response.status_code == 201, response.text
    assert response.json() == {"product_id": product["id"]}
    assert client.get(f"/api/v1/products/{product['id']}").json() == detail
    assert balances(client) == money
    assert recovery.capture(db, uuid.UUID(product["id"])) == rows
    assert deleted(client) == []
    log = db.scalar(select(AuditLog).where(AuditLog.action == ACTION_RESTORE))
    assert log.after == {"name": "Restore Test Box", "from_delete": entry["id"]}
    assert log.member_id is not None


def test_a_product_with_one_purchase_comes_back(client, make_product):
    """Most of what a delete copies is empty here: no sales, moves or market prices."""
    product = make_product("Plain Box")
    buy(client, product["id"], "40.00")
    client.delete(f"/api/v1/products/{product['id']}")

    assert restore(client, deleted(client)[0]["id"]).status_code == 201

    stats = client.get(f"/api/v1/products/{product['id']}").json()["stats"]
    assert (stats["quantity_on_hand"], stats["remaining_cost"]) == (2, "40.00")


def test_a_restored_product_cannot_be_restored_twice(client, db, make_product):
    product = busy_product(client, db, make_product)
    client.delete(f"/api/v1/products/{product['id']}")
    [entry] = deleted(client)
    assert restore(client, entry["id"]).status_code == 201

    response = restore(client, entry["id"])

    assert response.status_code == 409
    assert response.json()["detail"] == "This product is already back."


def test_deleted_twice_lists_only_the_latest_delete(client, db, make_product):
    product = busy_product(client, db, make_product)
    client.delete(f"/api/v1/products/{product['id']}")
    assert restore(client, deleted(client)[0]["id"]).status_code == 201
    client.delete(f"/api/v1/products/{product['id']}")

    entries = deleted(client)

    assert len(entries) == 1
    latest = db.scalars(
        select(AuditLog.id)
        .where(AuditLog.action == ACTION_DELETE)
        .order_by(AuditLog.occurred_at.desc(), AuditLog.id)
    ).first()
    assert entries[0]["id"] == str(latest)


def test_a_delete_from_before_full_copies_is_listed_but_not_recoverable(client, db):
    db.add(
        AuditLog(
            entity_type="product",
            entity_id=uuid.uuid4(),
            action=ACTION_DELETE,
            member_id=None,
            before={"name": "Old Delete", "purchases": [{}], "sales": []},
        )
    )
    db.flush()

    [entry] = deleted(client)
    assert entry["recoverable"] is False
    assert entry["deleted_by"] is None
    assert entry["purchases"] == 1

    response = restore(client, entry["id"])

    assert response.status_code == 409
    assert "before deletes kept a full copy" in response.json()["detail"]


def test_only_a_product_delete_can_be_restored(client, db, make_product):
    product = make_product("Voided Buy Box")
    purchase = buy(client, product["id"], "10.00")
    client.post(f"/api/v1/purchases/{purchase['id']}/void", json={"reason": "typo"})
    void_row = db.scalar(select(AuditLog.id).where(AuditLog.entity_type == "purchase"))
    assert void_row is not None

    assert restore(client, void_row).status_code == 404
    assert restore(client, uuid.uuid4()).status_code == 404


def test_a_restore_that_conflicts_puts_nothing_back(client, db, make_product):
    """The copy points at an account that is gone: refuse, and leave no half-restored rows."""
    product = busy_product(client, db, make_product)
    client.delete(f"/api/v1/products/{product['id']}")
    entry = db.scalar(select(AuditLog).where(AuditLog.action == ACTION_DELETE))
    records = dict(entry.before["records"])
    records["money_postings"] = [
        {**row, "account_id": str(uuid.uuid4())} for row in records["money_postings"]
    ]
    entry.before = {**entry.before, "records": records}
    db.flush()

    response = restore(client, entry.id)

    assert response.status_code == 409
    assert "no longer exists" in response.json()["detail"]
    assert client.get(f"/api/v1/products/{product['id']}").status_code == 404
    assert db.scalar(select(PriceSnapshot.id)) is None


def test_values_round_trip_through_json():
    column = CurrentMarketQuote.__table__.c
    assert recovery._decode(column.fx_rate, recovery._encode(Decimal("1.5"))) == Decimal("1.5")
    assert recovery._decode(column.fx_as_of, recovery._encode(date(2026, 1, 2))) == date(2026, 1, 2)
    assert recovery._decode(column.status, "fresh") == "fresh"
    assert recovery._decode(column.fx_rate, None) is None
