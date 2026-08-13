"""The three rollups, and the rules that keep them honest.

Lineage and tier **overlap by definition** - a case's lineage return is the aggregate of its
descendants - so they are separate views and are never summed. The set rollup shows its
parts and never a blend, because averaging a realized flip together with an unrealized hold
describes neither of them.

And tier reports the **spread**, not just the average. "We got lucky on that Fabled case" is
survivorship: the case anybody remembers is the one that hit, and a report that only ever
surfaces winners will always conclude that ripping pays.
"""

import uuid
from datetime import date, timedelta

TODAY = date.today()


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


def sell(client, product_id, quantity, amount, bucket="inventory"):
    response = client.post(
        "/api/v1/sales",
        json={
            "product_id": product_id,
            "quantity": quantity,
            "amount": amount,
            "bucket": bucket,
            "sale_date": TODAY.isoformat(),
        },
    )
    assert response.status_code == 201, response.text


def crack(client, case_id, outputs, **extra):
    return client.post(
        "/api/v1/transformations/crack",
        json={"product_id": case_id, "outputs": outputs, **extra},
    )


def lineage(client, product_id) -> dict:
    response = client.get(f"/api/v1/reports/lineage/{product_id}")
    assert response.status_code == 200, response.text
    return response.json()


# -------------------------------------------------------------------- lineage


def test_a_case_rolls_up_across_everything_it_became(client, make_product):
    """The Fabled story, as a number rather than a memory."""
    case = make_product("Fabled Case")
    box = make_product("Fabled Box")
    buy(client, case["id"], 1, "900.00")
    crack(client, case["id"], [{"product_id": box["id"], "quantity": 6}])
    sell(client, box["id"], 4, "1200.00")

    rolled = lineage(client, case["id"])

    assert rolled["cost"] == "900.00"
    assert rolled["units_sold"] == 4
    assert rolled["units_remaining"] == 2
    # $1,200 back against the $600 of cost those four carried.
    assert rolled["realized_profit"] == "600.00"
    assert rolled["roi"] == 600 / 900


def test_the_chain_goes_more_than_one_level_deep(client, make_product):
    """Case to box to hit. The whole reason parentage is recorded."""
    case = make_product("Deep Case")
    box = make_product("Deep Box")
    hit = make_product("Deep Hit")
    buy(client, case["id"], 1, "900.00")
    crack(client, case["id"], [{"product_id": box["id"], "quantity": 6}])
    client.post(
        "/api/v1/transformations/rip",
        json={
            "product_id": box["id"],
            "hits": [{"product_id": hit["id"], "value": "500.00"}],
        },
    )

    rolled = lineage(client, case["id"])

    names = [node["product_name"] for node in rolled["tree"]]
    assert names == ["Deep Box"]
    assert [child["product_name"] for child in rolled["tree"][0]["children"]] == ["Deep Hit"]


def test_the_root_cost_is_the_only_money_counted(client, make_product):
    """The boxes carry cost across; counting them too would say $1,800 was spent."""
    case = make_product("Once Case")
    box = make_product("Once Box")
    buy(client, case["id"], 1, "900.00")
    crack(client, case["id"], [{"product_id": box["id"], "quantity": 6}])

    assert lineage(client, case["id"])["cost"] == "900.00"


def test_bulk_lost_on_the_way_is_part_of_the_story(client, make_product):
    case = make_product("Bulky Case")
    box = make_product("Bulky Box")
    hit = make_product("Bulky Hit")
    buy(client, case["id"], 1, "600.00")
    crack(client, case["id"], [{"product_id": box["id"], "quantity": 6}])
    client.post(
        "/api/v1/transformations/rip",
        json={
            "product_id": box["id"],
            "hits": [{"product_id": hit["id"], "value": "500.00", "cost": "50.00"}],
        },
    )

    assert float(lineage(client, case["id"])["written_off"]) == 50.00


def test_nothing_sold_yet_has_no_return(client, make_product):
    """A ratio against zero sales is not a small number, it is not a number."""
    case = make_product("Untouched Case")
    box = make_product("Untouched Box")
    buy(client, case["id"], 1, "900.00")
    crack(client, case["id"], [{"product_id": box["id"], "quantity": 6}])

    assert lineage(client, case["id"])["roi"] is None


def test_a_product_with_no_chain_still_rolls_up(client, make_product):
    plain = make_product("Just A Box")
    buy(client, plain["id"], 1, "100.00")
    sell(client, plain["id"], 1, "150.00")

    rolled = lineage(client, plain["id"])
    assert rolled["tree"] == []
    assert rolled["realized_profit"] == "50.00"


def test_an_undone_crack_leaves_the_chain(client, make_product):
    case = make_product("Reverted Case")
    box = make_product("Reverted Box")
    buy(client, case["id"], 1, "900.00")
    created = crack(client, case["id"], [{"product_id": box["id"], "quantity": 6}]).json()
    client.post(
        f"/api/v1/transformations/{created['id']}/void", json={"reason": "wrong case"}
    )

    assert lineage(client, case["id"])["tree"] == []


def test_lineage_for_something_that_does_not_exist_is_a_404(client):
    assert client.get(f"/api/v1/reports/lineage/{uuid.uuid4()}").status_code == 404


# ----------------------------------------------------------------------- tier


def tiers(client) -> dict:
    response = client.get("/api/v1/reports/by-tier")
    assert response.status_code == 200, response.text
    return {row["key"]: row for row in response.json()}


def test_the_spread_is_reported_and_not_just_the_average(client, make_product):
    """The survivorship guard. One big win must not hide two losses."""
    winner = make_product("Lucky Box")
    loser = make_product("Unlucky Box")
    buy(client, winner["id"], 1, "100.00")
    buy(client, loser["id"], 1, "100.00")
    sell(client, winner["id"], 1, "400.00")
    sell(client, loser["id"], 1, "50.00")

    row = tiers(client)["booster-box"]

    assert row["best_roi"] > 2
    assert row["worst_roi"] < 0
    assert row["worst_roi"] < row["average_roi"] < row["best_roi"]


def test_a_tier_counts_how_many_products_it_is_averaging(client, make_product):
    """Two products is not a trend, and the reader deserves to know which it is."""
    first = make_product("Counted A")
    second = make_product("Counted B")
    for product in (first, second):
        buy(client, product["id"], 1, "100.00")
        sell(client, product["id"], 1, "150.00")

    assert tiers(client)["booster-box"]["products_traded"] >= 2


def test_the_median_sits_between_the_extremes(client, make_product):
    for index, price in enumerate(("120.00", "200.00", "400.00")):
        product = make_product(f"Median Box {index}")
        buy(client, product["id"], 1, "100.00")
        sell(client, product["id"], 1, price)

    row = tiers(client)["booster-box"]
    assert row["worst_roi"] <= row["median_roi"] <= row["best_roi"]


def test_something_never_sold_is_not_in_the_tier_average(client, make_product):
    """An unsold box has no return. Counting it as zero would be an invented loss."""
    unsold = make_product("Never Sold Box")
    buy(client, unsold["id"], 1, "100.00")

    before = tiers(client).get("booster-box", {}).get("products_traded", 0)
    buy(client, unsold["id"], 1, "100.00")
    after = tiers(client).get("booster-box", {}).get("products_traded", 0)

    assert after == before


def test_an_empty_store_reports_no_tiers(client):
    assert client.get("/api/v1/reports/by-tier").json() == []


# ------------------------------------------------------------------------ set


def sets_report(client) -> dict:
    response = client.get("/api/v1/reports/by-set")
    assert response.status_code == 200, response.text
    return {row["name"]: row for row in response.json()}


def test_a_set_shows_its_parts_and_never_a_blend(client, make_product):
    """Sold, still trying, and held on purpose are three different facts."""
    sold = make_product("Pitch Sold", set_name="Pitch Black Night")
    storing = make_product("Pitch Storing", set_name="Pitch Black Night")
    vaulted = make_product("Pitch Vaulted", set_name="Pitch Black Night")

    buy(client, sold["id"], 1, "100.00")
    sell(client, sold["id"], 1, "180.00")
    buy(client, storing["id"], 2, "200.00", bucket="store")
    buy(client, vaulted["id"], 3, "600.00", bucket="vault")

    row = sets_report(client)["Pitch Black Night"]

    assert row["units_sold"] == 1
    assert row["realized_profit"] == "80.00"
    assert row["units_in_store"] == 2
    assert row["units_in_vault"] == 3
    # Three separate figures. There is deliberately no single blended ROI on this row.
    assert "roi" not in row
    assert row["sold_roi"] == 0.8


def test_the_store_ages_and_the_vault_does_not(client, make_product):
    """A Store box at 400 days is a problem; a Vault box at 400 days is on plan."""
    storing = make_product("Ageing Store", set_name="Winterspell")
    vaulted = make_product("Ageing Vault", set_name="Winterspell")
    long_ago = TODAY - timedelta(days=400)
    buy(client, storing["id"], 1, "100.00", on=long_ago, bucket="store")
    buy(client, vaulted["id"], 1, "100.00", on=long_ago, bucket="vault")

    row = sets_report(client)["Winterspell"]

    assert row["oldest_store_days"] >= 400
    # No ageing figure for the Vault at all. It is not asleep, it is parked.
    assert "oldest_vault_days" not in row


def test_a_set_with_nothing_in_the_store_has_no_ageing_figure(client, make_product):
    vaulted = make_product("Only Vaulted", set_name="Wilds Unknown")
    buy(client, vaulted["id"], 1, "100.00", on=TODAY - timedelta(days=300), bucket="vault")

    assert sets_report(client)["Wilds Unknown"]["oldest_store_days"] is None


def test_products_with_no_set_are_left_out(client, make_product):
    loose = make_product("No Set At All")
    buy(client, loose["id"], 1, "100.00")

    assert "No Set At All" not in sets_report(client)


def test_an_empty_store_reports_no_sets(client):
    assert client.get("/api/v1/reports/by-set").json() == []


def test_a_product_reached_twice_is_counted_once(client, make_product):
    """Two branches converging on the same card must not double it.

    A case cracked into two different box products, both ripped into the same hit, is a
    diamond rather than a cycle - and counting the hit twice would inflate the case.
    """
    case = make_product("Diamond Case")
    first = make_product("Diamond Box A")
    second = make_product("Diamond Box B")
    hit = make_product("Diamond Hit")
    buy(client, case["id"], 2, "400.00")
    crack(
        client,
        case["id"],
        [{"product_id": first["id"], "quantity": 1}, {"product_id": second["id"], "quantity": 1}],
        quantity=2,
    )
    for box in (first, second):
        client.post(
            "/api/v1/transformations/rip",
            json={"product_id": box["id"], "hits": [{"product_id": hit["id"]}]},
        )

    rolled = lineage(client, case["id"])

    appearances = sum(len(node["children"]) for node in rolled["tree"])
    assert appearances == 1


def test_a_product_with_nothing_recorded_rolls_up_to_zero(client, make_product):
    """No transactions is not an error, and it is not a loss either."""
    idle = make_product("Never Touched")

    rolled = lineage(client, idle["id"])
    assert rolled["cost"] == "0.00"
    assert rolled["realized_profit"] == "0.00"
    assert rolled["roi"] is None


def test_a_tier_whose_sales_have_no_known_cost_has_no_return(client, make_product):
    """No cost means no margin, so there is no ratio to report - not a zero one."""
    mystery = make_product("Unknown Cost Box")
    client.post(
        "/api/v1/sales",
        json={
            "product_id": mystery["id"],
            "quantity": 1,
            "amount": "80.00",
            "allow_oversell": True,
        },
    )

    row = tiers(client)["booster-box"]
    assert row["roi"] is None
    assert row["products_traded"] == 0


def test_a_set_nothing_has_happened_to_is_not_reported(client, make_product):
    """A row of zeroes is not information. Nothing bought, nothing sold, nothing to say."""
    make_product("Idle In A Set", set_name="Attack of the Vine!")

    assert "Attack of the Vine!" not in sets_report(client)
