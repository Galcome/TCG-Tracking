"""Ripping a box open.

A box is a lottery, not a division. Thirty-six packs make roughly 360 cards and three of
them matter, so cost is shared in proportion to what the hits are worth rather than evenly
- an even split would price a $10 card the same as a $500 one and make per-card ROI say
nothing at all.

Two things this file guards hardest:

**Estimates never touch cost basis or realized profit.** The value typed at rip time decides
how the box's cost is shared and is kept as a dated snapshot. It is not the cost, it is not
profit, and it never becomes either. Otherwise the group is marking its own homework.

**Bulk is written off where it happens.** The leftovers are not an asset - nobody would ever
rip something in order to sell the bulk - so a bad rip looks bad immediately.
"""

import uuid
from datetime import date, timedelta

from sqlalchemy import func, select

from src.models.price_snapshot import PriceSnapshot

TODAY = date.today()


def stats(client, product_id) -> dict:
    return client.get(f"/api/v1/products/{product_id}").json()["stats"]


def buy(client, product_id, quantity, amount, on=None):
    response = client.post(
        "/api/v1/purchases",
        json={
            "product_id": product_id,
            "quantity": quantity,
            "amount": amount,
            "purchase_date": (on or TODAY).isoformat(),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def rip(client, box_id, hits, **extra):
    return client.post(
        "/api/v1/transformations/rip",
        json={"product_id": box_id, "hits": hits, **extra},
    )


# --------------------------------------------------------------- proportional cost


def test_cost_follows_what_the_hits_are_worth(client, make_product):
    """Joseph's example: $500, $50 and $10 out of a $150 box come to $134, $13 and $3."""
    box = make_product("Rip Box")
    big = make_product("The Iconic")
    middle = make_product("A Decent One")
    small = make_product("Nearly Nothing")
    buy(client, box["id"], 1, "150.00")

    response = rip(
        client,
        box["id"],
        [
            {"product_id": big["id"], "value": "500.00"},
            {"product_id": middle["id"], "value": "50.00"},
            {"product_id": small["id"], "value": "10.00"},
        ],
    )
    assert response.status_code == 201, response.text

    shares = {row["product_name"]: row["cost"] for row in response.json()["outputs"]}
    assert shares["The Iconic"] == "133.93"
    assert shares["A Decent One"] == "13.39"
    assert shares["Nearly Nothing"] == "2.68"


def test_the_shares_add_back_up_to_the_box(client, make_product):
    box = make_product("Exact Box")
    first = make_product("Exact Hit A")
    second = make_product("Exact Hit B")
    buy(client, box["id"], 1, "100.00")

    response = rip(
        client,
        box["id"],
        [
            {"product_id": first["id"], "value": "1.00"},
            {"product_id": second["id"], "value": "2.00"},
        ],
    )

    shares = [float(row["cost"]) for row in response.json()["outputs"]]
    assert round(sum(shares), 2) == 100.00
    assert response.json()["bulk_cost"] == "0.00"


def test_the_big_hit_carries_the_risk_it_earned(client, make_product):
    """Selling it for $560 has to read as +$410 on a $150 box, not +$560 out of nowhere."""
    box = make_product("Risk Box")
    hit = make_product("Risk Hit")
    buy(client, box["id"], 1, "150.00")
    rip(client, box["id"], [{"product_id": hit["id"], "value": "500.00"}])

    client.post(
        "/api/v1/sales",
        json={"product_id": hit["id"], "quantity": 1, "amount": "560.00"},
    )

    assert stats(client, hit["id"])["realized_profit"] == "410.00"


def test_hits_with_no_values_share_it_evenly(client, make_product):
    """A box has to land somewhere. Refusing the rip because nobody typed a number is worse."""
    box = make_product("Valueless Box")
    first = make_product("Valueless Hit A")
    second = make_product("Valueless Hit B")
    buy(client, box["id"], 1, "100.00")

    response = rip(
        client,
        box["id"],
        [{"product_id": first["id"]}, {"product_id": second["id"]}],
    )

    shares = sorted(row["cost"] for row in response.json()["outputs"])
    assert shares == ["50.00", "50.00"]


def test_an_explicit_cost_wins_over_the_proportional_one(client, make_product):
    box = make_product("Override Box")
    hit = make_product("Override Hit")
    buy(client, box["id"], 1, "150.00")

    response = rip(
        client,
        box["id"],
        [{"product_id": hit["id"], "value": "500.00", "cost": "150.00"}],
    )

    assert response.json()["outputs"][0]["cost"] == "150.00"


def test_hit_quantity_weights_cost_but_keeps_a_per_unit_value(client, make_product, db):
    box = make_product("Quantity Weighted Box")
    doubled = make_product("Two Ten Dollar Hits")
    single = make_product("One Twenty Dollar Hit")
    buy(client, box["id"], 1, "120.00")

    response = rip(
        client,
        box["id"],
        [
            {"product_id": doubled["id"], "quantity": 2, "value": "10.00"},
            {"product_id": single["id"], "quantity": 1, "value": "20.00"},
        ],
    )

    costs = {row["product_id"]: row["cost"] for row in response.json()["outputs"]}
    assert costs == {doubled["id"]: "60.00", single["id"]: "60.00"}

    snapshot = db.scalars(
        select(PriceSnapshot).where(PriceSnapshot.product_id == uuid.UUID(doubled["id"]))
    ).one()
    assert snapshot.value_cents == 1000


# ---------------------------------------------------------------------------- bulk


def test_what_the_hits_do_not_take_is_written_off(client, make_product):
    box = make_product("Bulk Box")
    hit = make_product("Bulk Hit")
    buy(client, box["id"], 1, "150.00")

    response = rip(
        client, box["id"], [{"product_id": hit["id"], "value": "500.00", "cost": "100.00"}]
    )

    assert response.json()["bulk_cost"] == "50.00"


def test_bulk_is_a_write_off_and_not_a_transformation(client, make_product):
    """The distinction the dashboard shows. Bulk really is gone; the hits really did move."""
    box = make_product("Labelled Box")
    hit = make_product("Labelled Hit")
    buy(client, box["id"], 1, "150.00")
    rip(client, box["id"], [{"product_id": hit["id"], "value": "500.00", "cost": "100.00"}])

    box_stats = stats(client, box["id"])
    assert box_stats["cost_written_off"] == "50.00"
    assert box_stats["cost_transformed"] == "100.00"


def test_a_rip_with_nothing_worth_keeping_is_allowed(client, make_product):
    """The honest record of a bad one: the box is gone and all of it is a write-off."""
    box = make_product("Nothing Box")
    buy(client, box["id"], 1, "150.00")

    response = rip(client, box["id"], [])
    assert response.status_code == 201, response.text

    assert response.json()["bulk_cost"] == "150.00"
    assert stats(client, box["id"])["quantity_on_hand"] == 0
    assert stats(client, box["id"])["cost_written_off"] == "150.00"


def test_a_bulk_sale_later_has_revenue_and_no_roi(client, make_product):
    """Zero cost is not unknown cost. It counts at full margin and simply has no ratio."""
    bulk = make_product("Facebook Bundle")
    client.post(
        "/api/v1/adjustments",
        json={"product_id": bulk["id"], "quantity_delta": 1, "reason": "correction", "cost": "0"},
    )
    client.post(
        "/api/v1/sales",
        json={"product_id": bulk["id"], "quantity": 1, "amount": "40.00"},
    )

    bulk_stats = stats(client, bulk["id"])
    assert bulk_stats["realized_profit"] == "40.00"
    assert bulk_stats["roi"] is None


# ----------------------------------------------------------------- the value journey


def test_the_typed_value_is_kept_as_a_dated_estimate(client, make_product, db):
    box = make_product("Snapshot Box")
    hit = make_product("Snapshot Hit")
    buy(client, box["id"], 1, "150.00")

    rip(
        client,
        box["id"],
        [{"product_id": hit["id"], "value": "50.00"}],
        occurred_on=TODAY.isoformat(),
    )

    snapshot = db.scalars(
        select(PriceSnapshot).where(PriceSnapshot.product_id == uuid.UUID(hit["id"]))
    ).one()
    assert snapshot.value_cents == 5000
    assert snapshot.captured_on == TODAY
    assert snapshot.source == "typed"


def test_the_estimate_never_becomes_the_cost(client, make_product):
    """"Down $100 on the day" is a true statement of that day, and it is not a loss.

    Cost basis is what the box really cost. The $50 someone typed is an estimate, and if it
    moved profit the group would be scoring its own guesses.
    """
    box = make_product("Journey Box")
    hit = make_product("Journey Hit")
    buy(client, box["id"], 1, "150.00")

    rip(client, box["id"], [{"product_id": hit["id"], "value": "50.00"}])

    hit_stats = stats(client, hit["id"])
    # The whole box, because it was the only hit - not the $50 that was typed.
    assert hit_stats["remaining_cost"] == "150.00"
    assert hit_stats["realized_profit"] == "0.00"


def test_the_journey_ends_with_the_real_number(client, make_product):
    """Estimated at $50, sold at $1,500, against the $150 the box actually cost."""
    box = make_product("Long Journey Box")
    hit = make_product("Long Journey Hit")
    buy(client, box["id"], 1, "150.00", on=TODAY - timedelta(days=400))
    rip(client, box["id"], [{"product_id": hit["id"], "value": "50.00"}])

    client.post(
        "/api/v1/sales",
        json={"product_id": hit["id"], "quantity": 1, "amount": "1500.00"},
    )

    assert stats(client, hit["id"])["realized_profit"] == "1350.00"


def test_the_hit_is_as_old_as_the_box(client, make_product):
    box = make_product("Dated Box")
    hit = make_product("Dated Hit")
    long_ago = TODAY - timedelta(days=200)
    buy(client, box["id"], 1, "150.00", on=long_ago)

    response = rip(client, box["id"], [{"product_id": hit["id"], "value": "50.00"}])

    assert response.json()["inherited_purchase_date"] == long_ago.isoformat()


# ------------------------------------------------------------------------ refusals


def test_a_box_you_do_not_have_cannot_be_ripped(client, make_product):
    box = make_product("Missing Box")
    hit = make_product("Missing Hit")

    response = rip(client, box["id"], [{"product_id": hit["id"], "value": "10.00"}])
    assert response.status_code == 409


def test_a_box_cannot_be_a_hit_out_of_itself(client, make_product):
    box = make_product("Ouroboros Box")
    buy(client, box["id"], 1, "150.00")

    response = rip(client, box["id"], [{"product_id": box["id"], "value": "10.00"}])
    assert response.status_code == 422


def test_a_hit_that_does_not_exist_is_a_404(client, make_product):
    box = make_product("Real Rip Box")
    buy(client, box["id"], 1, "150.00")

    response = rip(client, box["id"], [{"product_id": str(uuid.uuid4()), "value": "10.00"}])
    assert response.status_code == 404


def test_ripping_a_product_that_does_not_exist_is_a_404(client, make_product):
    hit = make_product("Orphan Hit")
    response = rip(client, str(uuid.uuid4()), [{"product_id": hit["id"]}])
    assert response.status_code == 404


def test_the_same_hit_cannot_appear_twice_in_one_bucket(client, make_product):
    box = make_product("Repeat Box")
    hit = make_product("Repeat Hit")
    buy(client, box["id"], 1, "150.00")

    response = rip(
        client,
        box["id"],
        [
            {"product_id": hit["id"], "value": "10.00"},
            {"product_id": hit["id"], "value": "20.00"},
        ],
    )
    assert response.status_code == 422


def test_a_blank_note_is_stored_as_nothing(client, make_product):
    box = make_product("Unnoted Box")
    hit = make_product("Unnoted Hit")
    buy(client, box["id"], 1, "150.00")

    response = rip(client, box["id"], [{"product_id": hit["id"]}], notes=None)
    assert response.json()["notes"] is None


def test_undoing_a_rip_puts_the_box_back(client, make_product):
    box = make_product("Undo Rip Box")
    hit = make_product("Undo Rip Hit")
    buy(client, box["id"], 1, "150.00")
    created = rip(client, box["id"], [{"product_id": hit["id"], "value": "50.00"}]).json()

    client.post(
        f"/api/v1/transformations/{created['id']}/void", json={"reason": "wrong box"}
    )

    assert stats(client, box["id"])["quantity_on_hand"] == 1
    assert stats(client, box["id"])["cost_written_off"] == "0.00"
    assert stats(client, hit["id"])["quantity_on_hand"] == 0


def test_a_ripped_box_of_unknown_cost_writes_nothing_off(client, make_product, db):
    """Unknown is not zero, and it is not a loss either."""
    box = make_product("Unknown Rip Box")
    hit = make_product("Unknown Rip Hit")
    client.post(
        "/api/v1/adjustments",
        json={"product_id": box["id"], "quantity_delta": 1, "reason": "opening_inventory"},
    )

    response = rip(client, box["id"], [{"product_id": hit["id"], "value": "50.00"}])

    assert response.json()["source_cost"] is None
    assert response.json()["bulk_cost"] == "0.00"
    assert db.scalar(select(func.count()).select_from(PriceSnapshot)) >= 1


def test_a_note_survives_onto_the_rip(client, make_product):
    box = make_product("Noted Box")
    hit = make_product("Noted Hit")
    buy(client, box["id"], 1, "150.00")

    response = rip(client, box["id"], [{"product_id": hit["id"]}], notes="  hit the Iconic  ")
    assert response.json()["notes"] == "hit the Iconic"
