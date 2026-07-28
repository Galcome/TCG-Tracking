"""Tests for the ledger endpoints.

These exercise the money boundary, the oversell guard, and the fact that every write
recomputes cost basis - the behaviours a client can actually observe.
"""

import uuid
from datetime import date

import pytest


@pytest.fixture
def product(make_product):
    return make_product()


def purchase_payload(product_id, **overrides):
    return {
        "product_id": product_id,
        "quantity": 2,
        "amount": "300.00",
        "purchase_date": "2026-01-10",
        **overrides,
    }


def sale_payload(product_id, **overrides):
    return {
        "product_id": product_id,
        "quantity": 1,
        "amount": "200.00",
        "sale_date": "2026-02-01",
        **overrides,
    }


# ----------------------------------------------------------------------- purchases


def test_recording_a_purchase_returns_decimal_money(client, product):
    response = client.post("/api/v1/purchases", json=purchase_payload(product["id"]))
    assert response.status_code == 201
    body = response.json()
    assert body["amount"] == "300.00"
    assert body["landed_cost"] == "300.00"
    assert body["status"] == "active"


def test_landed_cost_adds_shipping_tax_and_fees(client, product):
    response = client.post(
        "/api/v1/purchases",
        json=purchase_payload(
            product["id"], quantity=1, amount="100.00", shipping="15.00", tax="13.00", fees="2.00"
        ),
    )
    assert response.json()["landed_cost"] == "130.00"


def test_a_purchase_shows_up_as_stock(client, product):
    client.post("/api/v1/purchases", json=purchase_payload(product["id"]))
    stats = client.get(f"/api/v1/products/{product['id']}").json()["stats"]

    assert stats["quantity_on_hand"] == 2
    assert stats["total_invested"] == "300.00"
    assert stats["average_unit_cost"] == "150.00"


def test_money_must_be_a_sane_amount(client, product):
    for bad in ["-1.00", "abc", "1.234"]:
        response = client.post(
            "/api/v1/purchases", json=purchase_payload(product["id"], amount=bad)
        )
        assert response.status_code == 422, bad


def test_quantity_must_be_positive(client, product):
    response = client.post("/api/v1/purchases", json=purchase_payload(product["id"], quantity=0))
    assert response.status_code == 422


def test_a_purchase_against_a_missing_product_is_404(client):
    response = client.post("/api/v1/purchases", json=purchase_payload(str(uuid.uuid4())))
    assert response.status_code == 404


def test_purchase_date_defaults_to_today(client, product):
    payload = purchase_payload(product["id"])
    del payload["purchase_date"]
    body = client.post("/api/v1/purchases", json=payload).json()
    assert body["purchase_date"] == date.today().isoformat(), (
        "an undated event would sort before all history in the costing engine"
    )


def test_editing_a_purchase_recomputes_the_sale_it_funded(client, product):
    purchase = client.post("/api/v1/purchases", json=purchase_payload(product["id"])).json()
    sale = client.post("/api/v1/sales", json=sale_payload(product["id"])).json()
    assert sale["cost_basis"] == "150.00"

    client.patch(
        f"/api/v1/purchases/{purchase['id']}",
        json={"amount": "500.00", "reason": "receipt said 500"},
    )
    detail = client.get(f"/api/v1/products/{product['id']}").json()
    updated = next(t for t in detail["history"] if t["kind"] == "sale")
    assert updated["cost"] == "250.00", "the sale's cost basis follows the corrected purchase"


def test_voiding_a_purchase_requires_a_reason(client, product):
    purchase = client.post("/api/v1/purchases", json=purchase_payload(product["id"])).json()
    assert client.post(f"/api/v1/purchases/{purchase['id']}/void", json={}).status_code == 422
    assert (
        client.post(f"/api/v1/purchases/{purchase['id']}/void", json={"reason": "  "}).status_code
        == 422
    )


def test_voiding_a_purchase_removes_its_stock(client, product):
    purchase = client.post("/api/v1/purchases", json=purchase_payload(product["id"])).json()
    response = client.post(
        f"/api/v1/purchases/{purchase['id']}/void", json={"reason": "entered twice"}
    )
    assert response.status_code == 200
    assert response.json()["status"] == "voided"

    stats = client.get(f"/api/v1/products/{product['id']}").json()["stats"]
    assert stats["quantity_on_hand"] == 0


def test_a_voided_purchase_cannot_be_edited(client, product):
    purchase = client.post("/api/v1/purchases", json=purchase_payload(product["id"])).json()
    client.post(f"/api/v1/purchases/{purchase['id']}/void", json={"reason": "x"})

    response = client.patch(f"/api/v1/purchases/{purchase['id']}", json={"quantity": 5})
    assert response.status_code == 409


def test_editing_a_missing_purchase_is_404(client):
    assert (
        client.patch(f"/api/v1/purchases/{uuid.uuid4()}", json={"quantity": 1}).status_code == 404
    )


def test_purchase_update_rejects_explicit_nulls(client, product):
    purchase = client.post("/api/v1/purchases", json=purchase_payload(product["id"])).json()
    response = client.patch(f"/api/v1/purchases/{purchase['id']}", json={"quantity": None})
    assert response.status_code == 422


# --------------------------------------------------------------------------- sales


def test_recording_a_sale_computes_profit(client, product):
    client.post("/api/v1/purchases", json=purchase_payload(product["id"]))
    response = client.post("/api/v1/sales", json=sale_payload(product["id"]))

    assert response.status_code == 201
    body = response.json()
    assert body["cost_basis"] == "150.00"
    assert body["net_proceeds"] == "200.00"
    assert body["realized_profit"] == "50.00"
    assert body["has_unknown_cost"] is False


def test_fees_reduce_net_proceeds(client, product):
    client.post("/api/v1/purchases", json=purchase_payload(product["id"]))
    body = client.post(
        "/api/v1/sales",
        json=sale_payload(
            product["id"], platform_fees="10.00", payment_fees="5.00", shipping_paid="15.00"
        ),
    ).json()

    assert body["net_proceeds"] == "170.00"
    assert body["realized_profit"] == "20.00"


def test_selling_more_than_stock_is_refused(client, product):
    client.post("/api/v1/purchases", json=purchase_payload(product["id"], quantity=1))
    response = client.post("/api/v1/sales", json=sale_payload(product["id"], quantity=3))

    assert response.status_code == 409
    assert "Only 1 in stock" in response.json()["detail"]


def test_overselling_is_allowed_when_asked_explicitly(client, product):
    client.post("/api/v1/purchases", json=purchase_payload(product["id"], quantity=1))
    response = client.post(
        "/api/v1/sales", json=sale_payload(product["id"], quantity=3, allow_oversell=True)
    )

    assert response.status_code == 201
    assert response.json()["has_unknown_cost"] is True
    assert response.json()["cost_basis"] is None, "unknown cost is null, never '0.00'"
    assert response.json()["realized_profit"] is None


def test_selling_with_no_stock_at_all_is_refused(client, product):
    response = client.post("/api/v1/sales", json=sale_payload(product["id"]))
    assert response.status_code == 409
    assert "Only 0 in stock" in response.json()["detail"]


def test_editing_a_sale_upward_respects_remaining_stock(client, product):
    client.post("/api/v1/purchases", json=purchase_payload(product["id"], quantity=2))
    sale = client.post("/api/v1/sales", json=sale_payload(product["id"], quantity=1)).json()

    # 1 sold of 2, so going to 2 is fine but 3 is not.
    assert client.patch(f"/api/v1/sales/{sale['id']}", json={"quantity": 2}).status_code == 200
    assert client.patch(f"/api/v1/sales/{sale['id']}", json={"quantity": 3}).status_code == 409


def test_voiding_a_sale_returns_the_stock(client, product):
    client.post("/api/v1/purchases", json=purchase_payload(product["id"]))
    sale = client.post("/api/v1/sales", json=sale_payload(product["id"])).json()

    client.post(f"/api/v1/sales/{sale['id']}/void", json={"reason": "buyer backed out"})
    stats = client.get(f"/api/v1/products/{product['id']}").json()["stats"]

    assert stats["quantity_on_hand"] == 2
    assert stats["sale_count"] == 0


def test_sale_defaults_the_seller_to_the_caller(client, product):
    client.post("/api/v1/purchases", json=purchase_payload(product["id"]))
    me = client.get("/api/v1/members/me").json()
    body = client.post("/api/v1/sales", json=sale_payload(product["id"])).json()
    assert body["sold_by_member_id"] == me["id"]


def test_editing_a_missing_sale_is_404(client):
    assert client.patch(f"/api/v1/sales/{uuid.uuid4()}", json={"quantity": 1}).status_code == 404


def test_voiding_a_missing_sale_is_404(client):
    response = client.post(f"/api/v1/sales/{uuid.uuid4()}/void", json={"reason": "x"})
    assert response.status_code == 404


def test_sale_update_rejects_explicit_nulls(client, product):
    client.post("/api/v1/purchases", json=purchase_payload(product["id"]))
    sale = client.post("/api/v1/sales", json=sale_payload(product["id"])).json()
    assert client.patch(f"/api/v1/sales/{sale['id']}", json={"amount": None}).status_code == 422


def test_a_sale_against_a_missing_product_is_404(client):
    assert client.post("/api/v1/sales", json=sale_payload(str(uuid.uuid4()))).status_code == 404


# --------------------------------------------------------------------- adjustments


def test_writing_off_stock_removes_it_without_touching_profit(client, product):
    client.post(
        "/api/v1/purchases", json=purchase_payload(product["id"], quantity=3, amount="300.00")
    )
    response = client.post(
        "/api/v1/adjustments",
        json={
            "product_id": product["id"],
            "quantity_delta": -1,
            "reason": "damaged",
            "adjustment_date": "2026-03-01",
        },
    )
    assert response.status_code == 201
    assert response.json()["cost_removed"] == "100.00"

    stats = client.get(f"/api/v1/products/{product['id']}").json()["stats"]
    assert stats["quantity_on_hand"] == 2
    assert stats["cost_written_off"] == "100.00"
    assert stats["realized_profit"] == "0.00", "a write-off is not a loss on a sale"


def test_counting_in_stock_with_a_known_cost(client, product):
    response = client.post(
        "/api/v1/adjustments",
        json={
            "product_id": product["id"],
            "quantity_delta": 4,
            "reason": "opening_inventory",
            "cost": "400.00",
            "adjustment_date": "2026-01-01",
        },
    )
    assert response.status_code == 201
    stats = client.get(f"/api/v1/products/{product['id']}").json()["stats"]
    assert stats["quantity_on_hand"] == 4
    assert stats["total_invested"] == "400.00"


def test_an_adjustment_of_zero_is_rejected(client, product):
    response = client.post(
        "/api/v1/adjustments",
        json={"product_id": product["id"], "quantity_delta": 0, "reason": "correction"},
    )
    assert response.status_code == 422


def test_an_unknown_reason_is_rejected(client, product):
    response = client.post(
        "/api/v1/adjustments",
        json={"product_id": product["id"], "quantity_delta": 1, "reason": "vibes"},
    )
    assert response.status_code == 422


def test_a_cost_cannot_be_attached_to_stock_leaving(client, product):
    response = client.post(
        "/api/v1/adjustments",
        json={
            "product_id": product["id"],
            "quantity_delta": -1,
            "reason": "damaged",
            "cost": "10.00",
        },
    )
    assert response.status_code == 422


def test_voiding_an_adjustment_restores_stock(client, product):
    client.post("/api/v1/purchases", json=purchase_payload(product["id"], quantity=3))
    adjustment = client.post(
        "/api/v1/adjustments",
        json={"product_id": product["id"], "quantity_delta": -1, "reason": "damaged"},
    ).json()

    client.post(f"/api/v1/adjustments/{adjustment['id']}/void", json={"reason": "found it"})
    stats = client.get(f"/api/v1/products/{product['id']}").json()["stats"]
    assert stats["quantity_on_hand"] == 3


def test_an_adjustment_against_a_missing_product_is_404(client):
    response = client.post(
        "/api/v1/adjustments",
        json={"product_id": str(uuid.uuid4()), "quantity_delta": 1, "reason": "correction"},
    )
    assert response.status_code == 404


def test_voiding_a_missing_adjustment_is_404(client):
    response = client.post(f"/api/v1/adjustments/{uuid.uuid4()}/void", json={"reason": "x"})
    assert response.status_code == 404
