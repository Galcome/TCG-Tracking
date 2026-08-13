"""The money ledger: whose money paid for stock, and who is owed what.

This answers a different question from the stock ledger, and the tests are written that way.
`purchases` and `sales` say what was spent and what came back; these tables say where the
cash actually is. The two are never added together.

The whole design rests on one rule, so it gets the hardest tests: a posting stores signed
cash flow through an account, and a member account's *balance* is that flow negated, because
what it means is "what the business owes this person".
"""

import uuid
from datetime import date

import pytest

from src.models.money import ACCOUNT_JOINT, ACCOUNT_MEMBER
from src.services.money import proportional_split

TODAY = date.today()


def accounts(client) -> dict:
    response = client.get("/api/v1/money/accounts")
    assert response.status_code == 200, response.text
    return response.json()


def account_named(client, name: str) -> dict:
    return next(item for item in accounts(client)["items"] if item["name"] == name)


def joint(client) -> dict:
    return next(item for item in accounts(client)["items"] if item["kind"] == ACCOUNT_JOINT)


def me(client) -> dict:
    """The signed-in member's own account. Patrick, per the default claims fixture."""
    member = client.get("/api/v1/members/me").json()
    return next(
        item for item in accounts(client)["items"] if item["member_id"] == member["id"]
    )


def buy(client, product_id, amount="200.00", **extra) -> dict:
    response = client.post(
        "/api/v1/purchases",
        json={
            "product_id": product_id,
            "quantity": 1,
            "amount": amount,
            "purchase_date": TODAY.isoformat(),
            **extra,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def sell(client, product_id, amount="300.00", **extra) -> dict:
    response = client.post(
        "/api/v1/sales",
        json={
            "product_id": product_id,
            "quantity": 1,
            "amount": amount,
            "sale_date": TODAY.isoformat(),
            **extra,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def movements(client, **params) -> list[dict]:
    response = client.get("/api/v1/money/movements", params=params)
    assert response.status_code == 200, response.text
    return response.json()["items"]


# ------------------------------------------------------------------------- accounts


def test_accounts_appear_without_anyone_creating_them(client):
    """Nobody should have to set up bookkeeping before they can record a purchase."""
    page = accounts(client)

    kinds = {item["kind"] for item in page["items"]}
    assert ACCOUNT_JOINT in kinds
    assert ACCOUNT_MEMBER in kinds


def test_asking_twice_does_not_make_a_second_joint_account(client):
    accounts(client)
    accounts(client)

    joints = [item for item in accounts(client)["items"] if item["kind"] == ACCOUNT_JOINT]
    assert len(joints) == 1


def test_an_account_says_what_its_balance_means(client):
    """A bare number is not enough: -500 is a debt on one account and a hole in the other."""
    page = accounts(client)

    by_kind = {item["kind"]: item["balance_means"] for item in page["items"]}
    assert by_kind[ACCOUNT_JOINT] == "cash"
    assert by_kind[ACCOUNT_MEMBER] == "owed"


def test_cash_and_what_is_owed_are_never_summed(client):
    """Money you have and money you owe your own partners are different facts.

    A single netted figure would hide whichever of the two is the problem, which is exactly
    the trap the dashboard's "Since day one" block has to avoid as well.
    """
    page = accounts(client)
    assert "joint_balance" in page
    assert "total_owed" in page
    assert "net" not in page


# -------------------------------------------------------------- funding a purchase


def test_a_purchase_puts_the_buyer_in_credit(client, make_product):
    """Jason fronting $5,000 of his own money means the business owes Jason $5,000."""
    product = make_product()
    buy(client, product["id"], "5000.00")

    assert me(client)["balance"] == "5000.00"


def test_funding_can_be_pointed_at_the_joint_account(client, make_product):
    """Bought out of the shared pot: joint cash falls and nobody is owed anything."""
    product = make_product()
    buy(client, product["id"], "800.00", funding=[{"account_id": joint(client)["id"]}])

    assert joint(client)["balance"] == "-800.00"
    assert me(client)["balance"] == "0.00"


def test_funding_can_be_split_between_two_people(client, make_product):
    """The spreadsheet splits every purchase across two columns that sum to the price."""
    product = make_product()
    mine = me(client)["id"]
    theirs = joint(client)["id"]

    buy(
        client,
        product["id"],
        "2892.57",
        funding=[
            {"account_id": mine, "amount": "695.96"},
            {"account_id": theirs, "amount": "2196.61"},
        ],
    )

    assert me(client)["balance"] == "695.96"
    assert joint(client)["balance"] == "-2196.61"


def test_a_split_that_does_not_add_up_is_refused(client, make_product):
    """Money does not appear from nowhere, and a ledger that allows it stops being trusted."""
    product = make_product()

    response = client.post(
        "/api/v1/purchases",
        json={
            "product_id": product["id"],
            "quantity": 1,
            "amount": "500.00",
            "funding": [
                {"account_id": me(client)["id"], "amount": "100.00"},
                {"account_id": joint(client)["id"], "amount": "100.00"},
            ],
        },
    )

    assert response.status_code == 422
    assert "200.00" in response.json()["detail"]
    assert "500.00" in response.json()["detail"]


def test_funding_counts_what_it_actually_cost_to_land(client, make_product):
    """Shipping and tax came out of the same pocket as the price did."""
    product = make_product()
    buy(client, product["id"], "180.00", shipping="15.00", tax="5.00")

    assert me(client)["balance"] == "200.00"


def test_a_purchase_can_record_no_money_at_all(client, make_product):
    """Historical stock nobody remembers paying for is better left blank than guessed at."""
    product = make_product()
    buy(client, product["id"], "300.00", funding=[])

    assert me(client)["balance"] == "0.00"
    assert movements(client) == []


def test_one_account_cannot_appear_twice_in_a_split(client, make_product):
    product = make_product()
    mine = me(client)["id"]

    response = client.post(
        "/api/v1/purchases",
        json={
            "product_id": product["id"],
            "quantity": 1,
            "amount": "200.00",
            "funding": [
                {"account_id": mine, "amount": "100.00"},
                {"account_id": mine, "amount": "100.00"},
            ],
        },
    )
    assert response.status_code == 422


def test_a_split_needs_an_amount_on_every_leg(client, make_product):
    product = make_product()

    response = client.post(
        "/api/v1/purchases",
        json={
            "product_id": product["id"],
            "quantity": 1,
            "amount": "200.00",
            "funding": [
                {"account_id": me(client)["id"]},
                {"account_id": joint(client)["id"], "amount": "100.00"},
            ],
        },
    )
    assert response.status_code == 422
    assert "amount" in response.json()["detail"]


def test_funding_an_account_that_does_not_exist_is_a_404(client, make_product):
    product = make_product()

    response = client.post(
        "/api/v1/purchases",
        json={
            "product_id": product["id"],
            "quantity": 1,
            "amount": "200.00",
            "funding": [{"account_id": str(uuid.uuid4())}],
        },
    )
    assert response.status_code == 404


def test_a_product_created_with_its_first_purchase_records_who_paid(
    client, game_id, product_type_id
):
    """The commonest entry path of all, and it went through a different route."""
    created = client.post(
        "/api/v1/products",
        json={
            "name": "Funded At Birth",
            "game_id": str(game_id),
            "product_type_id": str(product_type_id),
            "initial_purchase": {"quantity": 2, "amount": "450.00"},
        },
    )
    assert created.status_code == 201

    assert me(client)["balance"] == "450.00"


# ------------------------------------------------------- correcting a purchase


def test_correcting_the_price_carries_the_funding_with_it(client, make_product):
    """The bug this exists to stop: a funding record still claiming the old number."""
    product = make_product()
    purchase = buy(client, product["id"], "200.00")

    client.patch(f"/api/v1/purchases/{purchase['id']}", json={"amount": "300.00"})

    assert me(client)["balance"] == "300.00"


def test_a_rescale_keeps_the_original_proportions(client, make_product):
    product = make_product()
    mine = me(client)["id"]
    shared = joint(client)["id"]
    purchase = buy(
        client,
        product["id"],
        "200.00",
        funding=[
            {"account_id": mine, "amount": "150.00"},
            {"account_id": shared, "amount": "50.00"},
        ],
    )

    client.patch(f"/api/v1/purchases/{purchase['id']}", json={"amount": "300.00"})

    assert me(client)["balance"] == "225.00"
    assert joint(client)["balance"] == "-75.00"


def test_who_paid_can_be_changed_after_the_fact(client, make_product):
    """It was on Jason's card, not the joint account - fixable without voiding anything."""
    product = make_product()
    purchase = buy(client, product["id"], "400.00")
    assert me(client)["balance"] == "400.00"

    client.patch(
        f"/api/v1/purchases/{purchase['id']}",
        json={"funding": [{"account_id": joint(client)["id"]}]},
    )

    assert me(client)["balance"] == "0.00"
    assert joint(client)["balance"] == "-400.00"


def test_funding_can_be_taken_off_a_purchase(client, make_product):
    product = make_product()
    purchase = buy(client, product["id"], "400.00")

    client.patch(f"/api/v1/purchases/{purchase['id']}", json={"funding": []})

    assert me(client)["balance"] == "0.00"


def test_a_purchase_corrected_to_nothing_moves_no_money(client, make_product):
    """Rescaling to zero would write zero-value legs, which the ledger refuses on purpose."""
    product = make_product()
    purchase = buy(client, product["id"], "400.00")

    response = client.patch(f"/api/v1/purchases/{purchase['id']}", json={"amount": "0.00"})
    assert response.status_code == 200

    assert me(client)["balance"] == "0.00"


def test_editing_a_purchase_that_never_had_funding_does_not_invent_any(client, make_product):
    """Who paid is not derivable. Silence is the honest answer, not a guess."""
    product = make_product()
    purchase = buy(client, product["id"], "300.00", funding=[])

    client.patch(f"/api/v1/purchases/{purchase['id']}", json={"amount": "500.00"})

    assert movements(client) == []


def test_voiding_a_purchase_voids_the_money_that_paid_for_it(client, make_product):
    product = make_product()
    purchase = buy(client, product["id"], "600.00")

    client.post(f"/api/v1/purchases/{purchase['id']}/void", json={"reason": "never happened"})

    assert me(client)["balance"] == "0.00"
    assert [row["status"] for row in movements(client)] == ["voided"]


# ------------------------------------------------------------ proceeds from a sale


def test_the_seller_holds_the_money_until_they_move_it(client, make_product):
    """The eBay payout lands in Patrick's account, not a shared one.

    Him holding $300 of the group's money reduces what the group owes him by $300.
    """
    product = make_product()
    buy(client, product["id"], "200.00", funding=[{"account_id": joint(client)["id"]}])
    sell(client, product["id"], "300.00")

    assert me(client)["balance"] == "-300.00"
    assert joint(client)["balance"] == "-200.00"


def test_proceeds_can_go_straight_to_the_joint_account(client, make_product):
    product = make_product()
    buy(client, product["id"], "200.00", funding=[{"account_id": joint(client)["id"]}])
    sell(client, product["id"], "300.00", proceeds_account_id=joint(client)["id"])

    assert joint(client)["balance"] == "100.00"
    assert me(client)["balance"] == "0.00"


def test_proceeds_are_what_landed_after_the_fees(client, make_product):
    """Gross is what the buyer paid. Net is what anybody can actually spend."""
    product = make_product()
    buy(client, product["id"], "100.00", funding=[])
    sell(client, product["id"], "300.00", platform_fees="30.00", shipping_paid="20.00")

    assert me(client)["balance"] == "-250.00"


def test_a_sale_swallowed_whole_by_fees_moves_no_money(client, make_product):
    product = make_product()
    buy(client, product["id"], "100.00", funding=[])
    sell(client, product["id"], "50.00", platform_fees="50.00")

    assert me(client)["balance"] == "0.00"
    assert movements(client) == []


def test_fixing_a_fee_follows_through_to_the_money(client, make_product):
    product = make_product()
    buy(client, product["id"], "100.00", funding=[])
    sale = sell(client, product["id"], "300.00", platform_fees="30.00")
    assert me(client)["balance"] == "-270.00"

    client.patch(f"/api/v1/sales/{sale['id']}", json={"platform_fees": "10.00"})

    assert me(client)["balance"] == "-290.00"


def test_a_sale_edited_until_it_nets_nothing_gives_up_its_proceeds(client, make_product):
    product = make_product()
    buy(client, product["id"], "100.00", funding=[])
    sale = sell(client, product["id"], "300.00")

    client.patch(f"/api/v1/sales/{sale['id']}", json={"platform_fees": "300.00"})

    assert me(client)["balance"] == "0.00"


def test_where_the_money_landed_can_be_corrected(client, make_product):
    product = make_product()
    buy(client, product["id"], "100.00", funding=[])
    sale = sell(client, product["id"], "300.00")

    client.patch(
        f"/api/v1/sales/{sale['id']}", json={"proceeds_account_id": joint(client)["id"]}
    )

    assert me(client)["balance"] == "0.00"
    assert joint(client)["balance"] == "300.00"


def test_proceeds_cannot_be_sent_to_an_account_that_does_not_exist(client, make_product):
    product = make_product()
    buy(client, product["id"], "100.00", funding=[])

    response = client.post(
        "/api/v1/sales",
        json={
            "product_id": product["id"],
            "quantity": 1,
            "amount": "300.00",
            "proceeds_account_id": str(uuid.uuid4()),
        },
    )
    assert response.status_code == 404


def test_editing_a_sale_that_nets_nothing_leaves_the_money_alone(client, make_product):
    """No proceeds record exists, and editing the note must not conjure one."""
    product = make_product()
    buy(client, product["id"], "100.00", funding=[])
    sale = sell(client, product["id"], "40.00", platform_fees="40.00")

    client.patch(f"/api/v1/sales/{sale['id']}", json={"notes": "bundled"})

    assert movements(client) == []


def test_voiding_a_sale_takes_its_money_back_out(client, make_product):
    product = make_product()
    buy(client, product["id"], "100.00", funding=[])
    sale = sell(client, product["id"], "300.00")

    client.post(f"/api/v1/sales/{sale['id']}/void", json={"reason": "buyer never paid"})

    assert me(client)["balance"] == "0.00"


# ------------------------------------------------------------------------ transfers


def test_paying_a_partner_back_lowers_both_sides(client, make_product):
    """Jason is owed $5,000, draws $3,000 from the joint account, and is owed $2,000.

    Both figures fall. That is the case a plain from/to model gets wrong, and the reason
    postings store cash flow rather than a balance delta.
    """
    product = make_product()
    buy(client, product["id"], "5000.00")
    client.post(
        "/api/v1/money/adjustments",
        json={"account_id": joint(client)["id"], "amount": 1_000_000},
    )
    assert me(client)["balance"] == "5000.00"

    response = client.post(
        "/api/v1/money/transfers",
        json={
            "from_account_id": joint(client)["id"],
            "to_account_id": me(client)["id"],
            "amount": "3000.00",
        },
    )
    assert response.status_code == 201, response.text

    assert me(client)["balance"] == "2000.00"
    assert joint(client)["balance"] == "7000.00"


def test_a_partner_putting_cash_in_raises_both_sides(client):
    """The mirror image, and it has to work without any special case."""
    client.post(
        "/api/v1/money/transfers",
        json={
            "from_account_id": me(client)["id"],
            "to_account_id": joint(client)["id"],
            "amount": "1500.00",
        },
    )

    assert joint(client)["balance"] == "1500.00"
    assert me(client)["balance"] == "1500.00"


def test_a_transfer_needs_two_different_accounts(client):
    mine = me(client)["id"]
    response = client.post(
        "/api/v1/money/transfers",
        json={"from_account_id": mine, "to_account_id": mine, "amount": "100.00"},
    )
    assert response.status_code == 422


def test_a_transfer_to_an_account_that_does_not_exist_is_a_404(client):
    response = client.post(
        "/api/v1/money/transfers",
        json={
            "from_account_id": me(client)["id"],
            "to_account_id": str(uuid.uuid4()),
            "amount": "100.00",
        },
    )
    assert response.status_code == 404


def test_a_transfer_reads_as_one_amount_not_two(client):
    """Its legs cancel out, so summing their absolute values would double the figure."""
    client.post(
        "/api/v1/money/transfers",
        json={
            "from_account_id": me(client)["id"],
            "to_account_id": joint(client)["id"],
            "amount": "250.00",
        },
    )

    row = movements(client, kind="transfer")[0]
    assert row["amount"] == "250.00"
    assert sorted(leg["amount"] for leg in row["legs"]) == ["-250.00", "250.00"]


# ---------------------------------------------------------------------- adjustments


def test_an_opening_balance_carries_the_spreadsheet_over(client):
    """"Jason was already owed $5,000 when we started" - the workbook's rollover column."""
    response = client.post(
        "/api/v1/money/adjustments",
        json={"account_id": me(client)["id"], "amount": 500_000, "notes": "carried over"},
    )
    assert response.status_code == 201, response.text

    assert me(client)["balance"] == "5000.00"


def test_an_adjustment_is_given_in_the_account_s_own_terms(client):
    """+5000 on a member account means owed $5,000; on the joint one it means $5,000 in it.

    The sign flip to raw cash flow happens server-side precisely so nobody entering a
    correction has to reason about which direction money notionally travelled.
    """
    client.post(
        "/api/v1/money/adjustments",
        json={"account_id": joint(client)["id"], "amount": 500_000},
    )
    client.post(
        "/api/v1/money/adjustments",
        json={"account_id": me(client)["id"], "amount": 500_000},
    )

    assert joint(client)["balance"] == "5000.00"
    assert me(client)["balance"] == "5000.00"


def test_an_adjustment_can_go_the_other_way(client):
    client.post(
        "/api/v1/money/adjustments",
        json={"account_id": me(client)["id"], "amount": -25_000},
    )

    assert me(client)["balance"] == "-250.00"


def test_an_adjustment_of_zero_is_refused(client):
    response = client.post(
        "/api/v1/money/adjustments", json={"account_id": me(client)["id"], "amount": 0}
    )
    assert response.status_code == 422


def test_an_adjustment_against_a_missing_account_is_a_404(client):
    response = client.post(
        "/api/v1/money/adjustments",
        json={"account_id": str(uuid.uuid4()), "amount": 100},
    )
    assert response.status_code == 404


# -------------------------------------------------------------- voiding a movement


def test_voiding_a_transfer_puts_the_balances_back(client):
    created = client.post(
        "/api/v1/money/transfers",
        json={
            "from_account_id": me(client)["id"],
            "to_account_id": joint(client)["id"],
            "amount": "400.00",
        },
    ).json()

    response = client.post(
        f"/api/v1/money/movements/{created['id']}/void", json={"reason": "wrong direction"}
    )
    assert response.status_code == 200

    assert joint(client)["balance"] == "0.00"
    assert me(client)["balance"] == "0.00"


def test_a_voided_movement_stays_on_the_ledger(client):
    """A voided row is the explanation for a balance changing, so it is shown, not hidden."""
    created = client.post(
        "/api/v1/money/transfers",
        json={
            "from_account_id": me(client)["id"],
            "to_account_id": joint(client)["id"],
            "amount": "400.00",
        },
    ).json()
    client.post(f"/api/v1/money/movements/{created['id']}/void", json={"reason": "mistake"})

    assert [row["status"] for row in movements(client)] == ["voided"]


def test_a_movement_cannot_be_voided_twice(client):
    created = client.post(
        "/api/v1/money/transfers",
        json={
            "from_account_id": me(client)["id"],
            "to_account_id": joint(client)["id"],
            "amount": "400.00",
        },
    ).json()
    client.post(f"/api/v1/money/movements/{created['id']}/void", json={"reason": "mistake"})

    again = client.post(
        f"/api/v1/money/movements/{created['id']}/void", json={"reason": "again"}
    )
    assert again.status_code == 409


def test_funding_cannot_be_voided_on_its_own(client, make_product):
    """It describes a purchase. Correcting the purchase is the honest fix, and it follows."""
    product = make_product()
    buy(client, product["id"], "300.00")
    funding = movements(client, kind="funding")[0]

    response = client.post(
        f"/api/v1/money/movements/{funding['id']}/void", json={"reason": "wrong"}
    )

    assert response.status_code == 409
    assert "purchase or a sale" in response.json()["detail"]


def test_voiding_a_movement_that_does_not_exist_is_a_404(client):
    response = client.post(
        f"/api/v1/money/movements/{uuid.uuid4()}/void", json={"reason": "x"}
    )
    assert response.status_code == 404


# ------------------------------------------------------------------ the ledger view


def test_the_ledger_says_what_a_funding_row_was_for(client, make_product):
    product = make_product("Fabled Case")
    buy(client, product["id"], "900.00")

    row = movements(client, kind="funding")[0]
    assert row["product_name"] == "Fabled Case"
    assert row["amount"] == "900.00"


def test_the_ledger_can_be_narrowed_to_one_account(client, make_product):
    product = make_product()
    buy(client, product["id"], "300.00", funding=[{"account_id": joint(client)["id"]}])
    client.post(
        "/api/v1/money/adjustments",
        json={"account_id": me(client)["id"], "amount": 10_000},
    )

    mine = movements(client, account_id=me(client)["id"])
    assert [row["kind"] for row in mine] == ["adjustment"]


def test_the_ledger_pages(client):
    for index in range(3):
        client.post(
            "/api/v1/money/adjustments",
            json={"account_id": me(client)["id"], "amount": 100 + index},
        )

    page = client.get("/api/v1/money/movements", params={"limit": 2}).json()
    assert page["total"] == 3
    assert len(page["items"]) == 2
    assert page["limit"] == 2


def test_an_empty_ledger_is_an_empty_list(client):
    page = client.get("/api/v1/money/movements").json()
    assert page == {"items": [], "total": 0, "limit": 50, "offset": 0}


# --------------------------------------------------------------- the split itself


@pytest.mark.parametrize(
    ("weights", "total", "expected"),
    [
        ([150_00, 50_00], 300_00, [225_00, 75_00]),
        ([1, 1, 1], 100, [34, 33, 33]),
        ([1], 999, [999]),
        ([-100, -100], 501, [-251, -250]),
    ],
)
def test_a_rescale_never_loses_or_invents_a_cent(weights, total, expected):
    result = proportional_split(weights, total)
    assert result == expected
    assert sum(abs(value) for value in result) == total


def test_a_rescale_against_nothing_is_refused():
    with pytest.raises(ValueError, match="sum to zero"):
        proportional_split([0, 0], 100)


def test_a_note_survives_onto_the_movement(client):
    """Whitespace-only notes become nothing; a real one is kept."""
    client.post(
        "/api/v1/money/transfers",
        json={
            "from_account_id": me(client)["id"],
            "to_account_id": joint(client)["id"],
            "amount": "100.00",
            "notes": "  put the Fabled money back  ",
        },
    )

    assert movements(client)[0]["notes"] == "put the Fabled money back"


def test_an_explicitly_empty_note_is_stored_as_nothing(client):
    client.post(
        "/api/v1/money/adjustments",
        json={"account_id": me(client)["id"], "amount": 100, "notes": None},
    )

    assert movements(client)[0]["notes"] is None


def test_moving_proceeds_to_a_sale_that_now_nets_nothing_drops_them(client, make_product):
    """Both edits in one request: a new destination, and fees that swallow the sale."""
    product = make_product()
    buy(client, product["id"], "100.00", funding=[])
    sale = sell(client, product["id"], "300.00")

    client.patch(
        f"/api/v1/sales/{sale['id']}",
        json={"proceeds_account_id": joint(client)["id"], "platform_fees": "300.00"},
    )

    assert joint(client)["balance"] == "0.00"
    assert me(client)["balance"] == "0.00"


def test_a_member_who_leaves_keeps_the_balance_they_are_owed(client, db):
    """A balance that vanishes when someone is deactivated is worse than useless.

    Somebody who steps back from the group may still be owed thousands. Dropping their
    account from the list would quietly reduce what the group thinks it owes.
    """
    from src.models.member import Member

    departing = Member(display_name="Departing Partner", is_active=True)
    db.add(departing)
    db.flush()

    theirs = account_named(client, "Departing Partner")
    client.post(
        "/api/v1/money/adjustments", json={"account_id": theirs["id"], "amount": 100_000}
    )

    departing.is_active = False
    db.flush()

    assert account_named(client, "Departing Partner")["balance"] == "1000.00"
