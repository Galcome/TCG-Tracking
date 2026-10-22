"""Setting a balance outright, and a partner buying into the business.

Both exist so nobody does arithmetic. "Jason says he is owed $5,000" is typed as 5000, not
as whatever the difference from today's figure works out to; and putting money in for
shares is its own entry, not a transfer that would leave the business owing it back.
"""

import re
import uuid

from src.models.money import _MOVEMENT_KIND_CHECK, MOVEMENT_KINDS
from tests.test_money_ledger import accounts, buy, joint, me, movements

ADJUSTMENTS = "/api/v1/money/adjustments"
CONTRIBUTIONS = "/api/v1/money/contributions"


def my_member_id(client) -> str:
    return client.get("/api/v1/members/me").json()["id"]


# ------------------------------------------------------------------ set a balance


def test_a_balance_can_be_set_to_what_the_partner_says(client, make_product):
    """Owed $200 from a purchase; Jason says $5,000. The app works out the $4,800."""
    buy(client, make_product()["id"], amount="200.00")
    assert me(client)["balance"] == "200.00"

    response = client.post(ADJUSTMENTS, json={"account_id": me(client)["id"], "target": 500_000})

    assert response.status_code == 201, response.text
    assert response.json()["amount"] == "4800.00"
    assert me(client)["balance"] == "5000.00"


def test_setting_a_lower_balance_takes_the_difference_off(client):
    mine = me(client)["id"]
    client.post(ADJUSTMENTS, json={"account_id": mine, "amount": 100_000})

    client.post(ADJUSTMENTS, json={"account_id": mine, "target": 25_000})

    assert me(client)["balance"] == "250.00"


def test_a_balance_can_be_set_to_zero(client):
    """"We are square with Patrick" is a target like any other."""
    mine = me(client)["id"]
    client.post(ADJUSTMENTS, json={"account_id": mine, "amount": 12_345})

    response = client.post(ADJUSTMENTS, json={"account_id": mine, "target": 0})

    assert response.status_code == 201, response.text
    assert me(client)["balance"] == "0.00"


def test_the_joint_account_can_be_set_to_what_the_bank_says(client):
    client.post(ADJUSTMENTS, json={"account_id": joint(client)["id"], "target": 67_700})

    assert joint(client)["balance"] == "677.00"


def test_setting_the_balance_it_already_has_is_refused(client):
    """A zero-change correction would clutter the ledger and explain nothing."""
    response = client.post(ADJUSTMENTS, json={"account_id": me(client)["id"], "target": 0})

    assert response.status_code == 422
    assert "already" in response.json()["detail"]


def test_an_adjustment_says_one_thing_not_two(client):
    mine = me(client)["id"]
    both = client.post(ADJUSTMENTS, json={"account_id": mine, "amount": 100, "target": 100})
    neither = client.post(ADJUSTMENTS, json={"account_id": mine})

    assert both.status_code == 422
    assert neither.status_code == 422


def test_setting_a_missing_account_is_a_404(client):
    response = client.post(ADJUSTMENTS, json={"account_id": str(uuid.uuid4()), "target": 100})

    assert response.status_code == 404


# ---------------------------------------------------------------- buying in


def test_a_buy_in_puts_cash_in_and_leaves_nobody_owed(client):
    """The difference from a transfer: the business does not owe a buy-in back."""
    response = client.post(
        CONTRIBUTIONS, json={"member_id": my_member_id(client), "amount": "5000.00"}
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["kind"] == "contribution"
    assert body["amount"] == "5000.00"
    assert body["contributed_by_member_id"] == my_member_id(client)
    assert joint(client)["balance"] == "5000.00"
    assert me(client)["balance"] == "0.00"


def test_each_partner_s_buy_in_is_kept_apart_from_what_they_are_owed(client):
    client.post(CONTRIBUTIONS, json={"member_id": my_member_id(client), "amount": "5000.00"})
    client.post(CONTRIBUTIONS, json={"member_id": my_member_id(client), "amount": "250.00"})

    page = accounts(client)
    assert me(client)["contributed"] == "5250.00"
    assert joint(client)["contributed"] is None
    assert page["total_contributed"] == "5250.00"
    assert page["total_owed"] == "0.00"


def test_a_voided_buy_in_stops_counting(client):
    created = client.post(
        CONTRIBUTIONS, json={"member_id": my_member_id(client), "amount": "100.00"}
    ).json()

    voided = client.post(
        f"/api/v1/money/movements/{created['id']}/void", json={"reason": "typo"}
    )

    assert voided.status_code == 200, voided.text
    assert joint(client)["balance"] == "0.00"
    assert me(client)["contributed"] == "0.00"
    assert accounts(client)["total_contributed"] == "0.00"


def test_buy_ins_can_be_listed_on_their_own(client):
    client.post(CONTRIBUTIONS, json={"member_id": my_member_id(client), "amount": "100.00"})

    assert [row["kind"] for row in movements(client, kind="contribution")] == ["contribution"]


def test_a_buy_in_for_someone_who_is_not_a_member_is_a_404(client):
    response = client.post(
        CONTRIBUTIONS, json={"member_id": str(uuid.uuid4()), "amount": "100.00"}
    )

    assert response.status_code == 404


def test_a_buy_in_of_nothing_is_refused(client):
    response = client.post(
        CONTRIBUTIONS, json={"member_id": my_member_id(client), "amount": "0"}
    )

    assert response.status_code == 422


def test_a_blank_note_on_a_buy_in_is_stored_as_nothing(client):
    response = client.post(
        CONTRIBUTIONS,
        json={"member_id": my_member_id(client), "amount": "100.00", "notes": "   "},
    )

    assert response.json()["notes"] is None


def test_the_database_allows_exactly_the_kinds_the_code_knows():
    assert tuple(re.findall(r"'([a-z_]+)'", _MOVEMENT_KIND_CHECK)) == MOVEMENT_KINDS
