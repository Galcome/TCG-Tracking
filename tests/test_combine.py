"""Combining products into one: a whole set of singles sold as a single unit.

The mirror image of a crack, and the same two invariants matter.

**Cost is conserved.** Two hundred cards that cost $300 become one bundle that cost $300.
Selling the bundle later reports the same profit selling the cards would have.

**It can be undone.** Breaking the bundle apart puts every card back where it came from,
with its own cost, because the cards were only ever consumed by ordinary adjustments.
"""

import uuid
from datetime import date, timedelta

from sqlalchemy import select

from src.models.ledger import StockMove
from src.models.price_snapshot import PriceSnapshot
from src.models.taxonomy import Game, ProductType

TODAY = date.today()
LAST_YEAR = TODAY - timedelta(days=365)


def stats(client, product_id) -> dict:
    return client.get(f"/api/v1/products/{product_id}").json()["stats"]


def buy(client, product_id, quantity, amount, on=None, bucket="inventory"):
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


def value(client, product_id, amount):
    response = client.post(
        "/api/v1/valuations",
        json={"product_id": product_id, "value": amount, "captured_on": TODAY.isoformat()},
    )
    assert response.status_code == 201, response.text


def collection_type(db) -> str:
    return str(db.scalar(select(ProductType.id).where(ProductType.slug == "collection")))


def combine(client, db, inputs, **extra):
    return client.post(
        "/api/v1/transformations/combine",
        json={
            "name": "151 Master Set",
            "product_type_id": collection_type(db),
            "inputs": inputs,
            **extra,
        },
    )


def preview(client, inputs):
    return client.post("/api/v1/transformations/combine/preview", json={"inputs": inputs})


def two_cards(client, make_product):
    """Two cards: 2 of one at $10 total, 1 of another at $5."""
    mew = make_product("Mew 151/165")
    charizard = make_product("Charizard ex 199/165")
    buy(client, mew["id"], 2, "10.00")
    buy(client, charizard["id"], 1, "5.00")
    return mew, charizard


# ------------------------------------------------------------------ the arithmetic


def test_the_cards_become_one_bundle_carrying_their_cost(client, db, make_product):
    mew, charizard = two_cards(client, make_product)

    response = combine(
        client,
        db,
        [{"product_id": mew["id"], "quantity": 2}, {"product_id": charizard["id"]}],
    )
    assert response.status_code == 201, response.text
    body = response.json()

    assert body["kind"] == "combine"
    assert body["source_product_id"] is None
    assert body["source_product_name"] is None
    assert body["source_bucket"] is None
    assert body["source_quantity"] == 3
    assert body["source_cost"] == "15.00"
    assert [(row["product_name"], row["quantity"], row["cost"]) for row in body["inputs"]] == [
        ("Charizard ex 199/165", 1, "5.00"),
        ("Mew 151/165", 2, "10.00"),
    ]
    [bundle] = body["outputs"]
    assert bundle["product_name"] == "151 Master Set"
    assert bundle["quantity"] == 1
    assert bundle["cost"] == "15.00"

    assert stats(client, mew["id"])["quantity_on_hand"] == 0
    assert stats(client, charizard["id"])["quantity_on_hand"] == 0
    assert stats(client, bundle["product_id"])["quantity_on_hand"] == 1
    assert stats(client, bundle["product_id"])["remaining_cost"] == "15.00"


def test_part_of_a_stack_can_go_in(client, db, make_product):
    mew, _ = two_cards(client, make_product)

    response = combine(client, db, [{"product_id": mew["id"], "quantity": 1}])
    assert response.status_code == 201, response.text

    assert stats(client, mew["id"])["quantity_on_hand"] == 1
    assert stats(client, mew["id"])["remaining_cost"] == "5.00"
    assert response.json()["outputs"][0]["cost"] == "5.00"


def test_money_out_still_says_what_was_actually_spent(client, db, make_product):
    mew, charizard = two_cards(client, make_product)
    before = client.get("/api/v1/dashboard").json()["total_invested"]

    combine(client, db, [{"product_id": mew["id"], "quantity": 2}, {"product_id": charizard["id"]}])

    assert client.get("/api/v1/dashboard").json()["total_invested"] == before


def test_the_bundle_is_dated_from_its_oldest_card(client, db, make_product):
    old = make_product("Old Card")
    new = make_product("New Card")
    buy(client, old["id"], 1, "1.00", on=LAST_YEAR)
    buy(client, new["id"], 1, "1.00")

    body = combine(client, db, [{"product_id": old["id"]}, {"product_id": new["id"]}]).json()

    assert body["inherited_purchase_date"] == LAST_YEAR.isoformat()
    assert body["occurred_on"] == TODAY.isoformat()


def test_an_unknown_cost_makes_the_bundle_cost_unknown(client, db, make_product):
    """A sum with a hole in it is not a cost, and a zero would say the cards were free."""
    known = make_product("Known Card")
    unknown = make_product("Imported Card")
    buy(client, known["id"], 1, "4.00")
    opening = client.post(
        "/api/v1/adjustments",
        json={"product_id": unknown["id"], "quantity_delta": 1, "reason": "opening_inventory"},
    )
    assert opening.status_code == 201, opening.text

    body = combine(client, db, [{"product_id": known["id"]}, {"product_id": unknown["id"]}]).json()

    assert body["source_cost"] is None
    assert body["outputs"][0]["cost"] is None
    # An undated card makes the bundle undated rather than younger than it is.
    assert body["inherited_purchase_date"] is None
    costs = {row["product_name"]: row["cost"] for row in body["inputs"]}
    assert costs == {"Known Card": "4.00", "Imported Card": None}

    sale = client.post(
        "/api/v1/sales",
        json={
            "product_id": body["outputs"][0]["product_id"],
            "quantity": 1,
            "amount": "50.00",
            "proceeds": [],
        },
    )
    assert sale.status_code == 201, sale.text
    assert sale.json()["has_unknown_cost"] is True


def test_cards_can_come_from_any_bucket_and_the_bundle_lands_where_asked(
    client, db, make_product
):
    card = make_product("Store Card")
    buy(client, card["id"], 1, "3.00", bucket="store")

    body = combine(
        client, db, [{"product_id": card["id"], "bucket": "store"}], bucket="vault"
    ).json()

    assert body["inputs"][0]["bucket"] == "store"
    assert body["outputs"][0]["bucket"] == "vault"
    bundle = client.get(f"/api/v1/products/{body['outputs'][0]['product_id']}").json()
    assert bundle["stats"]["by_bucket"]["vault"] == 1


# ------------------------------------------------------------------ the new product


def test_the_bundle_takes_the_cards_game_and_the_typed_set(client, db, make_product, game_id):
    mew, _ = two_cards(client, make_product)

    body = combine(client, db, [{"product_id": mew["id"]}], set_name="  SV: 151 ").json()

    bundle = client.get(f"/api/v1/products/{body['outputs'][0]['product_id']}").json()
    assert bundle["game"]["id"] == str(game_id)
    assert bundle["set_name"] == "SV: 151"
    assert bundle["set_id"] is not None
    assert bundle["product_type"]["slug"] == "collection"


def test_cards_from_two_games_need_the_game_named(client, db, make_product):
    pokemon_card, _ = two_cards(client, make_product)
    lorcana = db.scalar(select(Game.id).where(Game.slug == "lorcana"))
    lorcana_card = make_product("Elsa", game_id=str(lorcana))
    buy(client, lorcana_card["id"], 1, "2.00")
    inputs = [{"product_id": pokemon_card["id"]}, {"product_id": lorcana_card["id"]}]

    refused = combine(client, db, inputs)
    assert refused.status_code == 422
    assert "different games" in refused.json()["detail"]

    named = combine(client, db, inputs, game_id=str(lorcana))
    assert named.status_code == 201, named.text
    bundle = client.get(f"/api/v1/products/{named.json()['outputs'][0]['product_id']}").json()
    assert bundle["game"]["id"] == str(lorcana)


def test_an_unknown_game_or_type_is_refused(client, db, make_product):
    mew, _ = two_cards(client, make_product)
    inputs = [{"product_id": mew["id"]}]

    assert combine(client, db, inputs, game_id=str(uuid.uuid4())).status_code == 422
    assert combine(client, db, inputs, product_type_id=str(uuid.uuid4())).status_code == 422
    assert stats(client, mew["id"])["quantity_on_hand"] == 2


# ------------------------------------------------------------------ the value


def test_the_bundle_is_valued_at_what_its_cards_were_worth(client, db, make_product):
    mew, charizard = two_cards(client, make_product)
    value(client, mew["id"], "30.00")
    value(client, charizard["id"], "100.00")

    body = combine(
        client, db, [{"product_id": mew["id"], "quantity": 2}, {"product_id": charizard["id"]}]
    ).json()

    assert body["outputs"][0]["value"] == "160.00"
    bundle = client.get(f"/api/v1/products/{body['outputs'][0]['product_id']}").json()
    assert bundle["market_estimate"]["value"] == "160.00"
    # An estimate, never a cost.
    assert bundle["stats"]["remaining_cost"] == "15.00"


def test_nothing_priced_means_no_valuation_rather_than_zero(client, db, make_product):
    mew, _ = two_cards(client, make_product)

    body = combine(client, db, [{"product_id": mew["id"]}]).json()

    assert body["outputs"][0]["value"] is None
    snapshots = db.scalars(
        select(PriceSnapshot).where(
            PriceSnapshot.product_id == uuid.UUID(body["outputs"][0]["product_id"])
        )
    ).all()
    assert snapshots == []


# ------------------------------------------------------------------ the preview


def test_the_preview_adds_up_cost_and_value_without_writing(client, make_product):
    mew, charizard = two_cards(client, make_product)
    value(client, mew["id"], "30.00")

    response = preview(
        client, [{"product_id": mew["id"], "quantity": 2}, {"product_id": charizard["id"]}]
    )
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["total_cost"] == "15.00"
    assert body["has_unknown_cost"] is False
    assert body["estimated_value"] == "60.00"
    assert body["unpriced"] == 1
    assert [(row["product_name"], row["available"], row["cost"], row["value"])
            for row in body["inputs"]] == [
        ("Mew 151/165", 2, "10.00", "60.00"),
        ("Charizard ex 199/165", 1, "5.00", None),
    ]
    assert stats(client, mew["id"])["quantity_on_hand"] == 2


def test_the_preview_points_at_short_stock_and_unknown_cost(client, make_product):
    card = make_product("Imported")
    client.post(
        "/api/v1/adjustments",
        json={"product_id": card["id"], "quantity_delta": 1, "reason": "opening_inventory"},
    )

    body = preview(client, [{"product_id": card["id"], "quantity": 3}]).json()

    assert body["inputs"][0]["available"] == 1
    assert body["total_cost"] is None
    assert body["has_unknown_cost"] is True


def test_the_preview_refuses_a_product_that_does_not_exist(client):
    assert preview(client, [{"product_id": str(uuid.uuid4())}]).status_code == 404


# ------------------------------------------------------------------ refusals


def test_more_than_the_bucket_holds_is_refused_and_nothing_moves(client, db, make_product):
    mew, charizard = two_cards(client, make_product)

    response = combine(
        client, db, [{"product_id": charizard["id"]}, {"product_id": mew["id"], "quantity": 3}]
    )

    assert response.status_code == 409
    assert "Mew 151/165" in response.json()["detail"]
    assert stats(client, charizard["id"])["quantity_on_hand"] == 1


def test_a_card_that_does_not_exist_is_refused(client, db):
    assert combine(client, db, [{"product_id": str(uuid.uuid4())}]).status_code == 404


def test_the_request_shape_is_checked(client, db, make_product):
    mew, _ = two_cards(client, make_product)
    row = {"product_id": mew["id"]}

    assert combine(client, db, []).status_code == 422
    assert combine(client, db, [row, row]).status_code == 422
    assert combine(client, db, [row], name="   ").status_code == 422
    assert combine(client, db, [{**row, "quantity": 0}]).status_code == 422


def test_blank_set_and_notes_are_left_empty(client, db, make_product):
    mew, _ = two_cards(client, make_product)

    body = combine(client, db, [{"product_id": mew["id"]}], set_name=" ", notes="  ").json()

    assert body["notes"] is None
    bundle = client.get(f"/api/v1/products/{body['outputs'][0]['product_id']}").json()
    assert bundle["set_id"] is None


# ------------------------------------------------------------------ undoing it


def test_breaking_it_apart_puts_every_card_back(client, db, make_product):
    mew, charizard = two_cards(client, make_product)
    body = combine(
        client, db, [{"product_id": mew["id"], "quantity": 2}, {"product_id": charizard["id"]}]
    ).json()

    response = client.post(
        f"/api/v1/transformations/{body['id']}/void", json={"reason": "Selling singly"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "voided"

    assert stats(client, mew["id"])["quantity_on_hand"] == 2
    assert stats(client, mew["id"])["remaining_cost"] == "10.00"
    assert stats(client, charizard["id"])["quantity_on_hand"] == 1
    assert stats(client, body["outputs"][0]["product_id"])["quantity_on_hand"] == 0

    again = client.post(f"/api/v1/transformations/{body['id']}/void", json={"reason": "x"})
    assert again.status_code == 409


def test_a_moved_bundle_is_brought_back_and_broken_apart(client, db, make_product):
    mew, charizard = two_cards(client, make_product)
    body = combine(
        client, db, [{"product_id": mew["id"], "quantity": 2}, {"product_id": charizard["id"]}]
    ).json()
    bundle = body["outputs"][0]["product_id"]
    moved = client.post(
        "/api/v1/moves",
        json={
            "product_id": bundle,
            "quantity": 1,
            "from_bucket": "inventory",
            "to_bucket": "vault",
        },
    )
    assert moved.status_code == 201, moved.text

    response = client.post(f"/api/v1/transformations/{body['id']}/void", json={"reason": "x"})

    assert response.status_code == 200, response.text
    assert stats(client, bundle)["by_bucket"] == {"inventory": 0, "store": 0, "vault": 0}
    assert stats(client, mew["id"])["by_bucket"]["inventory"] == 2
    assert stats(client, charizard["id"])["quantity_on_hand"] == 1
    # The trip back is on the record, not erased: Vault, then back to Inventory.
    history = db.scalars(select(StockMove).where(StockMove.product_id == uuid.UUID(bundle)))
    assert sorted((m.from_bucket, m.bucket) for m in history) == [
        ("inventory", "vault"),
        ("vault", "inventory"),
    ]


def test_a_sold_bundle_cannot_be_broken_apart(client, db, make_product):
    mew, _ = two_cards(client, make_product)
    body = combine(client, db, [{"product_id": mew["id"], "quantity": 2}]).json()
    sale = client.post(
        "/api/v1/sales",
        json={
            "product_id": body["outputs"][0]["product_id"],
            "quantity": 1,
            "amount": "40.00",
            "proceeds": [],
        },
    )
    assert sale.status_code == 201, sale.text

    response = client.post(f"/api/v1/transformations/{body['id']}/void", json={"reason": "x"})

    assert response.status_code == 409
    assert "already been sold" in response.json()["detail"]
    assert stats(client, mew["id"])["quantity_on_hand"] == 0
    listed = client.get("/api/v1/transformations", params={"product_id": mew["id"]}).json()
    assert listed[0]["status"] == "active"


# ------------------------------------------------------------------ links


def test_a_card_lists_the_bundle_it_went_into(client, db, make_product):
    mew, charizard = two_cards(client, make_product)
    body = combine(client, db, [{"product_id": mew["id"]}]).json()

    listed = client.get("/api/v1/transformations", params={"product_id": mew["id"]}).json()
    assert [row["id"] for row in listed] == [body["id"]]
    other = client.get("/api/v1/transformations", params={"product_id": charizard["id"]}).json()
    assert other == []


def test_a_card_that_went_into_a_bundle_cannot_be_deleted(client, db, make_product):
    mew, _ = two_cards(client, make_product)
    combine(client, db, [{"product_id": mew["id"]}])

    response = client.delete(f"/api/v1/products/{mew['id']}")

    assert response.status_code == 409
    assert "combined" in response.json()["detail"]
