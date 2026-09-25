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


# ---------------------------------------------------------------------- sorting


def _stock(client, product_id: str, quantity: int, bucket: str = "inventory") -> None:
    response = client.post(
        "/api/v1/purchases",
        json={"product_id": product_id, "quantity": quantity, "amount": "1.00", "bucket": bucket},
    )
    assert response.status_code == 201, response.text


def _value(client, product_id: str, amount: str, captured_on: str = "2026-09-01") -> None:
    response = client.post(
        "/api/v1/valuations",
        json={"product_id": product_id, "value": amount, "captured_on": captured_on},
    )
    assert response.status_code == 201, response.text


def _quote(client, db, product_id: str, cad_cents: int, match_status: str = "confirmed"):
    from src.models.catalog import CatalogMapping
    from src.models.market_price import CurrentMarketQuote

    created = client.post(
        "/api/v1/pricing/mappings",
        json={
            "product_id": product_id,
            "provider": "tcgcsv",
            "external_product_id": "42",
            "external_group_id": "7",
            "external_category_id": "1",
            "subtype_name": "Normal",
        },
    )
    assert created.status_code == 201, created.text
    mapping = db.get(CatalogMapping, uuid.UUID(created.json()["id"]))
    mapping.match_status = match_status
    db.add(
        CurrentMarketQuote(
            mapping_id=mapping.id,
            product_id=mapping.product_id,
            status="fresh",
            original_currency="CAD",
            original_value_cents=cad_cents,
            cad_value_cents=cad_cents,
        )
    )
    db.flush()


def _names(client, **params) -> list[str]:
    response = client.get("/api/v1/products", params=params)
    assert response.status_code == 200, response.text
    return [item["name"] for item in response.json()["items"]]


def test_value_sort_ranks_whole_holdings_and_sinks_unvalued(client, make_product):
    """Two $10 units outrank one $15 unit; a product nobody valued goes last either way."""
    pair = make_product("Sort Pair")
    single = make_product("Sort Single")
    unvalued = make_product("Sort Unvalued")
    _stock(client, pair["id"], 2)
    _stock(client, single["id"], 1)
    _stock(client, unvalued["id"], 5)
    _value(client, pair["id"], "10.00")
    _value(client, single["id"], "15.00")

    assert _names(client, q="Sort", sort="value_desc") == [
        "Sort Pair",
        "Sort Single",
        "Sort Unvalued",
    ]
    assert _names(client, q="Sort", sort="value_asc") == [
        "Sort Single",
        "Sort Pair",
        "Sort Unvalued",
    ]
    assert _names(client, q="Sort", sort="unit_value_desc") == [
        "Sort Single",
        "Sort Pair",
        "Sort Unvalued",
    ]
    assert _names(client, q="Sort", sort="quantity_desc") == [
        "Sort Unvalued",
        "Sort Pair",
        "Sort Single",
    ]


def test_value_sort_pages_in_the_database(client, make_product):
    """The order has to hold across pages, not just within the thirty on screen."""
    for index, amount in enumerate(["5.00", "50.00", "20.00"]):
        product = make_product(f"Paged Value {index}")
        _stock(client, product["id"], 1)
        _value(client, product["id"], amount)

    first = _names(client, q="Paged Value", sort="value_desc", limit=1)
    second = _names(client, q="Paged Value", sort="value_desc", limit=1, offset=1)
    assert first + second == ["Paged Value 1", "Paged Value 2"]


def test_the_latest_manual_valuation_is_the_one_that_counts(client, make_product):
    rising = make_product("Latest Rising")
    steady = make_product("Latest Steady")
    for product in (rising, steady):
        _stock(client, product["id"], 1)
    _value(client, rising["id"], "1.00", "2026-01-01")
    _value(client, rising["id"], "90.00", "2026-09-01")
    _value(client, steady["id"], "50.00", "2026-09-01")

    assert _names(client, q="Latest", sort="value_desc") == ["Latest Rising", "Latest Steady"]


def test_market_quote_leads_outside_the_vault_and_manual_leads_inside(client, db, make_product):
    """Each tab sorts by the number its cards show."""
    quoted = make_product("Lead Quoted")
    manual = make_product("Lead Manual")
    for product in (quoted, manual):
        _stock(client, product["id"], 1, bucket="vault")
    # Quoted: market $80 but valued by hand at $10. Manual: valued by hand at $40 only.
    _quote(client, db, quoted["id"], 8000)
    _value(client, quoted["id"], "10.00")
    _value(client, manual["id"], "40.00")

    assert _names(client, q="Lead", sort="value_desc") == ["Lead Quoted", "Lead Manual"]
    assert _names(client, q="Lead", sort="value_desc", bucket="vault") == [
        "Lead Manual",
        "Lead Quoted",
    ]


def test_hidden_quotes_do_not_count_toward_value(client, db, make_product):
    """An unconfirmed mapping, or a raw quote on a card graded since, is not a value."""
    from sqlalchemy import select

    from src.models.taxonomy import ProductType

    graded_type = db.scalar(select(ProductType.id).where(ProductType.slug == "graded-card"))
    slab = make_product("Hidden Slab")
    pending = make_product("Hidden Pending")
    plain = make_product("Hidden Plain")
    for product in (slab, pending, plain):
        _stock(client, product["id"], 1)
    _quote(client, db, slab["id"], 99900)
    graded = client.patch(
        f"/api/v1/products/{slab['id']}",
        json={"product_type_id": str(graded_type), "grading_company": "PSA", "grade": "10"},
    )
    assert graded.status_code == 200, graded.text
    _quote(client, db, pending["id"], 99900, match_status="disabled")
    _value(client, plain["id"], "5.00")

    assert _names(client, q="Hidden", sort="value_desc")[0] == "Hidden Plain"


def test_value_uses_only_the_selected_bucket(client, make_product):
    """A product with 9 in the Store and 1 in the Vault is a small Vault holding."""
    mostly_store = make_product("Bucket Mostly Store")
    vault_heavy = make_product("Bucket Vault Heavy")
    _stock(client, mostly_store["id"], 9, bucket="store")
    _stock(client, mostly_store["id"], 1, bucket="vault")
    _stock(client, vault_heavy["id"], 3, bucket="vault")
    _value(client, mostly_store["id"], "10.00")
    _value(client, vault_heavy["id"], "10.00")

    assert _names(client, q="Bucket", sort="value_desc") == [
        "Bucket Mostly Store",
        "Bucket Vault Heavy",
    ]
    assert _names(client, q="Bucket", sort="value_desc", bucket="vault") == [
        "Bucket Vault Heavy",
        "Bucket Mostly Store",
    ]


def test_type_sort_groups_by_type_then_value(client, db, make_product):
    from sqlalchemy import select

    from src.models.taxonomy import ProductType

    single_type = db.scalar(select(ProductType.id).where(ProductType.slug == "single"))
    cheap_box = make_product("Group Cheap Box")
    dear_box = make_product("Group Dear Box")
    card = make_product("Group Card", product_type_id=str(single_type))
    for product, amount in ((cheap_box, "5.00"), (dear_box, "500.00"), (card, "1.00")):
        _stock(client, product["id"], 1)
        _value(client, product["id"], amount)

    # Single sorts before Booster Box in the taxonomy; within a type, worth decides.
    assert _names(client, q="Group", sort="type") == [
        "Group Card",
        "Group Dear Box",
        "Group Cheap Box",
    ]


def test_newest_and_name_sorts(client, make_product):
    make_product("Order B")
    make_product("Order A")
    make_product("Order C")

    assert _names(client, q="Order", sort="newest") == ["Order C", "Order A", "Order B"]
    assert _names(client, q="Order", sort="name") == ["Order A", "Order B", "Order C"]


def test_an_explicit_sort_overrides_search_relevance(client, make_product):
    exact = make_product("Relevance Charizard")
    loose = make_product("Relevance Charizard Deluxe Collection")
    _stock(client, exact["id"], 1)
    _stock(client, loose["id"], 1)
    _value(client, loose["id"], "300.00")

    assert _names(client, q="Relevance Charizard", sort="value_desc")[0] == loose["name"]


def test_an_unknown_sort_is_rejected(client):
    assert client.get("/api/v1/products", params={"sort": "price; drop"}).status_code == 422


def _buy(client, product_id: str, quantity: int, amount: str) -> None:
    response = client.post(
        "/api/v1/purchases",
        json={"product_id": product_id, "quantity": quantity, "amount": amount},
    )
    assert response.status_code == 201, response.text


def _sell(client, product_id: str, quantity: int, amount: str, oversell: bool = False) -> None:
    response = client.post(
        "/api/v1/sales",
        json={
            "product_id": product_id,
            "quantity": quantity,
            "amount": amount,
            "allow_oversell": oversell,
        },
    )
    assert response.status_code == 201, response.text


def _adjust(client, product_id: str, delta: int, reason: str, cost: str | None = None) -> None:
    response = client.post(
        "/api/v1/adjustments",
        json={"product_id": product_id, "quantity_delta": delta, "reason": reason, "cost": cost},
    )
    assert response.status_code == 201, response.text


def test_the_sql_cost_totals_agree_with_product_stats(client, db, make_product):
    """The sort must rank by the same cost and profit the card prints."""
    from sqlalchemy import select

    from src.services import inventory

    sold = make_product("Agree Sold")
    oversold = make_product("Agree Oversold")
    written = make_product("Agree Written Off")
    opening = make_product("Agree Opening")
    _buy(client, sold["id"], 4, "100.00")
    _sell(client, sold["id"], 1, "60.00")
    _buy(client, oversold["id"], 1, "10.00")
    _sell(client, oversold["id"], 3, "90.00", oversell=True)
    _buy(client, written["id"], 3, "30.00")
    _adjust(client, written["id"], -1, "damaged")
    _adjust(client, opening["id"], 2, "opening_inventory", "40.00")
    _adjust(client, opening["id"], 1, "opening_inventory")

    costs = inventory.cost_totals()
    ids = [uuid.UUID(product["id"]) for product in (sold, oversold, written, opening)]
    rows = {
        product_id: (int(remaining), int(profit))
        for product_id, remaining, profit in db.execute(
            select(costs.c.product_id, costs.c.remaining_cost, costs.c.realized_profit).where(
                costs.c.product_id.in_(ids)
            )
        )
    }
    stats = inventory.product_stats(db, ids)
    assert rows == {
        product_id: (entry.remaining_cost_cents, entry.realized_profit_cents)
        for product_id, entry in stats.items()
    }
    assert rows[ids[0]] == (7500, 3500)


def test_cost_and_profit_sorts(client, make_product):
    dear = make_product("Ledger Dear")
    cheap = make_product("Ledger Cheap")
    earner = make_product("Ledger Earner")
    make_product("Ledger Untouched")
    _buy(client, dear["id"], 1, "500.00")
    _buy(client, cheap["id"], 1, "5.00")
    _buy(client, earner["id"], 2, "20.00")
    _sell(client, earner["id"], 1, "210.00")

    assert _names(client, q="Ledger", sort="cost_desc") == [
        "Ledger Dear",
        "Ledger Earner",
        "Ledger Cheap",
        "Ledger Untouched",
    ]
    # A product that has not sold has made nothing, which outranks a loss.
    assert _names(client, q="Ledger", sort="profit_desc")[0] == "Ledger Earner"


def test_unrealized_sorts_rank_gain_over_cost_and_sink_unvalued(client, make_product):
    """Gain is the whole on-hand value less its cost, as the card shows it."""
    winner = make_product("Gain Winner")
    loser = make_product("Gain Loser")
    unvalued = make_product("Gain Unvalued")
    _buy(client, winner["id"], 2, "20.00")
    _value(client, winner["id"], "50.00")
    _buy(client, loser["id"], 1, "300.00")
    _value(client, loser["id"], "100.00")
    _buy(client, unvalued["id"], 1, "1.00")

    assert _names(client, q="Gain", sort="unrealized_desc") == [
        "Gain Winner",
        "Gain Loser",
        "Gain Unvalued",
    ]
    assert _names(client, q="Gain", sort="unrealized_asc") == [
        "Gain Loser",
        "Gain Winner",
        "Gain Unvalued",
    ]
