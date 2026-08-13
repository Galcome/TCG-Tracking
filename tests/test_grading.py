"""Sending cards to be graded, and taking them back.

Two decisions shape this and both were Joseph's.

**The card keeps its bucket and carries a flag**, rather than moving to an "Out" state. The
condition attached to that was the day count: anything away shows how long it has been away,
which is what stops a card quietly sitting at PSA for months.

**The return is the transformation, not the send.** The grade is unknown when it leaves, so
there is nothing to produce until it comes back. And the fees join the cost basis - without
that every graded card's ROI is overstated by roughly the fee.
"""

import uuid
from datetime import date, timedelta

TODAY = date.today()


def stats(client, product_id) -> dict:
    return client.get(f"/api/v1/products/{product_id}").json()["stats"]


def buy(client, product_id, quantity, amount):
    response = client.post(
        "/api/v1/purchases",
        json={
            "product_id": product_id,
            "quantity": quantity,
            "amount": amount,
            "purchase_date": TODAY.isoformat(),
        },
    )
    assert response.status_code == 201, response.text


def send(client, product_id, **extra):
    return client.post(
        "/api/v1/grading", json={"product_id": product_id, **extra}
    )


# ---------------------------------------------------------------------- the send


def test_sending_does_not_move_the_card(client, make_product):
    """It is still the group's stock and still their money, so it stays where it is."""
    card = make_product("Mickey Mouse Iconic")
    buy(client, card["id"], 1, "560.00")

    response = send(client, card["id"], grading_company="PSA", fees="30.00")
    assert response.status_code == 201, response.text

    assert stats(client, card["id"])["quantity_on_hand"] == 1
    assert stats(client, card["id"])["by_bucket"]["inventory"] == 1


def test_anything_away_shows_how_long_it_has_been(client, make_product):
    """The condition the flag was accepted on, and the only real protection it gives."""
    card = make_product("Long Gone Card")
    buy(client, card["id"], 1, "100.00")
    long_ago = TODAY - timedelta(days=90)

    response = send(client, card["id"], sent_on=long_ago.isoformat())

    assert response.json()["days_out"] == 90
    assert response.json()["status"] == "out"


def test_the_longest_away_comes_first(client, make_product):
    """The oldest submission is the one worth chasing, so it leads."""
    old = make_product("Sent Long Ago")
    recent = make_product("Sent Yesterday")
    buy(client, old["id"], 1, "100.00")
    buy(client, recent["id"], 1, "100.00")

    send(client, old["id"], sent_on=(TODAY - timedelta(days=120)).isoformat())
    send(client, recent["id"], sent_on=(TODAY - timedelta(days=1)).isoformat())

    out = client.get("/api/v1/grading", params={"out_only": True}).json()
    names = [row["product_name"] for row in out]
    assert names.index("Sent Long Ago") < names.index("Sent Yesterday")


def test_a_card_you_do_not_have_cannot_be_sent(client, make_product):
    card = make_product("Absent Card")
    assert send(client, card["id"]).status_code == 409


def test_sending_a_product_that_does_not_exist_is_a_404(client):
    assert send(client, str(uuid.uuid4())).status_code == 404


# -------------------------------------------------------------------- the return


def test_the_raw_card_becomes_the_graded_one(client, make_product):
    raw = make_product("Raw Mickey")
    graded = make_product("Raw Mickey — PSA 10")
    buy(client, raw["id"], 1, "560.00")
    submission = send(client, raw["id"], grading_company="PSA", fees="30.00").json()

    response = client.post(
        f"/api/v1/grading/{submission['id']}/return",
        json={"graded_product_id": graded["id"], "grade": "10"},
    )
    assert response.status_code == 200, response.text

    assert stats(client, raw["id"])["quantity_on_hand"] == 0
    assert stats(client, graded["id"])["quantity_on_hand"] == 1


def test_the_fees_join_the_cost_basis(client, make_product):
    """Without this every graded card's ROI is overstated by roughly the fee."""
    raw = make_product("Fee Raw")
    graded = make_product("Fee Graded")
    buy(client, raw["id"], 1, "560.00")
    submission = send(client, raw["id"], fees="30.00").json()

    client.post(
        f"/api/v1/grading/{submission['id']}/return",
        json={"graded_product_id": graded["id"], "grade": "10"},
    )

    assert stats(client, graded["id"])["remaining_cost"] == "590.00"


def test_the_fees_are_money_the_group_actually_spent(client, make_product):
    """Carried cost is not spending; the grading fee is. Both ride on the same row."""
    raw = make_product("Spend Raw")
    graded = make_product("Spend Graded")
    before = float(client.get("/api/v1/dashboard").json()["total_invested"])
    buy(client, raw["id"], 1, "100.00")
    submission = send(client, raw["id"], fees="25.00").json()

    client.post(
        f"/api/v1/grading/{submission['id']}/return",
        json={"graded_product_id": graded["id"]},
    )

    after = float(client.get("/api/v1/dashboard").json()["total_invested"])
    # The card and the fee. Not the card twice.
    assert after == before + 125.00


def test_extra_fees_discovered_on_return_are_added(client, make_product):
    raw = make_product("Extra Raw")
    graded = make_product("Extra Graded")
    buy(client, raw["id"], 1, "100.00")
    submission = send(client, raw["id"], fees="20.00").json()

    response = client.post(
        f"/api/v1/grading/{submission['id']}/return",
        # Explicit nulls: coming back ungraded, with nothing to say about it.
        json={
            "graded_product_id": graded["id"],
            "extra_fees": "15.00",
            "grade": None,
            "notes": None,
        },
    )

    assert response.json()["fees"] == "35.00"
    assert stats(client, graded["id"])["remaining_cost"] == "135.00"


def test_a_bad_grade_uses_the_identical_mechanic(client, make_product):
    """A PSA 7 worth less than raw is not a special case. The loss is simply visible."""
    raw = make_product("Hopeful Raw")
    graded = make_product("Hopeful PSA 7")
    buy(client, raw["id"], 1, "500.00")
    submission = send(client, raw["id"], fees="30.00").json()
    client.post(
        f"/api/v1/grading/{submission['id']}/return",
        json={"graded_product_id": graded["id"], "grade": "7"},
    )

    client.post(
        "/api/v1/sales",
        json={"product_id": graded["id"], "quantity": 1, "amount": "400.00"},
    )

    assert stats(client, graded["id"])["realized_profit"] == "-130.00"


def test_the_return_records_how_long_it_took(client, make_product):
    raw = make_product("Timed Raw")
    graded = make_product("Timed Graded")
    buy(client, raw["id"], 1, "100.00")
    submission = send(
        client, raw["id"], sent_on=(TODAY - timedelta(days=45)).isoformat()
    ).json()

    response = client.post(
        f"/api/v1/grading/{submission['id']}/return",
        json={"graded_product_id": graded["id"], "returned_on": TODAY.isoformat()},
    )

    assert response.json()["days_out"] == 45
    assert response.json()["status"] == "returned"


def test_the_graded_card_stays_in_the_bucket_it_left_from(client, make_product):
    raw = make_product("Vaulted Raw")
    graded = make_product("Vaulted Graded")
    client.post(
        "/api/v1/purchases",
        json={
            "product_id": raw["id"],
            "quantity": 1,
            "amount": "100.00",
            "bucket": "vault",
        },
    )
    submission = send(client, raw["id"], bucket="vault").json()

    client.post(
        f"/api/v1/grading/{submission['id']}/return",
        json={"graded_product_id": graded["id"]},
    )

    assert stats(client, graded["id"])["by_bucket"]["vault"] == 1


def test_it_cannot_come_back_twice(client, make_product):
    raw = make_product("Twice Raw")
    graded = make_product("Twice Graded")
    buy(client, raw["id"], 1, "100.00")
    submission = send(client, raw["id"]).json()
    client.post(
        f"/api/v1/grading/{submission['id']}/return",
        json={"graded_product_id": graded["id"]},
    )

    again = client.post(
        f"/api/v1/grading/{submission['id']}/return",
        json={"graded_product_id": graded["id"]},
    )
    assert again.status_code == 409


def test_the_graded_card_has_to_be_a_different_product(client, make_product):
    raw = make_product("Same Raw")
    buy(client, raw["id"], 1, "100.00")
    submission = send(client, raw["id"]).json()

    response = client.post(
        f"/api/v1/grading/{submission['id']}/return",
        json={"graded_product_id": raw["id"]},
    )
    assert response.status_code == 422


def test_returning_into_a_product_that_does_not_exist_is_a_404(client, make_product):
    raw = make_product("Orphan Raw")
    buy(client, raw["id"], 1, "100.00")
    submission = send(client, raw["id"]).json()

    response = client.post(
        f"/api/v1/grading/{submission['id']}/return",
        json={"graded_product_id": str(uuid.uuid4())},
    )
    assert response.status_code == 404


def test_returning_something_that_does_not_exist_is_a_404(client, make_product):
    graded = make_product("Nowhere Graded")
    response = client.post(
        f"/api/v1/grading/{uuid.uuid4()}/return",
        json={"graded_product_id": graded["id"]},
    )
    assert response.status_code == 404


# ------------------------------------------------------------------- cancelling


def test_a_submission_can_be_cancelled(client, make_product):
    """Nothing moved when it was sent, so nothing has to move back."""
    card = make_product("Cancelled Card")
    buy(client, card["id"], 1, "100.00")
    submission = send(client, card["id"]).json()

    response = client.post(
        f"/api/v1/grading/{submission['id']}/void", json={"reason": "never posted it"}
    )
    assert response.status_code == 200
    assert response.json()["status"] == "voided"
    assert stats(client, card["id"])["quantity_on_hand"] == 1


def test_something_already_back_cannot_be_cancelled(client, make_product):
    raw = make_product("Returned Raw")
    graded = make_product("Returned Graded")
    buy(client, raw["id"], 1, "100.00")
    submission = send(client, raw["id"]).json()
    client.post(
        f"/api/v1/grading/{submission['id']}/return",
        json={"graded_product_id": graded["id"]},
    )

    response = client.post(
        f"/api/v1/grading/{submission['id']}/void", json={"reason": "too late"}
    )
    assert response.status_code == 409


def test_cancelling_something_that_does_not_exist_is_a_404(client):
    response = client.post(
        f"/api/v1/grading/{uuid.uuid4()}/void", json={"reason": "x"}
    )
    assert response.status_code == 404


# ----------------------------------------------------------------------- listing


def test_a_card_can_be_asked_what_it_has_out(client, make_product):
    card = make_product("Queried Card")
    buy(client, card["id"], 2, "200.00")
    send(client, card["id"], grading_company="  PSA  ", notes="  the good one  ")

    found = client.get("/api/v1/grading", params={"product_id": card["id"]}).json()
    assert len(found) == 1
    assert found[0]["grading_company"] == "PSA"
    assert found[0]["notes"] == "the good one"


def test_blank_details_are_stored_as_nothing(client, make_product):
    card = make_product("Blank Detail Card")
    buy(client, card["id"], 1, "100.00")

    response = send(client, card["id"], grading_company=None, notes=None)
    assert response.json()["grading_company"] is None
    assert response.json()["notes"] is None


def test_the_whole_list_is_available(client, make_product):
    card = make_product("Listed Card")
    buy(client, card["id"], 1, "100.00")
    send(client, card["id"])

    assert len(client.get("/api/v1/grading").json()) >= 1


def test_the_return_can_add_its_own_note(client, make_product):
    """Grade and note arrive together on the way back, not when it was sent."""
    raw = make_product("Noted Raw")
    graded = make_product("Noted Graded")
    buy(client, raw["id"], 1, "100.00")
    submission = send(client, raw["id"]).json()

    response = client.post(
        f"/api/v1/grading/{submission['id']}/return",
        json={
            "graded_product_id": graded["id"],
            "grade": "  10  ",
            "notes": "  came back better than hoped  ",
        },
    )

    assert response.json()["grade"] == "10"
    assert response.json()["notes"] == "came back better than hoped"
