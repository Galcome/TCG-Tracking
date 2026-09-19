"""Business overhead: sleeves, show tables, subscriptions.

An expense is money leaving the business with no stock coming back. It moves the paying
account exactly as purchase funding does, and it comes off profit as a period cost - never
off a lot's cost basis, so FIFO and ROI are untouched.
"""

import re
import uuid
from datetime import timedelta

from sqlalchemy import select

from src.auth import get_current_user
from src.main import app
from src.models.member import Member
from src.models.money import _EXPENSE_CATEGORY_CHECK, EXPENSE_CATEGORIES
from tests.test_money_ledger import TODAY, account_named, joint, me, movements, sell

EXPENSES = "/api/v1/money/expenses"


def expense(client, amount="25.00", category="supplies", **extra):
    return client.post(EXPENSES, json={"amount": amount, "category": category, **extra})


def board(client, period="all") -> dict:
    response = client.get("/api/v1/dashboard", params={"period": period})
    assert response.status_code == 200, response.text
    return response.json()


def test_sleeves_from_joint_by_default(client):
    """Two fields - amount and category - and the shared pot paid, dated today."""
    before = board(client)
    response = expense(client, "25.00", notes="  Dragon Shield matte  ")

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["kind"] == "expense"
    assert body["expense_category"] == "supplies"
    assert body["occurred_on"] == TODAY.isoformat()
    assert body["amount"] == "25.00"
    assert body["notes"] == "Dragon Shield matte"
    assert [leg["amount"] for leg in body["legs"]] == ["-25.00"]
    assert joint(client)["balance"] == "-25.00"

    after = board(client)
    assert after["expenses"] == "25.00"
    assert after["net_profit"] == "-25.00"
    assert after["realized_profit"] == before["realized_profit"]
    assert after["expenses_by_category"] == [{"category": "supplies", "amount": "25.00"}]


def test_member_paying_out_of_pocket_is_owed_it(client):
    joint_before = joint(client)["balance"]
    response = expense(
        client, "40.00", "show_fees", paid_from=[{"account_id": me(client)["id"]}]
    )

    assert response.status_code == 201, response.text
    assert me(client)["balance"] == "40.00"
    assert joint(client)["balance"] == joint_before
    assert board(client)["net_profit"] == "-40.00"


def test_store_credit_spends_credit_not_cash(client, make_product):
    product = make_product()
    client.post(
        "/api/v1/purchases",
        json={"product_id": product["id"], "quantity": 1, "amount": "5.00", "funding": []},
    )
    sell(client, product["id"], "50.00", proceeds=[{"store": "Card Shop"}])
    shop = account_named(client, "Card Shop")
    cash_before = board(client)["cash_balance"]

    response = expense(client, "10.00", paid_from=[{"account_id": shop["id"]}])

    assert response.status_code == 201, response.text
    assert account_named(client, "Card Shop")["balance"] == "40.00"
    after = board(client)
    assert after["cash_balance"] == cash_before
    assert after["expenses"] == "10.00"


def test_cash_paid_expenses_come_off_the_cash_balance(client):
    cash_before = int(board(client)["cash_balance"].replace(".", ""))
    expense(client, "12.50")
    assert int(board(client)["cash_balance"].replace(".", "")) == cash_before - 1250


def test_a_split_must_add_up_exactly(client):
    legs = [
        {"account_id": joint(client)["id"], "amount": "10.00"},
        {"account_id": me(client)["id"], "amount": "20.00"},
    ]
    response = expense(client, "30.00", "travel", paid_from=legs)
    assert response.status_code == 201, response.text
    assert sorted(leg["amount"] for leg in response.json()["legs"]) == ["-10.00", "-20.00"]

    legs[1]["amount"] = "19.99"
    uneven = expense(client, "30.00", "travel", paid_from=legs)
    assert uneven.status_code == 422
    assert "adds up to 29.99" in uneven.json()["detail"]


def test_paid_from_rejects_empty_and_unknown_accounts(client):
    assert expense(client, paid_from=[]).status_code == 422
    assert expense(client, paid_from=[{"account_id": str(uuid.uuid4())}]).status_code == 404


def test_voiding_puts_everything_back(client):
    before = board(client)
    created = expense(client, "25.00").json()

    response = client.post(
        f"/api/v1/money/movements/{created['id']}/void", json={"reason": "wrong amount"}
    )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "voided"
    assert joint(client)["balance"] == "0.00"
    after = board(client)
    assert after["net_profit"] == before["net_profit"]
    assert after["expenses"] == "0.00"
    assert after["expenses_by_category"] == []
    listed = movements(client, kind="expense")
    assert [item["status"] for item in listed] == ["voided"]


def test_only_expenses_inside_the_period_count(client):
    expense(client, "5.00", occurred_on=(TODAY - timedelta(days=45)).isoformat())
    expense(client, "7.00", "subscriptions")
    expense(client, "3.00", "subscriptions")

    recent = board(client, "30d")
    assert recent["expenses"] == "10.00"
    assert recent["expenses_by_category"] == [{"category": "subscriptions", "amount": "10.00"}]

    lifetime = board(client)
    assert lifetime["expenses"] == "15.00"
    assert lifetime["expenses_by_category"] == [
        {"category": "subscriptions", "amount": "10.00"},
        {"category": "supplies", "amount": "5.00"},
    ]


def test_net_profit_is_trading_profit_less_overhead(client, make_product):
    product = make_product()
    client.post(
        "/api/v1/purchases",
        json={"product_id": product["id"], "quantity": 1, "amount": "100.00"},
    )
    sell(client, product["id"], "150.00")
    expense(client, "20.00")

    body = board(client)
    assert body["realized_profit"] == "50.00"
    assert body["net_profit"] == "30.00"
    assert body["roi"] == 0.5, "ROI stays trading-only"


def test_filtering_the_ledger_to_expenses(client):
    expense(client)
    client.post(
        "/api/v1/money/transfers",
        json={
            "from_account_id": joint(client)["id"],
            "to_account_id": me(client)["id"],
            "amount": "1.00",
        },
    )
    listed = movements(client, kind="expense")
    assert [item["kind"] for item in listed] == ["expense"]
    assert [item["expense_category"] for item in movements(client, kind="transfer")] == [None]


def test_bad_input_is_refused_with_a_reason(client):
    assert expense(client, "0").status_code == 422
    assert expense(client, "-5.00").status_code == 422
    assert client.post(EXPENSES, json={"amount": "5.00"}).status_code == 422
    assert expense(client, category="snacks").status_code == 422

    vague = expense(client, category="other", notes="   ")
    assert vague.status_code == 422
    assert "note" in vague.text

    tomorrow = (TODAY + timedelta(days=1)).isoformat()
    future = expense(client, occurred_on=tomorrow)
    assert future.status_code == 422
    assert "future" in future.text

    assert expense(client, category="other", notes="Parking").status_code == 201


def test_expenses_need_an_active_member(client, db, claims):
    override = app.dependency_overrides.pop(get_current_user)
    try:
        assert expense(client).status_code == 401
    finally:
        app.dependency_overrides[get_current_user] = override
    expense(client)  # registers the member
    member = db.scalar(select(Member).where(Member.auth_user_id == claims["sub"]))
    member.is_active = False
    db.flush()
    assert expense(client).status_code == 403


def test_the_database_check_lists_exactly_the_categories():
    """The CHECK is written out by hand so no SQL is assembled; this keeps the two in step."""
    assert tuple(re.findall(r"'([a-z_]+)'", _EXPENSE_CATEGORY_CHECK)) == EXPENSE_CATEGORIES
