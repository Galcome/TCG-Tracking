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


def unit_costs(client, purchase_id, costs, **extra):
    return client.post(
        f"/api/v1/purchases/{purchase_id}/unit-costs", json={"unit_costs": costs, **extra}
    )


def test_units_bought_at_different_prices_become_their_own_lots(client, product):
    """Five boxes entered as one purchase, corrected to what each one really cost."""
    purchase = client.post(
        "/api/v1/purchases", json=purchase_payload(product["id"], quantity=5, amount="0.00")
    ).json()

    response = unit_costs(
        client,
        purchase["id"],
        ["100.00", "120.00", "100.00", "90.00", "120.00"],
        reason="priced from receipts",
    )
    assert response.status_code == 200, response.text
    lots = response.json()

    assert [(lot["quantity"], lot["amount"]) for lot in lots] == [
        (2, "200.00"),
        (2, "240.00"),
        (1, "90.00"),
    ]
    assert lots[0]["id"] == purchase["id"], "the first price keeps the original row"
    assert {lot["purchase_date"] for lot in lots} == {"2026-01-10"}

    stats = client.get(f"/api/v1/products/{product['id']}").json()["stats"]
    assert stats["quantity_on_hand"] == 5
    assert stats["total_invested"] == "530.00"


def test_one_price_for_every_unit_keeps_a_single_purchase(client, product):
    purchase = client.post(
        "/api/v1/purchases", json=purchase_payload(product["id"], quantity=3, amount="0.00")
    ).json()

    lots = unit_costs(client, purchase["id"], ["50.00", "50.00", "50.00"]).json()

    assert [(lot["id"], lot["quantity"], lot["amount"]) for lot in lots] == [
        (purchase["id"], 3, "150.00")
    ]


def test_shipping_tax_and_fees_follow_the_units(client, product):
    purchase = client.post(
        "/api/v1/purchases",
        json=purchase_payload(
            product["id"], quantity=3, amount="300.00", shipping="9.00", tax="3.00", fees="0.10"
        ),
    ).json()

    lots = unit_costs(client, purchase["id"], ["100.00", "100.00", "130.00"]).json()

    assert [(lot["shipping"], lot["tax"], lot["fees"]) for lot in lots] == [
        ("6.00", "2.00", "0.07"),
        ("3.00", "1.00", "0.03"),
    ]
    stats = client.get(f"/api/v1/products/{product['id']}").json()["stats"]
    assert stats["total_invested"] == "342.10", "nothing paid is lost in the split"


def test_a_sale_takes_the_cost_of_the_lot_it_came_from(client, product):
    purchase = client.post(
        "/api/v1/purchases", json=purchase_payload(product["id"], quantity=2, amount="0.00")
    ).json()
    unit_costs(client, purchase["id"], ["80.00", "140.00"])

    sale = client.post("/api/v1/sales", json=sale_payload(product["id"])).json()

    assert sale["cost_basis"] == "80.00", "FIFO hands over a real box, not the average"


def test_unit_costs_must_cover_every_unit(client, product):
    purchase = client.post("/api/v1/purchases", json=purchase_payload(product["id"])).json()

    response = unit_costs(client, purchase["id"], ["100.00"])

    assert response.status_code == 422
    assert "2 units" in response.json()["detail"]


def test_a_voided_purchase_cannot_be_priced_by_unit(client, product):
    purchase = client.post("/api/v1/purchases", json=purchase_payload(product["id"])).json()
    client.post(f"/api/v1/purchases/{purchase['id']}/void", json={"reason": "x"})

    assert unit_costs(client, purchase["id"], ["1.00", "2.00"]).status_code == 409


def test_stock_opened_from_a_case_cannot_be_priced_by_unit(client, make_product):
    """Its cost is the case's cost; splitting it would cut it loose from the crack."""
    case = make_product("Unit Cost Case")
    box = make_product("Unit Cost Box")
    client.post("/api/v1/purchases", json=purchase_payload(case["id"], quantity=1))
    cracked = client.post(
        "/api/v1/transformations/crack",
        json={"product_id": case["id"], "outputs": [{"product_id": box["id"], "quantity": 6}]},
    )
    assert cracked.status_code == 201, cracked.text
    derived = next(
        entry
        for entry in client.get(f"/api/v1/products/{box['id']}").json()["history"]
        if entry["kind"] == "purchase"
    )

    response = unit_costs(client, derived["id"], ["1.00"] * 6)

    assert response.status_code == 409


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
