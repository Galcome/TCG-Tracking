"""What the group still owes for, and the ledger rows that lead back to a purchase or sale.

Open items are worked out from the balance, so a partner's rows must always add up to what
they are owed: nothing reconciles by hand here.
"""

from src.auth import get_current_user
from src.main import app
from tests.test_money_ledger import buy, joint, me, movements, sell

OPEN = "/api/v1/money/open"
TRANSFERS = "/api/v1/money/transfers"
ADJUSTMENTS = "/api/v1/money/adjustments"


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


def outstanding(client) -> list[str]:
    return [item["outstanding"] for item in open_items(client)]


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


def test_a_payback_clears_the_oldest_item_first(client, make_product):
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
