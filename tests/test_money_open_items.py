"""What the group still owes for, and the ledger rows that lead back to a purchase or sale.

Pay back on a row settles that row. Money with no row to come off clears the oldest ones, so
a partner's rows always add up to what they are owed: nothing reconciles by hand here.
"""

import uuid

from src.auth import get_current_user
from src.main import app
from tests.test_money_ledger import buy, joint, me, movements, sell

OPEN = "/api/v1/money/open"
TRANSFERS = "/api/v1/money/transfers"
ADJUSTMENTS = "/api/v1/money/adjustments"
DELETED = "/api/v1/audit/deleted-products"


def open_items(client) -> list[dict]:
    response = client.get(OPEN)
    assert response.status_code == 200, response.text
    return response.json()["items"]


def pay_back(client, amount: str) -> None:
    response = client.post(
        TRANSFERS,
        json={
            "from_account_id": joint(client)["id"],
            "to_account_id": me(client)["id"],
            "amount": amount,
        },
    )
    assert response.status_code == 201, response.text


def settle(client, movement_id: str, amount: str) -> dict:
    """What the Pay back button sends for one row."""
    response = client.post(
        TRANSFERS,
        json={
            "from_account_id": joint(client)["id"],
            "to_account_id": me(client)["id"],
            "amount": amount,
            "settles_movement_id": movement_id,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def outstanding(client) -> list[str]:
    return [item["outstanding"] for item in open_items(client)]


def two_open_rows(client, make_product) -> tuple[dict, dict]:
    """$100 bought in January and $200 bought in February, both paid by me."""
    buy(client, make_product()["id"], "100.00", purchase_date="2026-01-01")
    buy(client, make_product()["id"], "200.00", purchase_date="2026-02-01")
    older, newer = open_items(client)
    return older, newer


def void_movement(client, movement_id: str) -> None:
    response = client.post(
        f"/api/v1/money/movements/{movement_id}/void", json={"reason": "Entered by mistake"}
    )
    assert response.status_code == 200, response.text


# ---------------------------------------------------------------------- open items


def test_a_purchase_a_partner_paid_for_is_open(client, make_product):
    product = make_product()
    buy(client, product["id"], "200.00")

    [item] = open_items(client)

    assert item["outstanding"] == "200.00"
    assert item["account_id"] == me(client)["id"]
    assert item["account_name"] == me(client)["name"]
    assert item["movement"]["kind"] == "funding"
    assert item["movement"]["product_id"] == product["id"]
    assert item["movement"]["product_name"] == product["name"]


def test_a_purchase_from_joint_cash_owes_nobody(client, make_product):
    buy(client, make_product()["id"], funding=[{"account_id": joint(client)["id"]}])

    assert open_items(client) == []


def test_paying_back_a_row_settles_that_row(client, make_product):
    older, newer = two_open_rows(client, make_product)

    settle(client, newer["movement"]["id"], "200.00")

    [left] = open_items(client)
    assert left["movement"]["id"] == older["movement"]["id"]
    assert left["outstanding"] == "100.00"
    assert me(client)["balance"] == "100.00"


def test_part_of_a_row_leaves_the_rest_on_that_row(client, make_product):
    older, newer = two_open_rows(client, make_product)

    settle(client, newer["movement"]["id"], "50.00")

    assert [
        (item["movement"]["id"], item["outstanding"]) for item in open_items(client)
    ] == [(older["movement"]["id"], "100.00"), (newer["movement"]["id"], "150.00")]


def test_paying_back_a_row_in_steps_finishes_it(client, make_product):
    older, newer = two_open_rows(client, make_product)

    settle(client, newer["movement"]["id"], "50.00")
    settle(client, newer["movement"]["id"], "150.00")

    assert [item["movement"]["id"] for item in open_items(client)] == [older["movement"]["id"]]


def test_voiding_a_payback_reopens_the_row_it_paid(client, make_product):
    _, newer = two_open_rows(client, make_product)
    payback = settle(client, newer["movement"]["id"], "200.00")
    assert outstanding(client) == ["100.00"]

    void_movement(client, payback["id"])

    assert outstanding(client) == ["100.00", "200.00"]


def test_correcting_a_payback_stays_on_its_row(client, make_product):
    older, newer = two_open_rows(client, make_product)
    payback = settle(client, newer["movement"]["id"], "200.00")
    assert payback["settles_movement_id"] == newer["movement"]["id"]

    # What Edit does: void the original and post the correction with the same link.
    void_movement(client, payback["id"])
    settle(client, payback["settles_movement_id"], "150.00")

    assert [
        (item["movement"]["id"], item["outstanding"]) for item in open_items(client)
    ] == [(older["movement"]["id"], "100.00"), (newer["movement"]["id"], "50.00")]


def test_more_than_a_row_owes_carries_over_without_going_negative(client, make_product):
    older, newer = two_open_rows(client, make_product)

    settle(client, newer["movement"]["id"], "250.00")

    [left] = open_items(client)
    assert left["movement"]["id"] == older["movement"]["id"]
    assert left["outstanding"] == "50.00"

    settle(client, older["movement"]["id"], "500.00")

    assert open_items(client) == []
    assert me(client)["balance"] == "-450.00"


def test_unlinked_money_clears_the_oldest_row_around_a_settled_one(client, make_product):
    older, newer = two_open_rows(client, make_product)
    settle(client, newer["movement"]["id"], "200.00")

    pay_back(client, "30.00")

    assert [
        (item["movement"]["id"], item["outstanding"]) for item in open_items(client)
    ] == [(older["movement"]["id"], "70.00")]


def test_rows_add_up_to_the_balance_with_linked_and_unlinked_money(client, make_product):
    older, newer = two_open_rows(client, make_product)
    buy(client, make_product()["id"], "75.50", purchase_date="2026-03-01")
    settle(client, newer["movement"]["id"], "60.25")
    settle(client, older["movement"]["id"], "10.00")
    pay_back(client, "45.00")

    assert me(client)["balance"] == "260.25"
    assert sum(int(amount.replace(".", "")) for amount in outstanding(client)) == 26_025


def test_settling_a_row_leaves_every_other_row_alone_after_old_money(client, make_product):
    """A row already reduced by unlinked money pays off at what it shows."""
    _, newer = two_open_rows(client, make_product)
    pay_back(client, "250.00")
    assert [item["movement"]["id"] for item in open_items(client)] == [newer["movement"]["id"]]
    assert outstanding(client) == ["50.00"]

    settle(client, newer["movement"]["id"], "50.00")

    assert open_items(client) == []
    assert me(client)["balance"] == "0.00"


def test_a_partial_payback_on_a_split_purchase_only_touches_that_partner(client, make_product):
    buy(
        client,
        make_product()["id"],
        "300.00",
        funding=[
            {"account_id": me(client)["id"], "amount": "100.00"},
            {"account_id": joint(client)["id"], "amount": "200.00"},
        ],
    )
    [item] = open_items(client)

    settle(client, item["movement"]["id"], "40.00")

    assert outstanding(client) == ["60.00"]


def test_a_link_must_be_to_something_that_partner_paid_for(client, make_product):
    buy(client, make_product()["id"], funding=[{"account_id": joint(client)["id"]}])
    [row] = movements(client, kind="funding")

    response = client.post(
        TRANSFERS,
        json={
            "from_account_id": joint(client)["id"],
            "to_account_id": me(client)["id"],
            "amount": "10.00",
            "settles_movement_id": row["id"],
        },
    )

    assert response.status_code == 422
    assert "can no longer be paid back" in response.json()["detail"]
    assert [row["kind"] for row in movements(client)] == ["funding"]


def test_a_link_to_nothing_is_refused(client):
    response = client.post(
        TRANSFERS,
        json={
            "from_account_id": joint(client)["id"],
            "to_account_id": me(client)["id"],
            "amount": "10.00",
            "settles_movement_id": str(uuid.uuid4()),
        },
    )

    assert response.status_code == 422


def test_a_row_voided_while_the_dialog_was_open_is_refused(client, make_product):
    purchase = buy(client, make_product()["id"], "100.00")
    [item] = open_items(client)
    client.post(f"/api/v1/purchases/{purchase['id']}/void", json={"reason": "Entered by mistake"})

    response = client.post(
        TRANSFERS,
        json={
            "from_account_id": joint(client)["id"],
            "to_account_id": me(client)["id"],
            "amount": "100.00",
            "settles_movement_id": item["movement"]["id"],
        },
    )

    assert response.status_code == 422


def test_a_payback_stops_reporting_a_row_that_was_voided(client, make_product):
    """Correcting it posts the link again, and a dead link would be refused."""
    purchase = buy(client, make_product()["id"], "100.00")
    [item] = open_items(client)
    payback = settle(client, item["movement"]["id"], "100.00")
    client.post(f"/api/v1/purchases/{purchase['id']}/void", json={"reason": "Entered by mistake"})

    [row] = movements(client, kind="transfer")

    assert row["id"] == payback["id"]
    assert row["settles_movement_id"] is None


def test_a_payback_keeps_its_row_through_a_product_delete_and_restore(client, make_product):
    newer_product = make_product()
    buy(client, make_product()["id"], "100.00", purchase_date="2026-01-01")
    buy(client, newer_product["id"], "200.00", purchase_date="2026-02-01")
    older, newer = open_items(client)
    settle(client, newer["movement"]["id"], "200.00")

    deleted = client.delete(f"/api/v1/products/{newer_product['id']}")
    assert deleted.status_code < 300, deleted.text

    # Its debt went with the delete, while the payback is still real money paid out.
    [row] = movements(client, kind="transfer")
    assert row["settles_movement_id"] is None
    assert me(client)["balance"] == "-100.00"
    assert open_items(client) == []

    [entry] = client.get(DELETED).json()
    restored = client.post(f"{DELETED}/{entry['id']}/restore")
    assert restored.status_code == 201, restored.text

    [left] = open_items(client)
    assert left["movement"]["id"] == older["movement"]["id"]
    assert left["outstanding"] == "100.00"
    [row] = movements(client, kind="transfer")
    assert row["settles_movement_id"] == newer["movement"]["id"]


def test_money_with_no_row_clears_the_oldest_item_first(client, make_product):
    buy(client, make_product()["id"], "100.00", purchase_date="2026-01-01")
    buy(client, make_product()["id"], "200.00", purchase_date="2026-02-01")

    assert outstanding(client) == ["100.00", "200.00"]

    pay_back(client, "30.00")
    assert outstanding(client) == ["70.00", "200.00"]

    pay_back(client, "70.00")
    assert outstanding(client) == ["200.00"]

    pay_back(client, "200.00")
    assert outstanding(client) == []


def test_open_items_add_up_to_the_balance(client, make_product):
    buy(client, make_product()["id"], "100.25", purchase_date="2026-01-01")
    buy(client, make_product()["id"], "200.50", purchase_date="2026-02-01")
    client.post(ADJUSTMENTS, json={"account_id": me(client)["id"], "amount": 1_000})
    pay_back(client, "55.75")

    assert me(client)["balance"] == "255.00"
    assert sum(int(amount.replace(".", "")) for amount in outstanding(client)) == 25_500


def test_a_partner_holding_the_groups_money_has_nothing_open(client, make_product):
    """Sale cash the seller kept settles their purchases without any transfer."""
    product = make_product()
    buy(client, product["id"], "100.00")
    sell(client, product["id"], "300.00")

    assert me(client)["balance"] == "-200.00"
    assert open_items(client) == []


def test_a_voided_purchase_is_no_longer_open(client, make_product):
    purchase = buy(client, make_product()["id"], "100.00")

    response = client.post(
        f"/api/v1/purchases/{purchase['id']}/void", json={"reason": "Entered by mistake"}
    )

    assert response.status_code == 200, response.text
    assert open_items(client) == []


def test_a_voided_payback_reopens_what_it_paid_for(client, make_product):
    buy(client, make_product()["id"], "100.00")
    pay_back(client, "100.00")
    assert open_items(client) == []

    payback = next(row for row in movements(client) if row["kind"] == "transfer")
    void_movement(client, payback["id"])

    assert outstanding(client) == ["100.00"]


def test_a_correction_to_what_a_partner_is_owed_is_open_too(client):
    client.post(ADJUSTMENTS, json={"account_id": me(client)["id"], "amount": 12_345})

    [item] = open_items(client)

    assert item["outstanding"] == "123.45"
    assert item["movement"]["kind"] == "adjustment"


def test_only_a_partners_share_of_a_split_purchase_is_open(client, make_product):
    buy(
        client,
        make_product()["id"],
        "300.00",
        funding=[
            {"account_id": me(client)["id"], "amount": "100.00"},
            {"account_id": joint(client)["id"], "amount": "200.00"},
        ],
    )

    [item] = open_items(client)

    assert item["outstanding"] == "100.00"
    assert item["movement"]["amount"] == "300.00"
    assert len(item["movement"]["legs"]) == 2


def test_open_items_need_a_signed_in_member(client):
    override = app.dependency_overrides.pop(get_current_user)
    try:
        assert client.get(OPEN).status_code == 401
    finally:
        app.dependency_overrides[get_current_user] = override


# --------------------------------------------------------------------- ledger rows


def test_stock_rows_name_the_product_they_came_from(client, make_product):
    product = make_product()
    buy(client, product["id"])
    sell(client, product["id"])

    for kind in ("funding", "proceeds"):
        [row] = movements(client, kind=kind)
        assert row["product_id"] == product["id"]


def test_other_rows_name_no_product(client):
    client.post(ADJUSTMENTS, json={"account_id": me(client)["id"], "amount": 100})

    [row] = movements(client)

    assert row["product_id"] is None
    assert row["product_name"] is None


def test_voided_rows_are_listed_unless_asked_not_to(client):
    client.post(ADJUSTMENTS, json={"account_id": me(client)["id"], "amount": 100})
    client.post(ADJUSTMENTS, json={"account_id": me(client)["id"], "amount": 200})
    voided, kept = movements(client)
    void_movement(client, voided["id"])

    assert len(movements(client)) == 2
    assert len(movements(client, include_voided=True)) == 2

    response = client.get("/api/v1/money/movements", params={"include_voided": False})

    assert response.status_code == 200, response.text
    assert [row["id"] for row in response.json()["items"]] == [kept["id"]]
    assert response.json()["total"] == 1
