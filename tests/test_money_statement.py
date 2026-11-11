"""Why an account's balance is what it is, and paying it off.

A partner owed $374.73 has to be able to see where that number came from without a
spreadsheet beside the app. The statement lists only what is still in the balance, and the
lines add up to the figure on their card. Once something is paid back it leaves the
statement; its row in the movements list notes when and from where it was paid back.
"""

import uuid

from tests.test_money_ledger import TODAY, buy, joint, me, movements, sell
from tests.test_money_open_items import open_items, pay_back, settle, two_open_rows, void_movement

TRANSFERS = "/api/v1/money/transfers"


def statement(client, account_id: str) -> dict:
    response = client.get(f"/api/v1/money/accounts/{account_id}/statement")
    assert response.status_code == 200, response.text
    return response.json()


def lines(client, account_id: str) -> list[tuple[str, str, str]]:
    return [
        (row["movement"]["id"], row["change"], row["balance"])
        for row in statement(client, account_id)["items"]
    ]


def pay_back_all(client, account_id: str, from_account_id: str):
    return client.post(
        f"/api/v1/money/accounts/{account_id}/pay-back",
        json={"from_account_id": from_account_id, "occurred_on": "2026-03-01"},
    )


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

    # The sale cash and the payback took the purchase and most of the expense off what is
    # owed, so all that is left is the newest $1.67 of the expense. The rest is history.
    shown = [(row["movement"]["kind"], row["change"], row["balance"]) for row in result["items"]]
    assert shown == [("expense", "1.67", "1.67")]
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


def test_a_paid_back_purchase_leaves_the_statement(client, make_product):
    older, newer = two_open_rows(client, make_product)

    settle(client, newer["movement"]["id"], "200.00")

    assert lines(client, me(client)["id"]) == [(older["movement"]["id"], "100.00", "100.00")]


def test_a_part_paid_purchase_shows_only_what_is_left_on_it(client, make_product):
    older, newer = two_open_rows(client, make_product)

    settle(client, newer["movement"]["id"], "50.00")

    assert lines(client, me(client)["id"]) == [
        (newer["movement"]["id"], "150.00", "250.00"),
        (older["movement"]["id"], "100.00", "100.00"),
    ]


def test_money_with_no_row_takes_the_oldest_lines_off_first(client, make_product):
    _, newer = two_open_rows(client, make_product)

    pay_back(client, "150.00")

    # $150 clears the $100 row and $50 of the $200 one, so what is left is all the newer row.
    assert lines(client, me(client)["id"]) == [(newer["movement"]["id"], "150.00", "150.00")]


def test_a_settled_partner_has_an_empty_statement(client, make_product):
    two_open_rows(client, make_product)
    pay_back(client, "300.00")

    result = statement(client, me(client)["id"])

    assert result["balance"] == "0.00"
    assert result["items"] == []


def test_a_partner_holding_sale_cash_sees_the_sale_that_left_it(client, make_product):
    product = make_product()
    buy(client, product["id"], "100.00", purchase_date="2026-01-01")
    sale = sell(client, product["id"], "300.00", sale_date="2026-02-01")

    [line] = statement(client, me(client)["id"])["items"]

    assert line["movement"]["sale_id"] == sale["id"]
    assert (line["change"], line["balance"]) == ("-200.00", "-200.00")
    assert me(client)["balance"] == "-200.00"


def test_a_movement_notes_when_and_where_it_was_paid_back(client, make_product):
    older, newer = two_open_rows(client, make_product)
    payback = settle(client, newer["movement"]["id"], "200.00")

    funding = {row["id"]: row for row in movements(client, kind="funding")}

    assert funding[newer["movement"]["id"]]["paid_back"] == [
        {
            "movement_id": payback["id"],
            "occurred_on": TODAY.isoformat(),
            "from_account_name": joint(client)["name"],
            "to_account_name": me(client)["name"],
            "amount": "200.00",
        }
    ]
    assert funding[older["movement"]["id"]]["paid_back"] == []

    void_movement(client, payback["id"])

    funding = {row["id"]: row for row in movements(client, kind="funding")}
    assert funding[newer["movement"]["id"]]["paid_back"] == []


def test_paying_back_everything_settles_each_item_on_its_own(client, make_product):
    older, newer = two_open_rows(client, make_product)
    expense = client.post(
        "/api/v1/money/expenses",
        json={
            "amount": "75.18",
            "category": "shipping_supplies",
            "occurred_on": "2026-02-15",
            "paid_from": [{"account_id": me(client)["id"]}],
        },
    )
    assert expense.status_code == 201, expense.text

    response = pay_back_all(client, me(client)["id"], joint(client)["id"])

    assert response.status_code == 201, response.text
    created = response.json()
    assert sorted(row["amount"] for row in created) == ["100.00", "200.00", "75.18"]
    assert {row["notes"] for row in created} == {
        "Paying back " + older["movement"]["product_name"],
        "Paying back " + newer["movement"]["product_name"],
        "Paying back shipping supplies",
    }
    assert all(row["occurred_on"] == "2026-03-01" for row in created)
    assert open_items(client) == []
    assert statement(client, me(client)["id"])["items"] == []
    assert me(client)["balance"] == "0.00"
    assert joint(client)["balance"] == "-375.18"
    funding = {row["id"]: row for row in movements(client, kind="funding")}
    for item in (older, newer):
        [paid] = funding[item["movement"]["id"]]["paid_back"]
        assert paid["occurred_on"] == "2026-03-01"
        assert paid["from_account_name"] == joint(client)["name"]


def test_paying_back_someone_owed_nothing_is_refused(client):
    response = pay_back_all(client, me(client)["id"], joint(client)["id"])

    assert response.status_code == 422
    assert response.json()["detail"] == me(client)["name"] + " is not owed anything"


def test_paying_someone_back_from_their_own_account_is_refused(client, make_product):
    buy(client, make_product()["id"], "100.00")

    response = pay_back_all(client, me(client)["id"], me(client)["id"])

    assert response.status_code == 422
    assert response.json()["detail"] == "Pay them back from a different account"
    assert me(client)["balance"] == "100.00"


def test_paying_back_an_unknown_account_is_a_404(client):
    assert pay_back_all(client, str(uuid.uuid4()), joint(client)["id"]).status_code == 404


def test_paying_back_from_an_unknown_account_is_a_404(client, make_product):
    buy(client, make_product()["id"], "100.00")

    assert pay_back_all(client, me(client)["id"], str(uuid.uuid4())).status_code == 404
