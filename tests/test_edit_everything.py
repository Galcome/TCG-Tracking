"""Correcting what was already recorded.

Every one of these used to be "undo it and record it again". That is fine for the ledger and
miserable for the person holding the phone, so each record can now be corrected where it
sits - under the same rules that applied when it was first written, because a correction
that could describe something impossible would be worse than no correction at all.
"""

import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.models.ledger import STATUS_VOIDED, StockMove
from src.models.price_snapshot import PriceSnapshot

TODAY = date.today()
YESTERDAY = TODAY - timedelta(days=1)


def stats(client, product_id) -> dict:
    return client.get(f"/api/v1/products/{product_id}").json()["stats"]


def buckets(client, product_id) -> dict[str, int]:
    return stats(client, product_id)["by_bucket"]


def buy(client, product_id, quantity, amount, bucket="inventory"):
    response = client.post(
        "/api/v1/purchases",
        json={
            "product_id": product_id,
            "quantity": quantity,
            "amount": amount,
            "bucket": bucket,
            "purchase_date": TODAY.isoformat(),
        },
    )
    assert response.status_code == 201, response.text


def move(client, product_id, quantity, source, destination) -> dict:
    response = client.post(
        "/api/v1/moves",
        json={
            "product_id": product_id,
            "quantity": quantity,
            "from_bucket": source,
            "to_bucket": destination,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def sell(client, product_id, quantity, bucket="inventory"):
    response = client.post(
        "/api/v1/sales",
        json={"product_id": product_id, "quantity": quantity, "amount": "5.00", "bucket": bucket},
    )
    assert response.status_code == 201, response.text


# -------------------------------------------------------------------------- moves


def test_a_move_can_be_corrected_in_place(client, make_product):
    product = make_product("Wrong pile")
    buy(client, product["id"], 5, "50.00")
    moved = move(client, product["id"], 2, "inventory", "store")

    response = client.patch(
        f"/api/v1/moves/{moved['id']}",
        json={
            "quantity": 3,
            "to_bucket": "vault",
            "moved_on": YESTERDAY.isoformat(),
            "notes": "  it went in the safe  ",
            "audit_reason": "picked the wrong bucket",
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["quantity"] == 3
    assert body["to_bucket"] == "vault"
    assert body["moved_on"] == YESTERDAY.isoformat()
    assert body["notes"] == "it went in the safe"
    assert buckets(client, product["id"]) == {"inventory": 2, "store": 0, "vault": 3}


def test_a_corrected_move_cannot_take_more_than_the_bucket_holds(client, make_product):
    product = make_product("Too many moved")
    buy(client, product["id"], 2, "20.00")
    moved = move(client, product["id"], 1, "inventory", "store")

    response = client.patch(f"/api/v1/moves/{moved['id']}", json={"quantity": 3})

    assert response.status_code == 409
    assert "inventory would be left holding -1" in response.json()["detail"]
    assert buckets(client, product["id"])["store"] == 1


def test_a_move_cannot_be_shrunk_below_what_already_left_the_destination(client, make_product):
    product = make_product("Sold from the store")
    buy(client, product["id"], 3, "30.00")
    moved = move(client, product["id"], 3, "inventory", "store")
    sell(client, product["id"], 3, bucket="store")

    response = client.patch(f"/api/v1/moves/{moved['id']}", json={"quantity": 1})

    assert response.status_code == 409
    assert "store" in response.json()["detail"]


def test_a_move_still_needs_two_different_buckets(client, make_product):
    product = make_product("Nowhere move")
    buy(client, product["id"], 1, "10.00")
    moved = move(client, product["id"], 1, "inventory", "store")

    response = client.patch(f"/api/v1/moves/{moved['id']}", json={"to_bucket": "inventory"})

    assert response.status_code == 422


def test_a_move_correction_cannot_blank_what_a_move_must_have(client, make_product):
    product = make_product("Null move")
    buy(client, product["id"], 1, "10.00")
    moved = move(client, product["id"], 1, "inventory", "store")

    assert client.patch(f"/api/v1/moves/{moved['id']}", json={"quantity": None}).status_code == 422


def test_a_voided_or_missing_move_cannot_be_corrected(client, make_product):
    product = make_product("Voided move")
    buy(client, product["id"], 1, "10.00")
    moved = move(client, product["id"], 1, "inventory", "store")
    client.post(f"/api/v1/moves/{moved['id']}/void", json={"reason": "wrong pile"})

    assert client.patch(f"/api/v1/moves/{moved['id']}", json={"quantity": 1}).status_code == 409
    assert client.patch(f"/api/v1/moves/{uuid.uuid4()}", json={"quantity": 1}).status_code == 404


# --------------------------------------------------------------------- valuations


def value(client, product_id, amount, **extra) -> dict:
    response = client.post(
        "/api/v1/valuations", json={"product_id": product_id, "value": amount, **extra}
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_valuations_are_listed_newest_first(client, make_product):
    product = make_product("Valued twice")
    other = make_product("Valued elsewhere")
    value(client, product["id"], "10.00", captured_on=YESTERDAY.isoformat())
    value(client, product["id"], "12.00", captured_on=TODAY.isoformat())
    value(client, other["id"], "99.00")

    response = client.get("/api/v1/valuations", params={"product_id": product["id"]})

    assert response.status_code == 200
    assert [row["value"] for row in response.json()] == ["12.00", "10.00"]


def test_a_valuation_can_be_corrected(client, make_product):
    product = make_product("Fat-fingered value")
    buy(client, product["id"], 1, "10.00", bucket="vault")
    recorded = value(client, product["id"], "1500.00")

    response = client.patch(
        f"/api/v1/valuations/{recorded['id']}",
        json={"value": "150.00", "captured_on": YESTERDAY.isoformat(), "notes": " eBay comps "},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["value"] == "150.00"
    assert body["captured_on"] == YESTERDAY.isoformat()
    assert body["notes"] == "eBay comps"

    cleared = client.patch(f"/api/v1/valuations/{recorded['id']}", json={"notes": "  "})
    assert cleared.json()["notes"] is None
    assert cleared.json()["value"] == "150.00"


def test_a_valuation_cannot_lose_its_value(client, make_product):
    product = make_product("Null value")
    recorded = value(client, product["id"], "10.00")

    response = client.patch(f"/api/v1/valuations/{recorded['id']}", json={"value": None})

    assert response.status_code == 422


def test_a_valuation_can_be_removed(client, make_product):
    product = make_product("Never should have been valued")
    recorded = value(client, product["id"], "10.00")

    assert client.delete(f"/api/v1/valuations/{recorded['id']}").status_code == 204
    assert client.get("/api/v1/valuations", params={"product_id": product["id"]}).json() == []


def test_a_valuation_that_does_not_exist_is_a_404(client):
    assert client.patch(f"/api/v1/valuations/{uuid.uuid4()}", json={}).status_code == 404
    assert client.delete(f"/api/v1/valuations/{uuid.uuid4()}").status_code == 404


# ------------------------------------------------------------------------ grading


def send(client, product_id, **extra) -> dict:
    response = client.post("/api/v1/grading", json={"product_id": product_id, **extra})
    assert response.status_code == 201, response.text
    return response.json()


def take_back(client, submission_id, graded_id, **extra) -> dict:
    response = client.post(
        f"/api/v1/grading/{submission_id}/return",
        json={"graded_product_id": graded_id, **extra},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_a_submission_can_be_corrected_while_it_is_away(client, make_product):
    raw = make_product("Sent with the wrong details")
    buy(client, raw["id"], 3, "30.00")
    submission = send(client, raw["id"], quantity=1, grading_company="PSA", fees="20.00")

    response = client.patch(
        f"/api/v1/grading/{submission['id']}",
        json={
            "quantity": 3,
            "grading_company": " CGC ",
            "sent_on": YESTERDAY.isoformat(),
            "fees": "45.00",
            "notes": "bulk tier",
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["quantity"] == 3
    assert body["grading_company"] == "CGC"
    assert body["sent_on"] == YESTERDAY.isoformat()
    assert body["fees"] == "45.00"
    assert body["notes"] == "bulk tier"
    assert body["days_out"] == 1


def test_a_submission_cannot_grow_past_what_the_bucket_holds(client, make_product):
    raw = make_product("Only two to send")
    buy(client, raw["id"], 2, "20.00")
    submission = send(client, raw["id"], quantity=1)
    send(client, raw["id"], quantity=1)

    response = client.patch(f"/api/v1/grading/{submission['id']}", json={"quantity": 2})

    assert response.status_code == 409
    assert "inventory holds 1" in response.json()["detail"]


def test_a_submission_has_no_grade_until_it_is_back(client, make_product):
    raw = make_product("Graded too early")
    buy(client, raw["id"], 1, "10.00")
    submission = send(client, raw["id"])

    response = client.patch(f"/api/v1/grading/{submission['id']}", json={"grade": "10"})

    assert response.status_code == 409


def test_a_returned_submission_keeps_only_its_labels_editable(client, make_product):
    raw = make_product("Back from PSA")
    graded = make_product("Back from PSA - PSA 9")
    buy(client, raw["id"], 1, "10.00")
    submission = send(client, raw["id"], grading_company="PSA", fees="20.00")
    take_back(client, submission["id"], graded["id"], grade="9")

    relabelled = client.patch(
        f"/api/v1/grading/{submission['id']}",
        # Sending the unchanged quantity alongside is what a form does, and is not a change.
        json={"grade": "10", "grading_company": "BGS", "quantity": 1},
    )
    assert relabelled.status_code == 200, relabelled.text
    assert relabelled.json()["grade"] == "10"
    assert relabelled.json()["grading_company"] == "BGS"

    refused = client.patch(f"/api/v1/grading/{submission['id']}", json={"fees": "99.00"})
    assert refused.status_code == 409
    assert "Undo the return" in refused.json()["detail"]


def test_a_cancelled_or_missing_submission_cannot_be_corrected(client, make_product):
    raw = make_product("Cancelled submission")
    buy(client, raw["id"], 1, "10.00")
    submission = send(client, raw["id"])
    client.post(f"/api/v1/grading/{submission['id']}/void", json={"reason": "never sent"})

    assert client.patch(f"/api/v1/grading/{submission['id']}", json={}).status_code == 409
    assert client.patch(f"/api/v1/grading/{uuid.uuid4()}", json={}).status_code == 404
    assert (
        client.patch(f"/api/v1/grading/{submission['id']}", json={"quantity": None}).status_code
        == 422
    )


def test_undoing_a_return_puts_the_card_back_at_the_grader(client, make_product):
    """A return recorded against the wrong slab can be undone and recorded again."""
    raw = make_product("Returned to the wrong slab")
    wrong = make_product("Wrong slab")
    right = make_product("Right slab")
    buy(client, raw["id"], 1, "10.00")
    submission = send(client, raw["id"], fees="20.00")
    take_back(client, submission["id"], wrong["id"], grade="8")

    produced = client.get("/api/v1/transformations", params={"product_id": wrong["id"]}).json()
    undone = client.post(
        f"/api/v1/transformations/{produced[0]['id']}/void", json={"reason": "wrong slab"}
    )
    assert undone.status_code == 200, undone.text

    listed = client.get("/api/v1/grading", params={"product_id": raw["id"]}).json()
    assert listed[0]["status"] == "out"
    assert listed[0]["grade"] is None
    assert listed[0]["returned_on"] is None
    assert stats(client, raw["id"])["quantity_on_hand"] == 1

    take_back(client, submission["id"], right["id"], grade="9")
    assert stats(client, right["id"])["quantity_on_hand"] == 1
    assert stats(client, right["id"])["remaining_cost"] == "30.00"
    assert stats(client, wrong["id"])["quantity_on_hand"] == 0


# ------------------------------------------------------------------- rips, cracks


def rip(client, box_id, hits, **extra) -> dict:
    response = client.post(
        "/api/v1/transformations/rip", json={"product_id": box_id, "hits": hits, **extra}
    )
    assert response.status_code == 201, response.text
    return response.json()


def crack(client, case_id, outputs, **extra) -> dict:
    response = client.post(
        "/api/v1/transformations/crack",
        json={"product_id": case_id, "outputs": outputs, **extra},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_a_rip_reports_what_each_hit_was_valued_at(client, make_product):
    box = make_product("Valued rip box")
    hit = make_product("Valued rip hit")
    buy(client, box["id"], 1, "100.00")

    recorded = rip(client, box["id"], [{"product_id": hit["id"], "value": "250.00"}])

    assert recorded["outputs"][0]["value"] == "250.00"


def test_a_rip_can_be_corrected(client, db, make_product):
    box = make_product("Misrecorded box")
    hit = make_product("The hit")
    missed = make_product("The one that was forgotten")
    buy(client, box["id"], 2, "200.00")
    recorded = rip(client, box["id"], [{"product_id": hit["id"], "value": "50.00"}])

    response = client.put(
        f"/api/v1/transformations/{recorded['id']}/rip",
        json={
            "product_id": box["id"],
            "quantity": 2,
            "hits": [
                {"product_id": hit["id"], "value": "300.00"},
                {"product_id": missed["id"], "value": "100.00", "bucket": "vault"},
            ],
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] != recorded["id"]
    assert body["source_quantity"] == 2
    assert body["source_cost"] == "200.00"
    assert {row["product_name"]: row["cost"] for row in body["outputs"]} == {
        "The hit": "150.00",
        "The one that was forgotten": "50.00",
    }
    assert stats(client, box["id"])["quantity_on_hand"] == 0
    assert stats(client, hit["id"])["quantity_on_hand"] == 1
    assert buckets(client, missed["id"])["vault"] == 1

    # The old estimate goes with the old rip, so the hit is not valued twice on one day.
    estimates = db.scalars(
        select(PriceSnapshot.value_cents).where(PriceSnapshot.product_id == uuid.UUID(hit["id"]))
    ).all()
    assert estimates == [30000]

    history = client.get("/api/v1/transformations", params={"product_id": box["id"]}).json()
    assert sorted(row["status"] for row in history) == ["active", "voided"]


def test_a_corrected_rip_cannot_drop_a_hit_that_was_already_sold(client, db, make_product):
    box = make_product("Box with a sold hit")
    hit = make_product("Sold hit")
    buy(client, box["id"], 1, "100.00")
    recorded = rip(client, box["id"], [{"product_id": hit["id"], "value": "50.00"}])
    sell(client, hit["id"], 1)

    response = client.put(
        f"/api/v1/transformations/{recorded['id']}/rip",
        json={"product_id": box["id"], "hits": []},
    )

    assert response.status_code == 409
    assert "already been sold" in response.json()["detail"]
    # Nothing was written: the original rip is still the record.
    history = client.get("/api/v1/transformations", params={"product_id": box["id"]}).json()
    assert [row["status"] for row in history] == ["active"]
    assert db.scalar(select(func.count()).select_from(PriceSnapshot)) == 1


def test_a_case_crack_can_be_corrected(client, make_product):
    case = make_product("Miscounted case")
    box = make_product("Miscounted box")
    buy(client, case["id"], 1, "600.00")
    recorded = crack(client, case["id"], [{"product_id": box["id"], "quantity": 4}])

    response = client.put(
        f"/api/v1/transformations/{recorded['id']}/crack",
        json={
            "product_id": case["id"],
            "outputs": [
                {"product_id": box["id"], "quantity": 4, "bucket": "store"},
                {"product_id": box["id"], "quantity": 2, "bucket": "vault"},
            ],
        },
    )

    assert response.status_code == 200, response.text
    assert buckets(client, box["id"]) == {"inventory": 0, "store": 4, "vault": 2}
    assert stats(client, box["id"])["remaining_cost"] == "600.00"
    assert stats(client, case["id"])["quantity_on_hand"] == 0
    assert all(row["value"] is None for row in response.json()["outputs"])


def test_a_correction_has_to_match_what_is_being_corrected(client, make_product):
    case = make_product("Kind mismatch case")
    box = make_product("Kind mismatch box")
    buy(client, case["id"], 1, "600.00")
    recorded = crack(client, case["id"], [{"product_id": box["id"], "quantity": 6}])
    payload = {"product_id": case["id"], "hits": []}

    wrong_kind = client.put(f"/api/v1/transformations/{recorded['id']}/rip", json=payload)
    assert wrong_kind.status_code == 409
    assert wrong_kind.json()["detail"] == "This is not a rip"

    missing = client.put(f"/api/v1/transformations/{uuid.uuid4()}/rip", json=payload)
    assert missing.status_code == 404

    client.post(f"/api/v1/transformations/{recorded['id']}/void", json={"reason": "undo"})
    voided = client.put(
        f"/api/v1/transformations/{recorded['id']}/crack",
        json={"product_id": case["id"], "outputs": [{"product_id": box["id"], "quantity": 6}]},
    )
    assert voided.status_code == 409


def test_a_refused_correction_leaves_the_original_alone(client, make_product):
    case = make_product("Only one case")
    box = make_product("Only one case box")
    buy(client, case["id"], 1, "600.00")
    recorded = crack(client, case["id"], [{"product_id": box["id"], "quantity": 6}])

    response = client.put(
        f"/api/v1/transformations/{recorded['id']}/crack",
        json={
            "product_id": case["id"],
            "quantity": 2,
            "outputs": [{"product_id": box["id"], "quantity": 12}],
        },
    )

    assert response.status_code == 409
    assert stats(client, box["id"])["quantity_on_hand"] == 6


# ------------------------------------------------------------------------ renames

TAXONOMY_ROUTES = ["/api/v1/games", "/api/v1/product-types"]


@pytest.mark.parametrize("route", TAXONOMY_ROUTES)
def test_a_game_or_type_can_be_renamed_and_keeps_its_slug(client, route: str):
    created = client.post(route, json={"name": "Weis Schwarz"}).json()

    response = client.patch(f"{route}/{created['id']}", json={"name": " Weiss Schwarz "})

    assert response.status_code == 200, response.text
    assert response.json()["name"] == "Weiss Schwarz"
    assert response.json()["slug"] == "weis-schwarz"
    # Fixing only the capitalisation of its own name is not a clash with itself.
    recased = client.patch(f"{route}/{created['id']}", json={"name": "WEISS SCHWARZ"})
    assert recased.status_code == 200


@pytest.mark.parametrize("route", TAXONOMY_ROUTES)
def test_a_rename_cannot_take_a_name_that_is_in_use(client, route: str):
    first = client.post(route, json={"name": "Flesh and Blood X"}).json()
    client.post(route, json={"name": "Grand Archive X"})

    response = client.patch(f"{route}/{first['id']}", json={"name": "grand archive x"})

    assert response.status_code == 409
    assert "Grand Archive X" in response.json()["detail"]


@pytest.mark.parametrize("route", TAXONOMY_ROUTES)
def test_a_rename_needs_a_real_name_and_a_real_record(client, route: str):
    created = client.post(route, json={"name": "Renamable"}).json()

    assert client.patch(f"{route}/{created['id']}", json={"name": "!!!"}).status_code == 422
    assert client.patch(f"{route}/{created['id']}", json={"name": "   "}).status_code == 422
    assert client.patch(f"{route}/{uuid.uuid4()}", json={"name": "Anything"}).status_code == 404


def test_renaming_a_set_follows_through_to_its_products(client, make_product):
    product = make_product("Misspelt set box", set_name="Fabeld")
    other = make_product("Another misspelt set box", set_name="Fabeld")

    response = client.patch(f"/api/v1/sets/{product['set_id']}", json={"name": " Fabled "})

    assert response.status_code == 200, response.text
    assert response.json()["name"] == "Fabled"
    assert response.json()["uses"] == 2
    for created in (product, other):
        assert client.get(f"/api/v1/products/{created['id']}").json()["set_name"] == "Fabled"
    found = client.get("/api/v1/products", params={"q": "Fabled"}).json()
    assert {row["name"] for row in found["items"]} >= {"Misspelt set box"}


def test_a_set_cannot_be_renamed_onto_another_set(client, make_product):
    product = make_product("Set clash box", set_name="Clash One")
    make_product("Set clash other", set_name="Clash Two")

    response = client.patch(f"/api/v1/sets/{product['set_id']}", json={"name": "clash two"})

    assert response.status_code == 409
    assert "Clash Two" in response.json()["detail"]


def test_a_set_rename_needs_a_name_and_a_set(client, make_product):
    product = make_product("Blank set rename", set_name="Stays Put")

    assert client.patch(f"/api/v1/sets/{product['set_id']}", json={"name": "  "}).status_code == 422
    assert client.patch(f"/api/v1/sets/{uuid.uuid4()}", json={"name": "Nothing"}).status_code == 404


def test_a_move_voided_mid_correction_is_refused(client, db, make_product, monkeypatch):
    """The move is re-read after the product lock, so a concurrent void wins."""
    product = make_product("Raced move")
    buy(client, product["id"], 1, "10.00")
    moved = move(client, product["id"], 1, "inventory", "store")
    real_refresh = Session.refresh

    def refresh(session, instance, *args, **kwargs):
        if session is db and isinstance(instance, StockMove):
            instance.status = STATUS_VOIDED
            return None
        return real_refresh(session, instance, *args, **kwargs)

    monkeypatch.setattr(Session, "refresh", refresh)

    response = client.patch(f"/api/v1/moves/{moved['id']}", json={"notes": "stale edit"})

    assert response.status_code == 409
    assert "voided" in response.json()["detail"]


def test_a_submission_can_have_its_grader_cleared(client, make_product):
    raw = make_product("Grader unknown after all")
    buy(client, raw["id"], 1, "10.00")
    submission = send(client, raw["id"], grading_company="PSA")

    response = client.patch(f"/api/v1/grading/{submission['id']}", json={"grading_company": None})

    assert response.status_code == 200
    assert response.json()["grading_company"] is None
