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

BEFORE_TRACKING = reporting.FUNDING_TRACKED_FROM - timedelta(days=1)


def transfer(client, source, destination, amount) -> None:
    response = client.post(
        "/api/v1/money/transfers",
        json={"from_account_id": source, "to_account_id": destination, "amount": amount},
    )
    assert response.status_code == 201, response.text


def test_an_empty_store_reports_zeroes(client):
    body = performance(client)

    assert body["tracked_from"] == reporting.FUNDING_TRACKED_FROM.isoformat()
    assert body["own_money"] == "0.00"
    assert body["house_money"] == "0.00"
    assert body["years"] == []
    assert [point["market_value"] for point in body["value_history"]] == ["0.00"]


def test_stock_paid_personally_is_own_money(client, make_product):
    buy(client, make_product()["id"], "200.00")

    body = performance(client)

    assert body["own_money"] == "200.00"
    assert body["house_money"] == "0.00"


def test_stock_paid_from_joint_or_store_credit_is_house_money(client, make_product):
    """Sales money going back into stock: reinvested, not lost."""
    product = make_product()
    buy(client, product["id"], "20.00", funding=[])
    sell(client, product["id"], "80.00", proceeds=[{"store": "Vintage Cards"}])
    credit = next(
        item
        for item in client.get("/api/v1/money/accounts").json()["items"]
        if item["kind"] == "store_credit"
    )
    buy(client, make_product()["id"], "300.00", funding=[{"account_id": joint(client)["id"]}])
    buy(client, make_product()["id"], "50.00", funding=[{"account_id": credit["id"]}])

    body = performance(client)

    assert body["own_money"] == "0.00"
    assert body["house_money"] == "350.00"


def test_paying_a_partner_back_turns_their_money_into_house_money(client, make_product):
    buy(client, make_product()["id"], "200.00")
    transfer(client, joint(client)["id"], me(client)["id"], "150.00")

    body = performance(client)

    assert body["own_money"] == "50.00"
    assert body["house_money"] == "150.00"


def test_cash_a_partner_puts_in_and_spends_from_joint_stays_their_money(client, make_product):
    transfer(client, me(client)["id"], joint(client)["id"], "100.00")
    buy(client, make_product()["id"], "100.00", funding=[{"account_id": joint(client)["id"]}])

    body = performance(client)

    assert body["own_money"] == "100.00"
    assert body["house_money"] == "0.00"


def test_paying_back_old_debt_never_makes_own_money_negative(client, make_product):
    buy(client, make_product()["id"], "500.00", on=BEFORE_TRACKING)
    buy(client, make_product()["id"], "100.00")
    transfer(client, joint(client)["id"], me(client)["id"], "500.00")

    body = performance(client)

    assert body["own_money"] == "0.00"
    assert body["house_money"] == "100.00"


def test_cash_put_in_but_not_spent_is_not_stock(client):
    transfer(client, me(client)["id"], joint(client)["id"], "100.00")

    body = performance(client)

    assert body["own_money"] == "0.00"
    assert body["house_money"] == "0.00"


def test_history_before_tracking_and_voided_buys_are_left_out(client, make_product, db):
    opening_stock(db, make_product()["id"], 90_000)
    buy(client, make_product()["id"], "400.00", on=BEFORE_TRACKING)
    voided = buy(client, make_product()["id"], "60.00")
    client.post(f"/api/v1/purchases/{voided['id']}/void", json={"reason": "typo"})

    body = performance(client)

    assert body["own_money"] == "0.00"
    assert body["house_money"] == "0.00"


def split(db) -> list[tuple[date, int, int]]:
    return [(day.on, day.own_cents, day.house_cents) for day in reporting.funded_days(db)]


def test_a_payback_turns_the_oldest_own_money_into_house_money_first(client, make_product, db):
    first = reporting.FUNDING_TRACKED_FROM
    second = first + timedelta(days=1)
    buy(client, make_product()["id"], "100.00", on=first)
    buy(client, make_product()["id"], "200.00", on=second)
    transfer(client, joint(client)["id"], me(client)["id"], "150.00")

    assert split(db) == [(first, 0, 10_000), (second, 15_000, 5_000)]


def test_cash_put_in_turns_the_oldest_house_money_into_own_money_first(client, make_product, db):
    first = reporting.FUNDING_TRACKED_FROM
    second = first + timedelta(days=1)
    transfer(client, me(client)["id"], joint(client)["id"], "50.00")
    funding = [{"account_id": joint(client)["id"]}]
    buy(client, make_product()["id"], "100.00", on=first, funding=funding)
    buy(client, make_product()["id"], "100.00", on=second, funding=funding)

    assert split(db) == [(first, 5_000, 5_000), (second, 0, 10_000)]


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
    buy(client, current["id"], "60.00", funding=[{"account_id": joint(client)["id"]}])
    sell(client, current["id"], "25.00")
    client.post("/api/v1/money/expenses", json={"amount": "5.00", "category": "supplies"})

    years = performance(client)["years"]

    assert years == [
        {
            "year": TODAY.year,
            "spent": "100.00",
            "house_spent": "60.00",
            "own_spent": "40.00",
            "untracked_spent": "0.00",
            "revenue": "25.00",
            "uncosted_revenue": "0.00",
            "sale_fees": "0.00",
            "cost_of_sales": "40.00",
            "realized_profit": "-15.00",
            "expenses": "5.00",
        },
        {
            "year": TODAY.year - 1,
            "spent": "100.00",
            "house_spent": "0.00",
            "own_spent": "0.00",
            "untracked_spent": "100.00",
            "revenue": "150.00",
            "uncosted_revenue": "0.00",
            "sale_fees": "0.00",
            "cost_of_sales": "100.00",
            "realized_profit": "50.00",
            "expenses": "0.00",
        },
        {
            "year": None,
            "spent": "900.00",
            "house_spent": "0.00",
            "own_spent": "0.00",
            "untracked_spent": "900.00",
            "revenue": "0.00",
            "uncosted_revenue": "0.00",
            "sale_fees": "0.00",
            "cost_of_sales": "0.00",
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
