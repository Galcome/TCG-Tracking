"""Deleting a product: one step, everything recorded against it goes, and a log stays.

Test entries used to need every purchase voided one by one, and even then the product could
only be archived. Now the delete takes the purchases, sales, moves and money with it, and an
audit row records what was removed.
"""

from datetime import date

from sqlalchemy import select

from src.models.audit import ACTION_DELETE, AuditLog
from src.models.ledger import BUCKET_STORE, BUCKET_VAULT, CostAllocation, Purchase
from src.models.money import MoneyMovement
from src.models.price_snapshot import PriceSnapshot

TODAY = date.today()


def accounts(client) -> list[dict]:
    return client.get("/api/v1/money/accounts").json()["items"]


def balances(client) -> dict[str, str]:
    return {item["id"]: item["balance"] for item in accounts(client)}


def buy(client, product_id, amount, **extra) -> dict:
    response = client.post(
        "/api/v1/purchases",
        json={
            "product_id": product_id,
            "quantity": 2,
            "amount": amount,
            "purchase_date": TODAY.isoformat(),
            "bucket": BUCKET_STORE,
            **extra,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_a_product_with_history_is_deleted_in_one_step(client, make_product, db):
    """The Delta Reign case: bought by several people, one purchase already voided."""
    product = make_product("Delta Test Box")
    joint = next(item for item in accounts(client) if item["kind"] == "joint")
    before = balances(client)

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
    db.add(PriceSnapshot(product_id=product["id"], value_cents=15000, captured_on=TODAY))
    db.flush()
    assert balances(client) != before

    response = client.delete(f"/api/v1/products/{product['id']}")

    assert response.status_code == 204
    assert client.get(f"/api/v1/products/{product['id']}").status_code == 404
    assert balances(client) == before, "the money it moved goes with it"
    for model in (Purchase, CostAllocation, PriceSnapshot):
        assert db.scalar(select(model.id).where(model.product_id == product["id"])) is None
    assert db.scalar(select(MoneyMovement.id)) is None

    log = db.scalar(select(AuditLog).where(AuditLog.action == ACTION_DELETE))
    assert log.entity_type == "product"
    assert str(log.entity_id) == product["id"]
    assert log.member_id is not None
    assert log.before["name"] == "Delta Test Box"
    assert [p["landed_cost_cents"] for p in log.before["purchases"]] == [30000, 20000, 10000]
    assert [p["status"] for p in log.before["purchases"]] == ["active", "active", "voided"]
    assert log.before["sales"][0]["gross_amount_cents"] == 25000


def test_deleting_one_product_leaves_the_others_alone(client, make_product):
    doomed = make_product("Doomed Test Box")
    kept = make_product("Kept Box")
    buy(client, doomed["id"], "100.00")
    buy(client, kept["id"], "400.00")

    assert client.delete(f"/api/v1/products/{doomed['id']}").status_code == 204

    stats = client.get(f"/api/v1/products/{kept['id']}").json()["stats"]
    assert stats["quantity_on_hand"] == 2
    assert any(item["balance"] == "400.00" for item in accounts(client))


def test_an_opened_case_and_its_boxes_cannot_be_deleted(client, make_product):
    """A rip ties the case to the boxes' cost; deleting either side would corrupt the other."""
    case = make_product("Opened Case")
    box = make_product("Box From Case")
    buy(client, case["id"], "900.00", bucket="inventory")
    crack = client.post(
        "/api/v1/transformations/crack",
        json={"product_id": case["id"], "outputs": [{"product_id": box["id"], "quantity": 6}]},
    )
    assert crack.status_code == 201, crack.text

    for product in (case, box):
        response = client.delete(f"/api/v1/products/{product['id']}")
        assert response.status_code == 409
        assert "opened or sent for grading" in response.json()["detail"]


def test_a_card_sent_for_grading_cannot_be_deleted(client, make_product):
    card = make_product("Graded Test Card")
    buy(client, card["id"], "50.00", bucket="inventory")
    assert client.post("/api/v1/grading", json={"product_id": card["id"]}).status_code == 201

    assert client.delete(f"/api/v1/products/{card['id']}").status_code == 409
