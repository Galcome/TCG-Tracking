"""Sets as an axis, and filters that narrow a report without splitting it.

The reports could group by game, product, type, channel and seller - every axis except the
one the group actually buys and sells in. Joseph: "You also can't really filter by sets."

The rule that matters most here is that a filter narrows the **sales aggregate and the
stock attribution together**. A report showing one set's sales against the whole
catalogue's inventory would be worse than no filter, because every ratio on the row would
be quietly wrong.
"""

TODAY = None


def buy(client, product_id, quantity, amount, bucket="inventory"):
    response = client.post(
        "/api/v1/purchases",
        json={
            "product_id": product_id,
            "quantity": quantity,
            "amount": amount,
            "bucket": bucket,
        },
    )
    assert response.status_code == 201, response.text


def sell(client, product_id, quantity, amount):
    response = client.post(
        "/api/v1/sales",
        json={"product_id": product_id, "quantity": quantity, "amount": amount},
    )
    assert response.status_code == 201, response.text


def by_set(client, **params) -> dict:
    response = client.get("/api/v1/reports/by-set-performance", params=params)
    assert response.status_code == 200, response.text
    return {row["label"]: row for row in response.json()}


def by_game(client, **params) -> dict:
    response = client.get("/api/v1/reports/by-game", params=params)
    assert response.status_code == 200, response.text
    return {row["label"]: row for row in response.json()}


def set_id_for(client, name: str) -> str:
    """The id of a set, found through the same endpoint the picker uses."""
    rows = client.get("/api/v1/sets", params={"game": "pokemon", "q": name}).json()["items"]
    return next(row["id"] for row in rows if row["name"] == name)


# ------------------------------------------------------------------- set as an axis


def test_sets_can_be_compared_against_each_other(client, make_product):
    first = make_product("Filter A Box", set_name="Filter Set A")
    second = make_product("Filter B Box", set_name="Filter Set B")
    buy(client, first["id"], 1, "100.00")
    buy(client, second["id"], 1, "100.00")
    sell(client, first["id"], 1, "300.00")
    sell(client, second["id"], 1, "150.00")

    rows = by_set(client)

    assert rows["Filter Set A"]["realized_profit"] == "200.00"
    assert rows["Filter Set B"]["realized_profit"] == "50.00"


def test_a_product_with_no_set_is_not_dropped(client, make_product):
    """"Unspecified", the way a sale with no channel is handled.

    A row silently excluded is how a report stops reconciling with the dashboard.
    """
    loose = make_product("No Set At All")
    buy(client, loose["id"], 1, "50.00")
    sell(client, loose["id"], 1, "80.00")

    assert "Unspecified" in by_set(client)


def test_a_set_holding_stock_but_no_sales_still_appears(client, make_product):
    held = make_product("Unsold Set Box", set_name="Filter Set Held")
    buy(client, held["id"], 2, "200.00")

    row = by_set(client)["Filter Set Held"]
    assert row["units_in_stock"] == 2
    assert row["sale_count"] == 0


# ----------------------------------------------------------------------- filtering


def test_filtering_to_one_set_excludes_the_others(client, make_product):
    keep = make_product("Kept Box", set_name="Filter Keep")
    drop = make_product("Dropped Box", set_name="Filter Drop")
    buy(client, keep["id"], 1, "100.00")
    buy(client, drop["id"], 1, "100.00")
    sell(client, keep["id"], 1, "300.00")
    sell(client, drop["id"], 1, "300.00")

    rows = by_game(client, set_id=set_id_for(client, "Filter Keep"))

    assert rows["Pokémon"]["realized_profit"] == "200.00"
    assert rows["Pokémon"]["sale_count"] == 1


def test_a_filter_narrows_stock_and_sales_together(client, make_product):
    """The invariant worth the whole feature.

    Filtering the sales but not the inventory would show one set's profit against the
    whole catalogue's stock, and every ratio on that row would be quietly wrong.
    """
    kept = make_product("Scoped Box", set_name="Filter Scoped")
    other = make_product("Unscoped Box", set_name="Filter Unscoped")
    buy(client, kept["id"], 3, "300.00")
    buy(client, other["id"], 5, "500.00")
    sell(client, kept["id"], 1, "200.00")

    row = by_game(client, set_id=set_id_for(client, "Filter Scoped"))["Pokémon"]

    # Two left of the three bought, and nothing from the set that was filtered out.
    assert row["units_in_stock"] == 2
    assert row["inventory_at_cost"] == "200.00"
    assert row["units_purchased"] == 3


def test_filters_combine(client, make_product):
    product = make_product("Combined Box", set_name="Filter Combined")
    buy(client, product["id"], 1, "100.00")
    sell(client, product["id"], 1, "250.00")

    games = client.get("/api/v1/games").json()
    pokemon = next(row["id"] for row in games if row["slug"] == "pokemon")

    rows = by_set(client, set_id=set_id_for(client, "Filter Combined"), game_id=pokemon)
    assert rows["Filter Combined"]["realized_profit"] == "150.00"


def test_a_filter_matching_nothing_returns_nothing(client, make_product):
    """Empty, not everything. A filter that silently falls back to no filter is a lie."""
    product = make_product("Lonely Box", set_name="Filter Lonely")
    buy(client, product["id"], 1, "100.00")
    sell(client, product["id"], 1, "250.00")

    games = client.get("/api/v1/games").json()
    other_game = next(row["id"] for row in games if row["slug"] != "pokemon")

    rows = by_set(client, set_id=set_id_for(client, "Filter Lonely"), game_id=other_game)
    assert rows == {}


def test_no_filter_is_unchanged(client, make_product):
    """The unfiltered path must not pay for the feature - same rows, same numbers."""
    product = make_product("Unfiltered Box", set_name="Filter Untouched")
    buy(client, product["id"], 1, "100.00")
    sell(client, product["id"], 1, "400.00")

    plain = client.get("/api/v1/reports/by-game").json()
    explicit_none = client.get(
        "/api/v1/reports/by-game", params={"period": "all"}
    ).json()
    assert plain == explicit_none


def test_filtering_by_product_type_separates_sealed_from_singles(client, make_product):
    """The tier question, asked as a filter rather than an axis.

    Product type is the one field that decides whether a row belongs in the case-versus-box
    comparison at all, so being able to narrow to it is what makes that comparison usable.
    """
    types = client.get("/api/v1/product-types").json()
    rows = types["items"] if isinstance(types, dict) else types
    single = next(row["id"] for row in rows if row["slug"] == "single")

    card = make_product("Typed Card", product_type_id=single)
    box = make_product("Typed Box")
    buy(client, card["id"], 1, "50.00")
    buy(client, box["id"], 1, "100.00")
    sell(client, card["id"], 1, "200.00")
    sell(client, box["id"], 1, "400.00")

    only_cards = by_game(client, product_type_id=single)["Pokémon"]

    assert only_cards["realized_profit"] == "150.00"
    assert only_cards["sale_count"] == 1
