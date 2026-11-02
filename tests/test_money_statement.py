"""Why an account's balance is what it is.

A partner owed $374.73 has to be able to see where that number came from without a
spreadsheet beside the app: every purchase and expense they paid for adds to it, every
payback and every sale they kept the cash from takes it away, and the lines add up to the
figure on their card.
"""

import uuid

from tests.test_money_ledger import buy, joint, me, sell

TRANSFERS = "/api/v1/money/transfers"


def statement(client, account_id: str) -> dict:
    response = client.get(f"/api/v1/money/accounts/{account_id}/statement")
    assert response.status_code == 200, response.text
    return response.json()


def test_a_partner_statement_adds_up_to_what_they_are_owed(client, make_product):
    product = make_product("Statement Box")
    buy(client, product["id"], "361.49", purchase_date="2026-10-01")
    bad = buy(client, product["id"], "500.00", purchase_date="2026-10-02")
    voided = client.post(f"/api/v1/purchases/{bad['id']}/void", json={"reason": "never happened"})
    assert voided.status_code == 200, voided.text
    expense = client.post(
        "/api/v1/money/expenses",
        json={
            "amount": "75.18",
            "category": "shipping_supplies",
            "occurred_on": "2026-10-03",
            "paid_from": [{"account_id": me(client)["id"]}],
        },
    )
    assert expense.status_code == 201, expense.text
    sell(client, product["id"], "335.00", sale_date="2026-10-04")
    payback = client.post(
        TRANSFERS,
        json={
            "from_account_id": joint(client)["id"],
            "to_account_id": me(client)["id"],
            "amount": "100.00",
            "occurred_on": "2026-10-05",
        },
    )
    assert payback.status_code == 201, payback.text

    mine = me(client)
    result = statement(client, mine["id"])

    # Newest first; the voided purchase changed nothing, so it is not a line.
    lines = [(row["movement"]["kind"], row["change"], row["balance"]) for row in result["items"]]
    assert lines == [
        ("transfer", "-100.00", "1.67"),
        ("proceeds", "-335.00", "101.67"),
        ("expense", "75.18", "436.67"),
        ("funding", "361.49", "361.49"),
    ]
    assert result["balance"] == mine["balance"] == "1.67"


def test_the_joint_account_statement_is_cash_in_and_out(client, make_product):
    product = make_product("Joint Statement Box")
    buy(client, product["id"], "40.00", funding=[{"account_id": joint(client)["id"]}])

    result = statement(client, joint(client)["id"])

    assert [line["change"] for line in result["items"]] == ["-40.00"]
    assert result["balance"] == joint(client)["balance"] == "-40.00"


def test_an_account_nothing_touched_has_an_empty_statement(client):
    result = statement(client, me(client)["id"])
    assert result == {"account_id": me(client)["id"], "balance": "0.00", "items": []}


def test_a_statement_for_an_unknown_account_is_a_404(client):
    response = client.get(f"/api/v1/money/accounts/{uuid.uuid4()}/statement")
    assert response.status_code == 404
