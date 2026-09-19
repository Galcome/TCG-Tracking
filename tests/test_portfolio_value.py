"""Home's "what is it worth": market value of priced stock against that stock's cost.

Only units with a usable quote count, and their FIFO cost is the comparison, so a shelf
that is half priced never reads as a loss (unpriced at zero) or as a guess (unpriced at
cost). Coverage is reported alongside so the figure is never mistaken for the whole shelf.
"""

import uuid
from datetime import date, timedelta

from src.models.catalog import CatalogMapping
from src.models.market_price import CurrentMarketQuote
from tests.test_money_ledger import sell
from tests.test_pricing_api import mapping_payload


def stock(client, make_product, name, quantity, amount):
    product = make_product(name)
    response = client.post(
        "/api/v1/purchases",
        json={"product_id": product["id"], "quantity": quantity, "amount": amount},
    )
    assert response.status_code == 201, response.text
    return product


def quote(client, db, product, external_id, cents, status="fresh", as_of=None):
    created = client.post(
        "/api/v1/pricing/mappings",
        json=mapping_payload(product["id"], external_product_id=external_id),
    )
    assert created.status_code == 201, created.text
    mapping = db.get(CatalogMapping, uuid.UUID(created.json()["id"]))
    db.add(
        CurrentMarketQuote(
            mapping_id=mapping.id,
            product_id=mapping.product_id,
            status=status,
            cad_value_cents=cents,
            source_as_of=as_of or date.today(),
        )
    )
    db.flush()


def test_value_covers_priced_units_only_and_compares_their_own_cost(client, db, make_product):
    rising = stock(client, make_product, "Rising Box", 2, "60.00")
    quote(client, db, rising, "1", 4500)
    old = stock(client, make_product, "Old Quote Box", 1, "20.00")
    quote(client, db, old, "2", 1000, as_of=date.today() - timedelta(days=60))
    stock(client, make_product, "Unpriced Packs", 3, "15.00")
    missing = stock(client, make_product, "Unavailable Box", 1, "9.00")
    quote(client, db, missing, "3", None, status="unavailable")
    gone = stock(client, make_product, "Sold Out Box", 1, "5.00")
    quote(client, db, gone, "4", 99999)
    sell(client, gone["id"], "6.00")

    body = client.get("/api/v1/dashboard").json()

    assert body["units_in_stock"] == 7
    assert body["priced_units"] == 3
    assert body["stale_units"] == 1
    assert body["market_value"] == "100.00"
    assert body["priced_cost"] == "80.00"
    assert body["unrealized_gain"] == "20.00"
    assert body["inventory_at_cost"] == "104.00"


def test_an_unpriced_shelf_reports_nothing_rather_than_a_loss(client, make_product):
    stock(client, make_product, "Plain Box", 2, "50.00")
    body = client.get("/api/v1/dashboard").json()
    assert (body["priced_units"], body["market_value"], body["unrealized_gain"]) == (
        0,
        "0.00",
        "0.00",
    )


def test_value_is_as_of_now_whatever_the_period(client, db, make_product):
    box = stock(client, make_product, "Period Box", 1, "10.00")
    quote(client, db, box, "5", 800)
    for period in ("all", "30d"):
        body = client.get("/api/v1/dashboard", params={"period": period}).json()
        assert body["unrealized_gain"] == "-2.00"
