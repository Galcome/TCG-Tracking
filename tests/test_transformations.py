"""Cracking a case open.

Two invariants matter more than anything else here, and both exist so that later reports
can be trusted rather than because anyone would notice them today.

**Cost is conserved.** A $900 case becomes $900 of boxes. Not $1,800 of spending, and not
$900 written off - the money moved, it did not double and it did not evaporate.

**The date travels.** Boxes inherit the case's purchase date, not the day it was opened.
Cracking a case on its first birthday must not produce six brand-new boxes; the money has
been asleep for a year either way.
"""

import uuid
from datetime import date, timedelta

from src.models.ledger import BUCKET_INVENTORY, BUCKET_STORE, BUCKET_VAULT

TODAY = date.today()
LAST_YEAR = TODAY - timedelta(days=365)


def stats(client, product_id) -> dict:
    return client.get(f"/api/v1/products/{product_id}").json()["stats"]


def buy(client, product_id, quantity, amount, on=None, bucket=BUCKET_INVENTORY):
    response = client.post(
        "/api/v1/purchases",
        json={
            "product_id": product_id,
            "quantity": quantity,
            "amount": amount,
            "bucket": bucket,
            "purchase_date": (on or TODAY).isoformat(),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def crack(client, case_id, outputs, **extra):
    return client.post(
        "/api/v1/transformations/crack",
        json={"product_id": case_id, "outputs": outputs, **extra},
    )


# ------------------------------------------------------------------ the arithmetic


def test_a_case_becomes_its_boxes(client, make_product):
    case = make_product("Fabled Case")
    box = make_product("Fabled Box")
    buy(client, case["id"], 1, "900.00")

    response = crack(client, case["id"], [{"product_id": box["id"], "quantity": 6}])
    assert response.status_code == 201, response.text

    assert stats(client, case["id"])["quantity_on_hand"] == 0
    assert stats(client, box["id"])["quantity_on_hand"] == 6


def test_the_cost_moves_and_does_not_double(client, make_product):
    """A $900 case becomes $900 of boxes. The group did not spend $1,800."""
    case = make_product("Costed Case")
    box = make_product("Costed Box")
    buy(client, case["id"], 1, "900.00")

    crack(client, case["id"], [{"product_id": box["id"], "quantity": 6}])

    assert stats(client, case["id"])["remaining_cost"] == "0.00"
    assert stats(client, box["id"])["remaining_cost"] == "900.00"


def test_money_out_still_says_what_was_actually_spent(client, make_product):
    """The whole reason derived purchases are flagged."""
    case = make_product("Dashboard Case")
    box = make_product("Dashboard Box")
    before = client.get("/api/v1/dashboard").json()["total_invested"]
    buy(client, case["id"], 1, "900.00")
    after_buying = client.get("/api/v1/dashboard").json()["total_invested"]
    assert float(after_buying) == float(before) + 900

    crack(client, case["id"], [{"product_id": box["id"], "quantity": 6}])

    assert client.get("/api/v1/dashboard").json()["total_invested"] == after_buying


def test_a_cracked_case_is_not_a_write_off(client, make_product):
    """Its cost did not evaporate. Reporting it as a loss would be a different claim."""
    case = make_product("Not Written Off")
    box = make_product("Not Written Off Box")
    buy(client, case["id"], 1, "600.00")

    crack(client, case["id"], [{"product_id": box["id"], "quantity": 6}])

    case_stats = stats(client, case["id"])
    assert case_stats["cost_written_off"] == "0.00"
    assert case_stats["cost_transformed"] == "600.00"


def test_a_split_that_does_not_divide_evenly_loses_no_cent(client, make_product):
    """$100 over 6 boxes is 16.67 four times and 16.66 twice, and it sums back exactly."""
    case = make_product("Odd Case")
    box = make_product("Odd Box")
    buy(client, case["id"], 1, "100.00")

    response = crack(client, case["id"], [{"product_id": box["id"], "quantity": 6}])

    shares = [float(output["cost"]) for output in response.json()["outputs"]]
    assert round(sum(shares), 2) == 100.00
    assert stats(client, box["id"])["remaining_cost"] == "100.00"


def test_a_case_of_unknown_cost_produces_boxes_of_unknown_cost(client, make_product, db):
    """Spreading a zero would claim the boxes were free, which is a different statement."""
    case = make_product("Unknown Case")
    box = make_product("Unknown Box")
    client.post(
        "/api/v1/adjustments",
        json={
            "product_id": case["id"],
            "quantity_delta": 1,
            "reason": "opening_inventory",
        },
    )

    response = crack(client, case["id"], [{"product_id": box["id"], "quantity": 6}])

    assert response.json()["source_cost"] is None
    assert all(output["cost"] is None for output in response.json()["outputs"])


# ------------------------------------------------------------------------ the date


def test_the_boxes_inherit_the_case_s_purchase_date(client, make_product):
    """Cracking must not reset the ageing clock. This is the invariant UC2 rests on."""
    case = make_product("Old Case")
    box = make_product("Old Box")
    buy(client, case["id"], 1, "900.00", on=LAST_YEAR)

    response = crack(client, case["id"], [{"product_id": box["id"], "quantity": 6}])

    assert response.json()["inherited_purchase_date"] == LAST_YEAR.isoformat()
    history = client.get(f"/api/v1/products/{box['id']}").json()["history"]
    produced = next(row for row in history if row["kind"] == "purchase")
    assert produced["occurred_on"] == LAST_YEAR.isoformat()


def test_the_boxes_are_as_old_as_the_case_in_the_ageing_report(client, make_product):
    case = make_product("Ageing Case")
    box = make_product("Ageing Box")
    buy(client, case["id"], 1, "900.00", on=LAST_YEAR)
    crack(client, case["id"], [{"product_id": box["id"], "quantity": 6}])

    lots = client.get("/api/v1/reports/aging").json()
    mine = next(lot for lot in lots if lot["product_name"] == "Ageing Box")
    assert mine["days_held"] >= 365


def test_the_day_it_was_opened_is_recorded_separately(client, make_product):
    """Inheriting the purchase date must not lose when it actually happened."""
    case = make_product("Two Dates Case")
    box = make_product("Two Dates Box")
    buy(client, case["id"], 1, "300.00", on=LAST_YEAR)

    response = crack(
        client, case["id"], [{"product_id": box["id"], "quantity": 6}],
        occurred_on=TODAY.isoformat(),
    )

    body = response.json()
    assert body["occurred_on"] == TODAY.isoformat()
    assert body["inherited_purchase_date"] == LAST_YEAR.isoformat()


# --------------------------------------------------------------------- the buckets


def test_the_boxes_can_be_split_across_buckets_in_one_step(client, make_product):
    """Joseph's example: 6 boxes out of a case, 4 to sell, 1 held, 1 for the long game."""
    case = make_product("Split Case")
    box = make_product("Split Box")
    buy(client, case["id"], 1, "900.00")

    response = crack(
        client,
        case["id"],
        [
            {"product_id": box["id"], "quantity": 4, "bucket": BUCKET_STORE},
            {"product_id": box["id"], "quantity": 1, "bucket": BUCKET_INVENTORY},
            {"product_id": box["id"], "quantity": 1, "bucket": BUCKET_VAULT},
        ],
    )
    assert response.status_code == 201, response.text

    assert stats(client, box["id"])["by_bucket"] == {
        BUCKET_INVENTORY: 1,
        BUCKET_STORE: 4,
        BUCKET_VAULT: 1,
    }


def test_a_case_can_be_opened_out_of_the_store(client, make_product):
    case = make_product("Store Case")
    box = make_product("Store Box")
    buy(client, case["id"], 1, "500.00", bucket=BUCKET_STORE)

    response = crack(
        client,
        case["id"],
        [{"product_id": box["id"], "quantity": 6}],
        from_bucket=BUCKET_STORE,
    )
    assert response.status_code == 201, response.text
    assert stats(client, case["id"])["by_bucket"][BUCKET_STORE] == 0


def test_the_same_product_and_bucket_cannot_appear_twice(client, make_product):
    case = make_product("Duplicate Case")
    box = make_product("Duplicate Box")
    buy(client, case["id"], 1, "500.00")

    response = crack(
        client,
        case["id"],
        [
            {"product_id": box["id"], "quantity": 2, "bucket": BUCKET_STORE},
            {"product_id": box["id"], "quantity": 4, "bucket": BUCKET_STORE},
        ],
    )
    assert response.status_code == 422


# ------------------------------------------------------------------------ refusals


def test_a_case_you_do_not_have_cannot_be_opened(client, make_product):
    """Unlike overselling, this describes nothing that happened."""
    case = make_product("Absent Case")
    box = make_product("Absent Box")

    response = crack(client, case["id"], [{"product_id": box["id"], "quantity": 6}])

    assert response.status_code == 409
    assert "holds 0" in response.json()["detail"]


def test_opening_out_of_the_wrong_bucket_is_refused(client, make_product):
    case = make_product("Wrong Bucket Case")
    box = make_product("Wrong Bucket Box")
    buy(client, case["id"], 1, "500.00", bucket=BUCKET_VAULT)

    response = crack(
        client,
        case["id"],
        [{"product_id": box["id"], "quantity": 6}],
        from_bucket=BUCKET_STORE,
    )
    assert response.status_code == 409


def test_a_case_cannot_come_out_of_itself(client, make_product):
    case = make_product("Recursive Case")
    buy(client, case["id"], 1, "500.00")

    response = crack(client, case["id"], [{"product_id": case["id"], "quantity": 6}])
    assert response.status_code == 422


def test_opening_a_product_that_does_not_exist_is_a_404(client, make_product):
    box = make_product("Orphan Box")
    response = crack(client, str(uuid.uuid4()), [{"product_id": box["id"], "quantity": 6}])
    assert response.status_code == 404


def test_producing_a_product_that_does_not_exist_is_a_404(client, make_product):
    case = make_product("Real Case")
    buy(client, case["id"], 1, "500.00")

    response = crack(client, case["id"], [{"product_id": str(uuid.uuid4()), "quantity": 6}])
    assert response.status_code == 404


def test_at_least_one_output_is_required(client, make_product):
    case = make_product("Empty Case")
    buy(client, case["id"], 1, "500.00")

    assert crack(client, case["id"], []).status_code == 422


# ------------------------------------------------------------------------ undoing


def test_voiding_puts_the_case_back_and_takes_the_boxes_away(client, make_product):
    case = make_product("Undo Case")
    box = make_product("Undo Box")
    buy(client, case["id"], 1, "900.00")
    created = crack(client, case["id"], [{"product_id": box["id"], "quantity": 6}]).json()

    response = client.post(
        f"/api/v1/transformations/{created['id']}/void", json={"reason": "wrong case"}
    )
    assert response.status_code == 200

    assert stats(client, case["id"])["quantity_on_hand"] == 1
    assert stats(client, case["id"])["remaining_cost"] == "900.00"
    assert stats(client, box["id"])["quantity_on_hand"] == 0


def test_it_cannot_be_voided_twice(client, make_product):
    case = make_product("Twice Case")
    box = make_product("Twice Box")
    buy(client, case["id"], 1, "900.00")
    created = crack(client, case["id"], [{"product_id": box["id"], "quantity": 6}]).json()

    client.post(f"/api/v1/transformations/{created['id']}/void", json={"reason": "one"})
    again = client.post(
        f"/api/v1/transformations/{created['id']}/void", json={"reason": "two"}
    )
    assert again.status_code == 409


def test_voiding_something_that_does_not_exist_is_a_404(client):
    response = client.post(
        f"/api/v1/transformations/{uuid.uuid4()}/void", json={"reason": "x"}
    )
    assert response.status_code == 404


# ------------------------------------------------------------------------ parentage


def test_what_came_out_of_what_is_recorded(client, make_product):
    """Without this the lineage rollup cannot be reconstructed at all."""
    case = make_product("Lineage Case")
    box = make_product("Lineage Box")
    buy(client, case["id"], 1, "900.00")
    crack(client, case["id"], [{"product_id": box["id"], "quantity": 6}], notes="opened it")

    found = client.get(
        "/api/v1/transformations", params={"product_id": case["id"]}
    ).json()
    assert len(found) == 1
    assert found[0]["source_product_name"] == "Lineage Case"
    assert found[0]["outputs"][0]["product_name"] == "Lineage Box"
    assert found[0]["notes"] == "opened it"


def test_a_product_can_be_asked_what_it_came_out_of(client, make_product):
    case = make_product("Parent Case")
    box = make_product("Child Box")
    buy(client, case["id"], 1, "900.00")
    crack(client, case["id"], [{"product_id": box["id"], "quantity": 6}])

    found = client.get("/api/v1/transformations", params={"product_id": box["id"]}).json()
    assert [row["source_product_name"] for row in found] == ["Parent Case"]


def test_the_whole_list_is_available(client, make_product):
    case = make_product("Listed Case")
    box = make_product("Listed Box")
    buy(client, case["id"], 1, "900.00")
    crack(client, case["id"], [{"product_id": box["id"], "quantity": 6}])

    assert len(client.get("/api/v1/transformations").json()) >= 1


def test_a_case_that_has_been_opened_cannot_be_deleted(client, make_product):
    """It is history now, and deleting the product would orphan it."""
    case = make_product("Historic Case")
    box = make_product("Historic Box")
    buy(client, case["id"], 1, "900.00")
    crack(client, case["id"], [{"product_id": box["id"], "quantity": 6}])

    assert client.delete(f"/api/v1/products/{case['id']}").status_code == 409


def test_a_blank_note_is_stored_as_nothing(client, make_product):
    case = make_product("Noteless Case")
    box = make_product("Noteless Box")
    buy(client, case["id"], 1, "300.00")

    response = crack(
        client, case["id"], [{"product_id": box["id"], "quantity": 6}], notes=None
    )
    assert response.json()["notes"] is None
