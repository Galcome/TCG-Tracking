"""Tests for the sale dry-run.

The live-math panel in the record-sale form is only trustworthy if it runs the same
engine the real write does, so these assert the preview and the resulting sale agree.
"""

import uuid
from datetime import date, timedelta

TODAY = date.today()


def buy(client, product_id, quantity, amount, on=None):
    return client.post(
        "/api/v1/purchases",
        json={
            "product_id": product_id,
            "quantity": quantity,
            "amount": amount,
            "purchase_date": (on or TODAY).isoformat(),
        },
    ).json()


def preview(client, product_id, **overrides):
    response = client.post(
        "/api/v1/sales/preview",
        json={"product_id": product_id, "quantity": 1, "amount": "200.00", **overrides},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_preview_reports_fifo_cost_for_those_units(client, make_product):
    """2 @ $150 then 3 @ $180; selling 3 costs 2x150 + 1x180 = $480."""
    product = make_product()
    buy(client, product["id"], 2, "300.00", TODAY - timedelta(days=20))
    buy(client, product["id"], 3, "540.00", TODAY - timedelta(days=10))

    body = preview(client, product["id"], quantity=3, amount="600.00")

    assert body["cost_basis"] == "480.00"
    assert body["net_proceeds"] == "600.00"
    assert body["realized_profit"] == "120.00"
    assert body["roi"] == 0.25


def test_preview_subtracts_every_fee(client, make_product):
    product = make_product()
    buy(client, product["id"], 1, "100.00")

    body = preview(
        client,
        product["id"],
        amount="200.00",
        platform_fees="10.00",
        payment_fees="5.00",
        shipping_paid="15.00",
    )

    assert body["fees"] == "30.00"
    assert body["net_proceeds"] == "170.00"
    assert body["realized_profit"] == "70.00"


def test_preview_writes_nothing(client, make_product):
    product = make_product()
    buy(client, product["id"], 2, "200.00")

    preview(client, product["id"], quantity=2, amount="500.00")

    detail = client.get(f"/api/v1/products/{product['id']}").json()
    assert detail["stats"]["quantity_on_hand"] == 2, "stock untouched"
    assert detail["stats"]["sale_count"] == 0
    assert len(detail["history"]) == 1, "only the purchase"


def test_preview_shows_what_would_be_left(client, make_product):
    product = make_product()
    buy(client, product["id"], 5, "500.00")

    body = preview(client, product["id"], quantity=2, amount="300.00")

    assert body["quantity_available"] == 5
    assert body["quantity_remaining"] == 3
    assert body["remaining_cost"] == "300.00"
    assert body["exceeds_stock"] is False


def test_preview_flags_an_oversell_without_refusing(client, make_product):
    """The form needs to show the consequence before the user decides to override."""
    product = make_product()
    buy(client, product["id"], 1, "100.00")

    body = preview(client, product["id"], quantity=3, amount="600.00")

    assert body["exceeds_stock"] is True
    assert body["quantity_remaining"] == -2
    assert body["has_unknown_cost"] is True
    assert body["cost_basis"] is None, "unknown, never zero"
    assert body["realized_profit"] is None
    assert body["roi"] is None


def test_preview_with_no_stock_at_all(client, make_product):
    product = make_product()
    body = preview(client, product["id"])

    assert body["quantity_available"] == 0
    assert body["has_unknown_cost"] is True
    assert body["cost_basis"] is None


def test_preview_matches_the_sale_it_predicts(client, make_product):
    """The whole point: what the panel promised is what gets recorded."""
    product = make_product()
    buy(client, product["id"], 2, "300.00", TODAY - timedelta(days=20))
    buy(client, product["id"], 3, "540.00", TODAY - timedelta(days=10))

    predicted = preview(
        client, product["id"], quantity=3, amount="600.00", platform_fees="50.00"
    )
    actual = client.post(
        "/api/v1/sales",
        json={
            "product_id": product["id"],
            "quantity": 3,
            "amount": "600.00",
            "platform_fees": "50.00",
            "sale_date": TODAY.isoformat(),
        },
    ).json()

    assert predicted["cost_basis"] == actual["cost_basis"]
    assert predicted["net_proceeds"] == actual["net_proceeds"]
    assert predicted["realized_profit"] == actual["realized_profit"]


def test_preview_accounts_for_sales_already_recorded(client, make_product):
    """A second sale must draw on what the first one left, not the original stock."""
    product = make_product()
    buy(client, product["id"], 2, "300.00", TODAY - timedelta(days=20))
    buy(client, product["id"], 3, "540.00", TODAY - timedelta(days=10))
    client.post(
        "/api/v1/sales",
        json={
            "product_id": product["id"],
            "quantity": 2,
            "amount": "400.00",
            "sale_date": TODAY.isoformat(),
        },
    )

    body = preview(client, product["id"], quantity=1, amount="200.00")

    assert body["quantity_available"] == 3
    assert body["cost_basis"] == "180.00", "the cheap lot is gone; this comes from the $180 lot"


def test_a_back_dated_preview_uses_the_stock_of_that_day(client, make_product):
    product = make_product()
    buy(client, product["id"], 1, "100.00", TODAY - timedelta(days=100))
    buy(client, product["id"], 1, "500.00", TODAY - timedelta(days=1))

    recent = preview(client, product["id"], quantity=1, amount="200.00")
    backdated = preview(
        client,
        product["id"],
        quantity=1,
        amount="200.00",
        sale_date=(TODAY - timedelta(days=50)).isoformat(),
    )

    assert recent["cost_basis"] == "100.00"
    assert backdated["cost_basis"] == "100.00", "the older lot funds it either way"


def test_preview_rejects_a_missing_product(client):
    response = client.post(
        "/api/v1/sales/preview",
        json={"product_id": str(uuid.uuid4()), "quantity": 1, "amount": "10.00"},
    )
    assert response.status_code == 404


def test_preview_validates_its_input(client, make_product):
    product = make_product()
    for bad in ({"quantity": 0}, {"amount": "-5.00"}, {"amount": "1.234"}):
        response = client.post(
            "/api/v1/sales/preview",
            json={"product_id": product["id"], "quantity": 1, "amount": "10.00", **bad},
        )
        assert response.status_code == 422, bad


def test_preview_defaults_the_amount_to_zero(client, make_product):
    """The panel is live as the user types, so an empty amount box must not 422."""
    product = make_product()
    buy(client, product["id"], 1, "100.00")

    response = client.post(
        "/api/v1/sales/preview", json={"product_id": product["id"], "quantity": 1}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["gross"] == "0.00"
    assert body["realized_profit"] == "-100.00", "selling for nothing is a real loss"
