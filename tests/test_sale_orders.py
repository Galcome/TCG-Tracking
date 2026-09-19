"""Selling several products to one buyer as one transaction.

Each line is an ordinary sale sharing an `order_id`; the order's fees and shipping are
shared across the lines by price, in whole cents that add back to the total exactly.
"""

import uuid

from sqlalchemy import select

from src.models.ledger import Sale
from tests.test_money_ledger import account_named, buy, joint, me, movements

ORDERS = "/api/v1/sales/orders"


def line(product, amount, quantity=1, **extra) -> dict:
    return {"product_id": product["id"], "quantity": quantity, "amount": amount, **extra}


def shelf(client, make_product, *prices):
    """One product per price, each with a single unit bought at that price."""
    products = []
    for index, price in enumerate(prices):
        product = make_product(f"Single {index}")
        buy(client, product["id"], price)
        products.append(product)
    return products


def test_one_order_shares_fees_by_price(client, make_product, db):
    cheap, dear = shelf(client, make_product, "1.00", "50.00")

    response = client.post(
        ORDERS,
        json={
            "lines": [line(cheap, "2.00"), line(dear, "98.00")],
            "platform_fees": "10.00",
            "payment_fees": "0.03",
            "shipping_paid": "5.00",
            "marketplace": "  Show  ",
            "notes": "table 12",
        },
    )

    assert response.status_code == 201, response.text
    body = response.json()
    first, second = body["sales"]
    assert first["platform_fees"] == "0.20"
    assert second["platform_fees"] == "9.80"
    # 3 cents by 2:98 is 0.06 : 2.94 of a cent - the leftover penny goes to the larger part.
    assert [first["payment_fees"], second["payment_fees"]] == ["0.00", "0.03"]
    assert [first["shipping_paid"], second["shipping_paid"]] == ["0.10", "4.90"]
    assert first["realized_profit"] == "0.70"
    assert second["realized_profit"] == "33.27"
    assert {sale["order_id"] for sale in body["sales"]} == {body["order_id"]}
    assert {sale["marketplace"] for sale in body["sales"]} == {"Show"}

    stored = db.scalars(select(Sale).where(Sale.order_id == uuid.UUID(body["order_id"])))
    assert sum(sale.net_proceeds_cents for sale in stored) == 10000 - 1503

    listed = client.get("/api/v1/sales").json()["items"]
    assert {item["order_id"] for item in listed} == {body["order_id"]}


def test_payout_lands_in_one_place(client, make_product):
    a, b = shelf(client, make_product, "1.00", "1.00")
    owed_before = me(client)["balance"]

    response = client.post(
        ORDERS,
        json={
            "lines": [line(a, "10.00"), line(b, "20.00")],
            "platform_fees": "3.00",
            "proceeds": [{"account_id": joint(client)["id"]}],
        },
    )

    assert response.status_code == 201, response.text
    assert joint(client)["balance"] == "27.00"
    assert me(client)["balance"] == owed_before
    assert len(movements(client, kind="proceeds")) == 2


def test_payout_defaults_to_the_seller_and_can_be_store_credit(client, make_product):
    a, b, c = shelf(client, make_product, "1.00", "1.00", "1.00")
    owed_before = int(me(client)["balance"].replace(".", ""))

    client.post(ORDERS, json={"lines": [line(a, "4.00")]})
    assert int(me(client)["balance"].replace(".", "")) == owed_before - 400

    credit = client.post(
        ORDERS,
        json={"lines": [line(b, "5.00"), line(c, "6.00")], "proceeds": [{"store": "Card Shop"}]},
    )
    assert credit.status_code == 201, credit.text
    assert account_named(client, "Card Shop")["balance"] == "11.00"


def test_giveaway_lines_share_fees_by_quantity(client, make_product):
    a, b = shelf(client, make_product, "1.00", "1.00")
    buy(client, b["id"], "1.00")

    response = client.post(
        ORDERS,
        json={"lines": [line(a, "0"), line(b, "0", quantity=2)], "shipping_paid": "0.03"},
    )

    assert response.status_code == 201, response.text
    assert [sale["shipping_paid"] for sale in response.json()["sales"]] == ["0.01", "0.02"]


def test_oversell_refuses_the_whole_order(client, make_product, db):
    stocked, empty = shelf(client, make_product, "1.00", "1.00")
    buy(client, stocked["id"], "1.00")

    body = {"lines": [line(stocked, "5.00", quantity=2), line(empty, "5.00", quantity=2)]}
    refused = client.post(ORDERS, json=body)

    assert refused.status_code == 409
    assert "Only 1 in stock" in refused.text
    assert db.scalars(select(Sale)).all() == []

    allowed = client.post(ORDERS, json={**body, "allow_oversell": True})
    assert allowed.status_code == 201, allowed.text
    assert allowed.json()["sales"][1]["has_unknown_cost"] is True


def test_bad_orders_are_refused(client, make_product):
    (product,) = shelf(client, make_product, "1.00")
    single = [line(product, "5.00")]

    assert client.post(ORDERS, json={"lines": []}).status_code == 422
    assert client.post(ORDERS, json={"lines": single * 2}).status_code == 422
    split = client.post(
        ORDERS,
        json={"lines": single, "proceeds": [{"account_id": joint(client)["id"], "amount": "5"}]},
    )
    assert split.status_code == 422
    two_places = [{"account_id": joint(client)["id"]}, {"account_id": me(client)["id"]}]
    assert client.post(ORDERS, json={"lines": single, "proceeds": two_places}).status_code == 422
    ghost = client.post(ORDERS, json={"lines": [{**single[0], "product_id": str(uuid.uuid4())}]})
    assert ghost.status_code == 404


def test_preview_shows_each_line_and_the_total(client, make_product):
    cheap, dear = shelf(client, make_product, "1.00", "50.00")

    response = client.post(
        f"{ORDERS}/preview",
        json={"lines": [line(cheap, "2.00"), line(dear, "98.00")], "platform_fees": "10.00"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert [item["fees"] for item in body["lines"]] == ["0.20", "9.80"]
    assert [item["product_id"] for item in body["lines"]] == [cheap["id"], dear["id"]]
    assert body["gross"] == "100.00"
    assert body["net_proceeds"] == "90.00"
    assert body["cost_basis"] == "51.00"
    assert body["realized_profit"] == "39.00"
    assert body["exceeds_stock"] is False
    assert client.get("/api/v1/sales").json()["items"] == []


def test_preview_with_unknown_cost_has_no_total_profit(client, make_product):
    (known,) = shelf(client, make_product, "1.00")
    unknown = make_product("Never bought")

    body = client.post(
        f"{ORDERS}/preview", json={"lines": [line(known, "5.00"), line(unknown, "5.00")]}
    ).json()

    assert body["cost_basis"] is None
    assert body["realized_profit"] is None
    assert body["has_unknown_cost"] is True
    assert body["exceeds_stock"] is True

    ghost = client.post(
        f"{ORDERS}/preview",
        json={"lines": [{"product_id": str(uuid.uuid4()), "quantity": 1, "amount": "1"}]},
    )
    assert ghost.status_code == 404
