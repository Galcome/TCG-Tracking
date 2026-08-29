"""Tests for product creation, retrieval, editing and search."""

import uuid

import pytest


def test_create_product_requires_only_name_game_and_type(client, game_id, product_type_id):
    response = client.post(
        "/api/v1/products",
        json={
            "name": "Vivid Voltage Booster Box",
            "game_id": str(game_id),
            "product_type_id": str(product_type_id),
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Vivid Voltage Booster Box"
    assert body["game"]["slug"] == "pokemon"
    assert body["product_type"]["slug"] == "booster-box"
    assert body["is_archived"] is False
    assert body["created_by_member_id"] is not None


def test_create_product_records_who_created_it(client, make_product):
    me = client.get("/api/v1/members/me").json()
    assert make_product()["created_by_member_id"] == me["id"]


def test_optional_detail_is_stored(client, game_id, product_type_id):
    response = client.post(
        "/api/v1/products",
        json={
            "name": "Charizard",
            "game_id": str(game_id),
            "product_type_id": str(product_type_id),
            "set_name": "Base Set",
            "collector_number": "4/102",
            "variant": "Holo",
            "language": "English",
            "grading_company": "PSA",
            "grade": "9",
            "cert_number": "12345678",
            "storage_location": "Basement Shelf 2",
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["cert_number"] == "12345678"
    assert body["variant"] == "Holo"
    assert body["language"] == "English"


def test_whitespace_only_optional_fields_are_stored_as_null(client, game_id, product_type_id):
    response = client.post(
        "/api/v1/products",
        json={
            "name": "  Charizard  ",
            "game_id": str(game_id),
            "product_type_id": str(product_type_id),
            "set_name": "   ",
            "notes": "",
        },
    )
    assert response.status_code == 201
    assert response.json()["name"] == "Charizard"
    assert response.json()["set_name"] is None
    assert response.json()["notes"] is None


def test_blank_name_is_rejected(client, game_id, product_type_id):
    response = client.post(
        "/api/v1/products",
        json={"name": "   ", "game_id": str(game_id), "product_type_id": str(product_type_id)},
    )
    assert response.status_code == 422


def test_unknown_game_is_rejected(client, product_type_id):
    response = client.post(
        "/api/v1/products",
        json={
            "name": "Mystery Box",
            "game_id": str(uuid.uuid4()),
            "product_type_id": str(product_type_id),
        },
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "Unknown game"


def test_unknown_product_type_is_rejected(client, game_id):
    response = client.post(
        "/api/v1/products",
        json={
            "name": "Mystery Box",
            "game_id": str(game_id),
            "product_type_id": str(uuid.uuid4()),
        },
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "Unknown product type"


def test_read_product(client, make_product):
    created = make_product()
    response = client.get(f"/api/v1/products/{created['id']}")
    assert response.status_code == 200
    assert response.json()["id"] == created["id"]


def test_read_missing_product_returns_404(client):
    assert client.get(f"/api/v1/products/{uuid.uuid4()}").status_code == 404


def test_update_changes_only_what_was_sent(client, make_product):
    created = make_product(set_name="Vivid Voltage")
    response = client.patch(f"/api/v1/products/{created['id']}", json={"name": "Renamed Box"})
    assert response.status_code == 200
    assert response.json()["name"] == "Renamed Box"
    assert response.json()["set_name"] == "Vivid Voltage", "untouched fields must survive"


def test_update_can_explicitly_clear_a_field(client, make_product):
    created = make_product(set_name="Vivid Voltage")
    response = client.patch(f"/api/v1/products/{created['id']}", json={"set_name": None})
    assert response.json()["set_name"] is None


def test_update_can_archive(client, make_product):
    created = make_product()
    assert client.patch(
        f"/api/v1/products/{created['id']}", json={"is_archived": True}
    ).json()["is_archived"]


def test_update_rejects_a_blank_name(client, make_product):
    created = make_product()
    assert client.patch(f"/api/v1/products/{created['id']}", json={"name": " "}).status_code == 422


@pytest.mark.parametrize("field", ["name", "game_id", "product_type_id", "is_archived"])
def test_update_refuses_to_null_a_required_field(client, make_product, field: str):
    """These back NOT NULL columns; an explicit null must be a 422, not a 500."""
    created = make_product()
    response = client.patch(f"/api/v1/products/{created['id']}", json={field: None})
    assert response.status_code == 422


def test_update_rejects_unknown_taxonomy(client, make_product):
    created = make_product()
    response = client.patch(
        f"/api/v1/products/{created['id']}", json={"game_id": str(uuid.uuid4())}
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "Unknown game"


def test_update_rejects_unknown_product_type(client, make_product):
    created = make_product()
    response = client.patch(
        f"/api/v1/products/{created['id']}", json={"product_type_id": str(uuid.uuid4())}
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "Unknown product type"


def test_update_accepts_a_valid_taxonomy_change(client, db, make_product):
    from sqlalchemy import select

    from src.models.taxonomy import Game

    created = make_product()
    lorcana_id = db.scalar(select(Game.id).where(Game.slug == "lorcana"))
    response = client.patch(f"/api/v1/products/{created['id']}", json={"game_id": str(lorcana_id)})
    assert response.json()["game"]["slug"] == "lorcana"


def test_update_missing_product_returns_404(client):
    response = client.patch(f"/api/v1/products/{uuid.uuid4()}", json={"name": "Nope"})
    assert response.status_code == 404


def test_list_returns_a_paginated_envelope(client, make_product):
    make_product("Alpha Box")
    make_product("Beta Box")

    body = client.get("/api/v1/products", params={"limit": 1}).json()
    assert body["total"] == 2
    assert body["limit"] == 1
    assert body["offset"] == 0
    assert len(body["items"]) == 1
    assert body["items"][0]["name"] == "Alpha Box", "results are name-ordered"

    second = client.get("/api/v1/products", params={"limit": 1, "offset": 1}).json()
    assert second["items"][0]["name"] == "Beta Box"


def test_archived_products_are_hidden_by_default(client, make_product):
    created = make_product("Alpha Box")
    make_product("Beta Box")
    client.patch(f"/api/v1/products/{created['id']}", json={"is_archived": True})

    assert client.get("/api/v1/products").json()["total"] == 1
    assert client.get("/api/v1/products", params={"include_archived": True}).json()["total"] == 2


def test_search_matches_a_partial_name(client, make_product):
    make_product("Vivid Voltage Booster Box")
    make_product("Brilliant Stars Booster Box")

    body = client.get("/api/v1/products", params={"q": "vivid"}).json()
    assert [item["name"] for item in body["items"]] == ["Vivid Voltage Booster Box"]


def test_search_is_case_insensitive(client, make_product):
    make_product("Vivid Voltage Booster Box")
    assert client.get("/api/v1/products", params={"q": "VIVID VOLTAGE"}).json()["total"] == 1


def test_search_tolerates_a_misspelling(client, make_product):
    """Trigram similarity is what makes this work; plain ILIKE would miss it."""
    make_product("Vivid Voltage Booster Box")
    assert client.get("/api/v1/products", params={"q": "vivid voltag"}).json()["total"] == 1


def test_search_covers_set_notes_and_cert_number(client, make_product):
    make_product("Charizard", set_name="Base Set", cert_number="87654321", notes="graded slab")

    for query in ["Base Set", "87654321", "graded slab"]:
        assert client.get("/api/v1/products", params={"q": query}).json()["total"] == 1, query


def test_search_wildcards_are_treated_literally(client, make_product):
    make_product("Vivid Voltage Booster Box")
    assert client.get("/api/v1/products", params={"q": "%"}).json()["total"] == 0


def test_blank_search_is_ignored(client, make_product):
    make_product("Alpha Box")
    assert client.get("/api/v1/products", params={"q": "   "}).json()["total"] == 1


def test_filter_by_game_and_type(client, db, game_id, product_type_id, make_product):
    from sqlalchemy import select

    from src.models.taxonomy import Game, ProductType

    make_product("Pokemon Box")
    lorcana_id = db.scalar(select(Game.id).where(Game.slug == "lorcana"))
    single_id = db.scalar(select(ProductType.id).where(ProductType.slug == "single"))
    client.post(
        "/api/v1/products",
        json={
            "name": "Lorcana Single",
            "game_id": str(lorcana_id),
            "product_type_id": str(single_id),
        },
    )

    by_game = client.get("/api/v1/products", params={"game": "lorcana"}).json()
    assert [item["name"] for item in by_game["items"]] == ["Lorcana Single"]

    by_type = client.get("/api/v1/products", params={"product_type": "booster-box"}).json()
    assert [item["name"] for item in by_type["items"]] == ["Pokemon Box"]


def test_limit_is_capped(client):
    assert client.get("/api/v1/products", params={"limit": 5000}).status_code == 422


# ---------------------------------------------------------------------- paging


def test_only_the_page_has_its_cost_computed(client, make_product, monkeypatch):
    """The list must not get slower every time the catalogue grows.

    It used to load every matching product and compute cost basis and profit for all of
    them to show fifty. Fine at a few hundred; it had already started pushing the browser
    suite past its assertion timeouts, and real use gets there too.
    """
    from src.routes import products as products_route

    for index in range(6):
        make_product(f"Paged Product {index}", initial_purchase={"quantity": 1, "amount": "10.00"})

    asked_for: list[int] = []
    original = products_route.inventory.product_stats

    def spy(db, product_ids=None):
        asked_for.append(len(product_ids) if product_ids is not None else -1)
        return original(db, product_ids)

    monkeypatch.setattr(products_route.inventory, "product_stats", spy)

    page = client.get("/api/v1/products", params={"limit": 2}).json()

    assert len(page["items"]) == 2
    assert page["total"] >= 6
    # Two products on the page, two products costed. Never the whole catalogue.
    assert asked_for == [2]


def test_the_total_counts_everything_the_filters_kept(client, make_product):
    """Filtering a page and reporting its length as the total is how 60 becomes 30."""
    for index in range(5):
        make_product(f"Counted Product {index}", initial_purchase={"quantity": 1, "amount": "5.00"})

    page = client.get("/api/v1/products", params={"limit": 2, "stock": "in"}).json()

    assert len(page["items"]) == 2
    assert page["total"] >= 5


def test_paging_does_not_repeat_or_skip_a_product(client, make_product):
    for index in range(5):
        make_product(f"Stable Page {index}", initial_purchase={"quantity": 1, "amount": "5.00"})

    seen: list[str] = []
    for offset in (0, 2, 4):
        page = client.get(
            "/api/v1/products", params={"q": "Stable Page", "limit": 2, "offset": offset}
        ).json()
        seen.extend(item["name"] for item in page["items"])

    assert len(seen) == len(set(seen)) == 5


def test_negative_stock_still_shows_under_in_stock(client, make_product):
    """An oversell means the ledger disagrees with the shelf, and this is where it is fixed.

    The filter moved into SQL; it must still keep negatives, not clamp them away.
    """
    product = make_product("Oversold In SQL")
    client.post(
        "/api/v1/sales",
        json={
            "product_id": product["id"],
            "quantity": 2,
            "amount": "50.00",
            "allow_oversell": True,
        },
    )

    page = client.get("/api/v1/products", params={"q": "Oversold In SQL", "stock": "in"}).json()
    assert [item["name"] for item in page["items"]] == ["Oversold In SQL"]
    assert page["items"][0]["stats"]["quantity_on_hand"] == -2


def test_a_product_with_no_transactions_at_all_is_sold_out(client, make_product):
    make_product("Never Traded")

    page = client.get("/api/v1/products", params={"q": "Never Traded", "stock": "out"}).json()
    assert [item["name"] for item in page["items"]] == ["Never Traded"]
