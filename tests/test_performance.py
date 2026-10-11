"""The dashboard's charts: value over time, who paid for the stock, and year by year."""

from datetime import date, timedelta

from sqlalchemy import select

from src.auth import get_current_user
from src.main import app
from src.models.ledger import Purchase
from src.models.portfolio import PortfolioSnapshot
from src.services import ledger, reporting
from tests.test_money_ledger import joint, me

PERFORMANCE = "/api/v1/reports/performance"
TODAY = date.today()


def performance(client) -> dict:
    response = client.get(PERFORMANCE)
    assert response.status_code == 200, response.text
    return response.json()


def buy(client, product_id, amount, on=TODAY, **extra) -> dict:
    response = client.post(
        "/api/v1/purchases",
        json={
            "product_id": product_id,
            "quantity": 1,
            "amount": amount,
            "purchase_date": on.isoformat(),
            **extra,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def sell(client, product_id, amount, on=TODAY, **extra) -> dict:
    response = client.post(
        "/api/v1/sales",
        json={
            "product_id": product_id,
            "quantity": 1,
            "amount": amount,
            "sale_date": on.isoformat(),
            **extra,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def opening_stock(db, product_id, cents) -> None:
    """A purchase as the import writes one: no date and no money record."""
    db.add(Purchase(product_id=product_id, quantity=1, gross_amount_cents=cents))
    db.flush()
    ledger.recompute_product(db, product_id)


def value(client, product_id, amount):
    response = client.post(
        "/api/v1/valuations",
        json={"product_id": product_id, "value": amount, "captured_on": TODAY.isoformat()},
    )
    assert response.status_code == 201, response.text


# ------------------------------------------------------------------ who paid for it


def test_an_empty_store_reports_zeroes(client):
    body = performance(client)

    assert body["personal_money"] == "0.00"
    assert body["from_sales"] == "0.00"
    assert body["years"] == []
    assert [point["market_value"] for point in body["value_history"]] == ["0.00"]


def test_stock_bought_with_a_partners_card_is_personal_money(client, make_product):
    buy(client, make_product()["id"], "200.00")

    body = performance(client)

    assert body["stock_at_cost"] == "200.00"
    assert body["personal_money"] == "200.00"
    assert body["from_sales"] == "0.00"


def test_a_buy_in_is_personal_money_held_as_cash(client):
    member_id = client.get("/api/v1/members/me").json()["id"]
    client.post("/api/v1/money/contributions", json={"member_id": member_id, "amount": "500.00"})

    body = performance(client)

    assert body["cash"] == "500.00"
    assert body["personal_money"] == "500.00"
    assert body["from_sales"] == "0.00"


def test_stock_with_no_money_record_was_paid_for_by_sales(client, make_product, db):
    """The opening stock: bought with earlier takings, before the app existed."""
    opening_stock(db, make_product()["id"], 90_000)

    body = performance(client)

    assert body["personal_money"] == "0.00"
    assert body["from_sales"] == "900.00"


def test_profit_kept_and_spent_again_counts_as_sales_money(client, make_product):
    """$100 of my money buys a card, it sells for $300 into the joint account, and that $300
    buys the next one. Only the first $100 was anyone's own money."""
    first = make_product()
    buy(client, first["id"], "100.00")
    sell(client, first["id"], "300.00", proceeds=[{"account_id": joint(client)["id"]}])
    buy(client, make_product()["id"], "300.00", funding=[{"account_id": joint(client)["id"]}])

    body = performance(client)

    assert body["stock_at_cost"] == "300.00"
    assert body["cash"] == "0.00"
    assert body["personal_money"] == "100.00"
    assert body["from_sales"] == "200.00"


def test_paying_a_partner_back_takes_their_money_out(client, make_product):
    buy(client, make_product()["id"], "200.00")
    client.post(
        "/api/v1/money/adjustments", json={"account_id": me(client)["id"], "target": 0}
    )

    assert performance(client)["personal_money"] == "0.00"


def test_store_credit_is_held_value(client, make_product):
    product = make_product()
    buy(client, product["id"], "50.00", funding=[])
    sell(client, product["id"], "80.00", proceeds=[{"store": "Vintage Cards"}])

    body = performance(client)

    assert body["store_credit"] == "80.00"
    assert body["from_sales"] == "80.00"


def test_hidden_stock_still_counts_toward_what_was_paid_for(client, make_product):
    product = make_product()
    buy(client, product["id"], "70.00", funding=[])
    client.patch(f"/api/v1/products/{product['id']}", json={"is_hidden": True})

    assert performance(client)["stock_at_cost"] == "70.00"


# ------------------------------------------------------------------ value over time


def test_today_is_always_the_live_figure(client, make_product, db):
    product = make_product()
    buy(client, product["id"], "40.00")
    value(client, product["id"], "65.00")
    # A stale row for today, as if the job had run before the valuation was typed.
    db.add(PortfolioSnapshot(captured_on=TODAY, market_value_cents=1, priced_cost_cents=1))
    db.flush()

    history = performance(client)["value_history"]

    assert history == [
        {"captured_on": TODAY.isoformat(), "market_value": "65.00", "priced_cost": "40.00"}
    ]


def test_history_is_oldest_first_and_a_year_long(client, db):
    for days_ago, cents in ((400, 1), (30, 20_000), (2, 30_000)):
        db.add(
            PortfolioSnapshot(
                captured_on=TODAY - timedelta(days=days_ago),
                market_value_cents=cents,
                priced_cost_cents=cents // 2,
            )
        )
    db.flush()

    history = performance(client)["value_history"]

    assert [point["market_value"] for point in history] == ["200.00", "300.00", "0.00"]
    assert history[0]["captured_on"] == (TODAY - timedelta(days=30)).isoformat()


def test_recording_writes_one_row_per_day(client, make_product, db):
    product = make_product()
    buy(client, product["id"], "40.00")
    value(client, product["id"], "65.00")

    reporting.record_portfolio(db, today=TODAY)
    value(client, product["id"], "80.00")
    row = reporting.record_portfolio(db, today=TODAY)

    rows = db.scalars(select(PortfolioSnapshot)).all()
    assert rows == [row]
    assert (row.market_value_cents, row.priced_cost_cents) == (8_000, 4_000)


# ------------------------------------------------------------------ year by year


def test_years_are_newest_first_with_undated_last(client, make_product, db):
    last_year = date(TODAY.year - 1, 6, 1)
    old = make_product()
    buy(client, old["id"], "100.00", on=last_year)
    sell(client, old["id"], "150.00", on=last_year)
    opening_stock(db, make_product()["id"], 90_000)
    current = make_product()
    buy(client, current["id"], "40.00")
    sell(client, current["id"], "25.00")
    client.post("/api/v1/money/expenses", json={"amount": "5.00", "category": "supplies"})

    years = performance(client)["years"]

    assert years == [
        {
            "year": TODAY.year,
            "spent": "40.00",
            "revenue": "25.00",
            "realized_profit": "-15.00",
            "expenses": "5.00",
        },
        {
            "year": TODAY.year - 1,
            "spent": "100.00",
            "revenue": "150.00",
            "realized_profit": "50.00",
            "expenses": "0.00",
        },
        {
            "year": None,
            "spent": "900.00",
            "revenue": "0.00",
            "realized_profit": "0.00",
            "expenses": "0.00",
        },
    ]


def test_carried_cost_is_not_spent_twice_but_grading_fees_are(db, make_product):
    """Derived purchases move cost across a transformation; only their add-ons are new."""
    product_id = make_product()["id"]
    db.add_all(
        [
            Purchase(
                product_id=product_id,
                quantity=1,
                gross_amount_cents=10_000,
                fees_cents=2_500,
                purchase_date=TODAY,
                is_derived=True,
            )
        ]
    )
    db.flush()

    assert reporting.by_year(db)[0].spent_cents == 2_500


def test_performance_needs_a_member(client):
    override = app.dependency_overrides.pop(get_current_user)
    try:
        assert client.get(PERFORMANCE).status_code == 401
    finally:
        app.dependency_overrides[get_current_user] = override
