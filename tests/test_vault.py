"""The Vault: appreciation, not velocity — and out of the ageing report.

The worry that started this was misplaced and it is worth stating: ROI is computed on what
**sold**, and a Vault item has not sold, so it was never dragging that number down. The
distortion was only ever in two places, and this is both of them.

**Ageing.** A Store box at 400 days is a problem; a Vault box at 400 days is on plan.
**Capital.** Vault money really is tied up, so it stays visible - it just must not read as a
warning.

And the loophole: exempting the Vault must not make it the place slow stock goes to
disappear, so the move keeps its history and the report says how long it sat in the Store
first.
"""

import uuid
from datetime import date, timedelta

TODAY = date.today()
LAST_YEAR = TODAY - timedelta(days=365)


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


def value(client, product_id, amount, on=None):
    response = client.post(
        "/api/v1/valuations",
        json={
            "product_id": product_id,
            "value": amount,
            "captured_on": (on or TODAY).isoformat(),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def vault(client) -> dict:
    response = client.get("/api/v1/reports/vault")
    assert response.status_code == 200, response.text
    return {row["product_name"]: row for row in response.json()}


def aging(client) -> dict:
    return {row["product_name"]: row for row in client.get("/api/v1/reports/aging").json()}


# ------------------------------------------------------------- out of the ageing


def test_the_vault_is_not_in_the_ageing_report(client, make_product):
    """It is not asleep. It is parked, and averaging the two describes neither."""
    parked = make_product("Deliberate Hold")
    buy(client, parked["id"], 3, "900.00", on=LAST_YEAR, bucket="vault")

    assert "Deliberate Hold" not in aging(client)


def test_the_store_is_still_in_the_ageing_report(client, make_product):
    trying = make_product("Still Trying")
    buy(client, trying["id"], 1, "150.00", on=LAST_YEAR, bucket="store")

    assert aging(client)["Still Trying"]["days_held"] >= 365


def test_a_split_holding_only_ages_the_part_that_is_not_vaulted(client, make_product):
    """Two in the Store and one in the Vault is two units asleep, not three."""
    mixed = make_product("Half And Half Hold")
    buy(client, mixed["id"], 3, "300.00", on=LAST_YEAR, bucket="store")
    client.post(
        "/api/v1/moves",
        json={
            "product_id": mixed["id"],
            "quantity": 1,
            "from_bucket": "store",
            "to_bucket": "vault",
        },
    )

    assert aging(client)["Half And Half Hold"]["units"] == 2


def test_moving_everything_to_the_vault_takes_it_out_of_ageing(client, make_product):
    slow = make_product("Quietly Moved")
    buy(client, slow["id"], 2, "200.00", on=LAST_YEAR, bucket="store")
    client.post(
        "/api/v1/moves",
        json={
            "product_id": slow["id"],
            "quantity": 2,
            "from_bucket": "store",
            "to_bucket": "vault",
        },
    )

    assert "Quietly Moved" not in aging(client)


# --------------------------------------------------------------- the scoreboard


def test_the_vault_is_measured_on_appreciation(client, make_product):
    held = make_product("Appreciating Thing")
    buy(client, held["id"], 2, "400.00", bucket="vault")
    value(client, held["id"], "300.00")

    row = vault(client)["Appreciating Thing"]

    assert row["units"] == 2
    assert row["cost"] == "400.00"
    assert row["value"] == "300.00"
    # Two units at $300 against $400 of cost.
    assert row["appreciation"] == "200.00"
    assert row["appreciation_pct"] == 0.5


def test_something_never_valued_says_so(client, make_product):
    """Reporting cost as value would invent a number. It stays unknown."""
    held = make_product("Never Valued")
    buy(client, held["id"], 1, "500.00", bucket="vault")

    row = vault(client)["Never Valued"]
    assert row["value"] is None
    assert row["appreciation"] is None
    assert row["days_since_valued"] is None


def test_the_latest_estimate_wins(client, make_product):
    held = make_product("Revalued Thing")
    buy(client, held["id"], 1, "100.00", bucket="vault")
    value(client, held["id"], "150.00", on=TODAY - timedelta(days=400))
    value(client, held["id"], "260.00", on=TODAY)

    row = vault(client)["Revalued Thing"]
    assert row["value"] == "260.00"
    assert row["days_since_valued"] == 0


def test_a_stale_estimate_shows_its_age(client, make_product):
    """The workbook revalues annually. Older than that is worth seeing, not hiding."""
    held = make_product("Stale Valuation")
    buy(client, held["id"], 1, "100.00", bucket="vault")
    value(client, held["id"], "150.00", on=TODAY - timedelta(days=500))

    assert vault(client)["Stale Valuation"]["days_since_valued"] == 500


def test_appreciation_is_annualised_only_past_a_year(client, make_product):
    """Multiplying a three-week gain by seventeen is a confident number about nothing."""
    recent = make_product("Recently Vaulted")
    buy(client, recent["id"], 1, "100.00", on=TODAY - timedelta(days=30), bucket="vault")
    value(client, recent["id"], "150.00")

    assert vault(client)["Recently Vaulted"]["annualised"] is None


def test_a_long_hold_is_annualised(client, make_product):
    held = make_product("Two Year Hold")
    buy(client, held["id"], 1, "100.00", on=TODAY - timedelta(days=730), bucket="vault")
    value(client, held["id"], "200.00")

    row = vault(client)["Two Year Hold"]
    # Doubled over two years is roughly 50% a year.
    assert 0.45 < row["annualised"] < 0.55


def test_there_is_no_days_to_sell_figure(client, make_product):
    """The Vault is not measured on velocity, so the column does not exist."""
    held = make_product("Not Racing")
    buy(client, held["id"], 1, "100.00", bucket="vault")

    row = vault(client)["Not Racing"]
    assert "days_to_sell" not in row
    assert "sell_through" not in row


def test_nothing_in_the_vault_reports_nothing(client):
    assert client.get("/api/v1/reports/vault").json() == []


# ------------------------------------------------------------- the loophole guard


def test_how_long_it_sat_in_the_store_first_is_shown(client, make_product):
    """Exempting the Vault must not make it where slow stock goes to disappear.

    Nothing is blocked and nothing is nagged about. It is simply visible whether the Vault
    is a strategy or an excuse.
    """
    moved = make_product("Moved After Sitting")
    buy(client, moved["id"], 1, "200.00", on=TODAY - timedelta(days=180), bucket="store")
    client.post(
        "/api/v1/moves",
        json={
            "product_id": moved["id"],
            "quantity": 1,
            "from_bucket": "store",
            "to_bucket": "vault",
            "moved_on": TODAY.isoformat(),
        },
    )

    assert vault(client)["Moved After Sitting"]["days_in_store_first"] == 180


def test_something_bought_straight_into_the_vault_has_no_store_history(client, make_product):
    direct = make_product("Straight To Vault")
    buy(client, direct["id"], 1, "200.00", bucket="vault")

    assert vault(client)["Straight To Vault"]["days_in_store_first"] is None


# ------------------------------------------------------------------- valuations


def test_a_valuation_is_an_estimate_and_never_the_cost(client, make_product):
    """It informs decisions. It does not score them, or the group marks its own homework."""
    held = make_product("Estimated Thing")
    buy(client, held["id"], 1, "100.00", bucket="vault")
    value(client, held["id"], "900.00")

    stats = client.get(f"/api/v1/products/{held['id']}").json()["stats"]
    assert stats["remaining_cost"] == "100.00"
    assert stats["realized_profit"] == "0.00"


def test_a_valuation_records_where_it_came_from(client, make_product):
    held = make_product("Sourced Valuation")
    buy(client, held["id"], 1, "100.00", bucket="vault")

    assert value(client, held["id"], "150.00")["source"] == "typed"


def test_valuing_something_that_does_not_exist_is_a_404(client):
    response = client.post(
        "/api/v1/valuations", json={"product_id": str(uuid.uuid4()), "value": "10.00"}
    )
    assert response.status_code == 404
