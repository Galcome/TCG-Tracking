"""The movements list: transfers are money moved, paybacks sit on what they paid off.

Paying a partner back for a purchase is not a transfer of its own in the list. It shows on
the purchase with a tick, so the list reads "bought this, paid back" rather than twice.
The list narrows by type, account and date, and a row counts as touching an account or a
date when one of its paybacks does.
"""

from tests.test_money_ledger import TODAY, joint, me, movements
from tests.test_money_open_items import pay_back, settle, two_open_rows, void_movement

MOVEMENTS = "/api/v1/money/movements"


def ids(client, **params) -> list[str]:
    return [row["id"] for row in movements(client, **params)]


def test_a_payback_is_shown_on_the_row_it_paid_off(client, make_product):
    older, newer = two_open_rows(client, make_product)

    payback = settle(client, newer["movement"]["id"], "50.00")

    assert payback["id"] not in ids(client)
    assert movements(client, kind="transfer") == []
    funding = {row["id"]: row for row in movements(client, kind="funding")}
    assert [paid["movement_id"] for paid in funding[newer["movement"]["id"]]["paid_back"]] == [
        payback["id"]
    ]
    assert funding[older["movement"]["id"]]["paid_back"] == []
    assert client.get(MOVEMENTS).json()["total"] == 2


def test_money_moved_for_no_row_is_a_transfer(client, make_product):
    two_open_rows(client, make_product)

    pay_back(client, "30.00")

    [row] = movements(client, kind="transfer")
    assert row["amount"] == "30.00"


def test_a_voided_payback_is_listed_as_the_voided_transfer_it_was(client, make_product):
    _, newer = two_open_rows(client, make_product)
    payback = settle(client, newer["movement"]["id"], "50.00")

    void_movement(client, payback["id"])

    [row] = movements(client, kind="transfer")
    assert (row["id"], row["status"]) == (payback["id"], "voided")
    funding = {row["id"]: row for row in movements(client, kind="funding")}
    assert funding[newer["movement"]["id"]]["paid_back"] == []


def test_the_list_narrows_to_a_date_range(client, make_product):
    older, newer = two_open_rows(client, make_product)

    assert ids(client, occurred_from="2026-02-01") == [newer["movement"]["id"]]
    assert ids(client, occurred_to="2026-01-31") == [older["movement"]["id"]]
    assert ids(client, occurred_from="2026-01-01", occurred_to="2026-01-01") == [
        older["movement"]["id"]
    ]
    assert ids(client, occurred_from="2026-03-01") == []


def test_a_row_paid_back_inside_the_range_is_in_it(client, make_product):
    older, _ = two_open_rows(client, make_product)

    settle(client, older["movement"]["id"], "100.00")

    assert ids(client, occurred_from=TODAY.isoformat()) == [older["movement"]["id"]]


def test_a_row_paid_back_from_an_account_shows_under_it(client, make_product):
    older, _ = two_open_rows(client, make_product)

    assert ids(client, account_id=joint(client)["id"]) == []

    settle(client, older["movement"]["id"], "100.00")

    assert ids(client, account_id=joint(client)["id"]) == [older["movement"]["id"]]
    assert len(ids(client, account_id=me(client)["id"])) == 2


def test_a_range_that_ends_before_it_starts_is_refused(client):
    response = client.get(
        MOVEMENTS, params={"occurred_from": "2026-02-01", "occurred_to": "2026-01-01"}
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "The start date is after the end date"
