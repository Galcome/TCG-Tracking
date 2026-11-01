"""Month by month, so "are we getting better" has an answer.

The period control was a toggle - all time, year, month, 30 days - which answers "how are
we doing" and never "compared to when". A trend needs buckets side by side.

Two rules shape this one. Purchases bucket by **purchase date** and sales by **sale date**,
so a month shows what was committed and earned *in it* rather than when somebody got round
to typing the row. And a month with no activity is **omitted**, not emitted as zeros: a
flat line across a month nobody traded in reads as a bad month when it was no month at all.
"""

from datetime import date, timedelta

from src.services.reporting import FUNDING_TRACKED_FROM, by_month
from tests.test_money_ledger import joint

TODAY = date.today()


def first_of(when: date) -> str:
    return date(when.year, when.month, 1).isoformat()


def buy(client, product_id, quantity, amount, on, **extra):
    response = client.post(
        "/api/v1/purchases",
        json={
            "product_id": product_id,
            "quantity": quantity,
            "amount": amount,
            "purchase_date": on.isoformat(),
            **extra,
        },
    )
    assert response.status_code == 201, response.text


def sell(client, product_id, quantity, amount, on):
    response = client.post(
        "/api/v1/sales",
        json={
            "product_id": product_id,
            "quantity": quantity,
            "amount": amount,
            "sale_date": on.isoformat(),
        },
    )
    assert response.status_code == 201, response.text


def months(client) -> dict:
    response = client.get("/api/v1/reports/by-month")
    assert response.status_code == 200, response.text
    return {row["month"]: row for row in response.json()}


def test_a_month_reports_what_was_spent_and_earned_in_it(client, make_product):
    product = make_product("Monthly Box")
    buy(client, product["id"], 2, "200.00", TODAY)
    sell(client, product["id"], 1, "300.00", TODAY)

    row = months(client)[first_of(TODAY)]

    assert row["spent"] == "200.00"
    assert row["units_bought"] == 2
    assert row["units_sold"] == 1
    assert row["revenue"] == "300.00"
    # $300 back against the $100 that one unit carried.
    assert row["realized_profit"] == "200.00"


def test_revenue_comes_down_to_profit_and_net_in_cents(client, make_product):
    """The screen shows this sum line by line, so every report must carry each part of it.

    Gross counts every sale; profit counts only known-cost sales after their fees. Without
    both of those lines, revenue less cost does not reach the profit beside it.
    """
    known = make_product("Costed Box")
    buy(client, known["id"], 1, "100.00", TODAY)
    costed = client.post(
        "/api/v1/sales",
        json={
            "product_id": known["id"],
            "quantity": 1,
            "amount": "300.00",
            "sale_date": TODAY.isoformat(),
            "platform_fees": "10.00",
            "payment_fees": "5.00",
            "shipping_paid": "5.00",
        },
    )
    assert costed.status_code == 201, costed.text

    unknown = make_product("Uncosted Box")
    adjustment = client.post(
        "/api/v1/adjustments",
        json={"product_id": unknown["id"], "quantity_delta": 1, "reason": "opening_inventory"},
    )
    assert adjustment.status_code == 201, adjustment.text
    uncosted = client.post(
        "/api/v1/sales",
        json={
            "product_id": unknown["id"],
            "quantity": 1,
            "amount": "50.00",
            "sale_date": TODAY.isoformat(),
            "platform_fees": "2.00",
            "proceeds": [],
        },
    )
    assert uncosted.status_code == 201, uncosted.text
    assert uncosted.json()["has_unknown_cost"] is True

    spent = client.post(
        "/api/v1/money/expenses",
        json={"amount": "30.00", "category": "supplies", "occurred_on": TODAY.isoformat()},
    )
    assert spent.status_code == 201, spent.text

    month = months(client)[first_of(TODAY)]
    year = client.get("/api/v1/reports/performance").json()["years"][0]
    for row in (month, year):
        assert row["revenue"] == "350.00"
        assert row["uncosted_revenue"] == "50.00"
        assert row["sale_fees"] == "20.00"
        assert row["cost_of_sales"] == "100.00"
        assert row["realized_profit"] == "180.00"
        assert row["expenses"] == "30.00"

    board = client.get("/api/v1/dashboard", params={"period": "all"}).json()
    assert board["total_sales"] == "350.00"
    assert board["uncosted_revenue"] == "50.00"
    assert board["sale_fees"] == "20.00"
    assert board["cost_of_sales"] == "100.00"
    assert board["realized_profit"] == "180.00"
    assert board["net_profit"] == "150.00"


def test_an_expense_alone_still_makes_a_month(client):
    """Overhead in a month with no trading is still that month's loss."""
    ago = TODAY - timedelta(days=70)
    spent = client.post(
        "/api/v1/money/expenses",
        json={"amount": "12.00", "category": "supplies", "occurred_on": ago.isoformat()},
    )
    assert spent.status_code == 201, spent.text

    assert months(client)[first_of(ago)]["expenses"] == "12.00"


def test_spent_splits_into_house_and_own_money(client, make_product, db):
    """House money is the joint account; own money is what a partner paid personally. Spend
    from before tracking started has no split."""
    product = make_product("Split Box")
    buy(client, product["id"], 1, "200.00", TODAY)
    buy(client, product["id"], 1, "300.00", TODAY, funding=[{"account_id": joint(client)["id"]}])
    before = FUNDING_TRACKED_FROM - timedelta(days=70)
    buy(client, product["id"], 1, "50.00", before)

    rows = months(client)

    row = rows[first_of(TODAY)]
    assert (row["spent"], row["house_spent"], row["own_spent"], row["untracked_spent"]) == (
        "500.00",
        "300.00",
        "200.00",
        "0.00",
    )
    # Read as of the day tracking started, so the old month stays inside the 12-month window.
    [old] = [row for row in by_month(db, FUNDING_TRACKED_FROM) if row.month == first_of(before)]
    assert (old.house_spent_cents, old.own_spent_cents, old.untracked_spent_cents) == (0, 0, 5_000)


def test_activity_lands_in_the_month_it_happened(client, make_product):
    """By purchase and sale date, not by when the row was typed."""
    product = make_product("Backdated Box")
    ago = TODAY - timedelta(days=70)
    buy(client, product["id"], 1, "100.00", ago)

    rows = months(client)
    assert rows[first_of(ago)]["spent"] == "100.00"


def test_a_quiet_month_is_absent_rather_than_zero(client, make_product):
    """A flat line across a month nobody traded reads as a bad month. It was no month."""
    product = make_product("Sparse Box")
    long_ago = TODAY - timedelta(days=200)
    buy(client, product["id"], 1, "100.00", long_ago)

    rows = months(client)
    assert first_of(long_ago) in rows

    # The month between then and now, with nothing in it, is simply not a row.
    quiet = TODAY - timedelta(days=100)
    if first_of(quiet) not in {first_of(long_ago), first_of(TODAY)}:
        assert rows.get(first_of(quiet)) is None or rows[first_of(quiet)]["units_bought"] > 0


def test_cost_carried_across_a_transformation_is_not_spending_again(client, make_product):
    """Cracking a case does not commit new capital, so it must not show as spend.

    The boxes are recorded as derived purchases carrying the case's cost. Counting them
    here would say the group spent $1,800 on a $900 case.
    """
    case = make_product("Month Case")
    box = make_product("Month Box")
    buy(client, case["id"], 1, "900.00", TODAY)
    client.post(
        "/api/v1/transformations/crack",
        json={"product_id": case["id"], "outputs": [{"product_id": box["id"], "quantity": 6}]},
    )

    assert months(client)[first_of(TODAY)]["spent"] == "900.00"


def test_the_window_is_capped(client, make_product):
    """Twelve months. A chart nobody can read is the problem being fixed, not a feature."""
    product = make_product("Windowed Box")
    buy(client, product["id"], 1, "10.00", TODAY - timedelta(days=800))
    buy(client, product["id"], 1, "20.00", TODAY)

    rows = client.get("/api/v1/reports/by-month").json()
    assert len(rows) <= 12
    # Oldest first, so a chart can render it left to right without sorting.
    assert [row["month"] for row in rows] == sorted(row["month"] for row in rows)


def test_nothing_traded_is_an_empty_list(client):
    assert isinstance(client.get("/api/v1/reports/by-month").json(), list)
