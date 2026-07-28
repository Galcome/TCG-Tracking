"""Tests for the dashboard, reports, and the product lifecycle around the ledger."""

import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import select

from src.models.taxonomy import Game, ProductType
from src.services import reporting

TODAY = date.today()


@pytest.fixture
def lorcana_ids(db):
    return (
        db.scalar(select(Game.id).where(Game.slug == "lorcana")),
        db.scalar(select(ProductType.id).where(ProductType.slug == "single")),
    )


def buy(client, product_id, quantity, amount, on=None):
    return client.post(
        "/api/v1/purchases",
        json={
            "product_id": product_id,
            "quantity": quantity,
            "amount": amount,
            "purchase_date": (on or TODAY).isoformat(),
        },
    ).json()


def sell(client, product_id, quantity, amount, on=None, **extra):
    return client.post(
        "/api/v1/sales",
        json={
            "product_id": product_id,
            "quantity": quantity,
            "amount": amount,
            "sale_date": (on or TODAY).isoformat(),
            **extra,
        },
    ).json()


# ------------------------------------------------- product create with first purchase


def test_creating_a_product_records_its_first_purchase(client, game_id, product_type_id):
    response = client.post(
        "/api/v1/products",
        json={
            "name": "Vivid Voltage Booster Box",
            "game_id": str(game_id),
            "product_type_id": str(product_type_id),
            "initial_purchase": {
                "quantity": 2,
                "amount": "300.00",
                "purchase_date": TODAY.isoformat(),
            },
        },
    )
    assert response.status_code == 201
    body = response.json()

    assert body["stats"]["quantity_on_hand"] == 2
    assert body["stats"]["total_invested"] == "300.00"
    assert body["stats"]["average_unit_cost"] == "150.00"
    assert len(body["history"]) == 1
    assert body["history"][0]["kind"] == "purchase"


def test_a_product_can_still_be_created_without_a_purchase(client, make_product):
    body = make_product()
    assert body["stats"]["quantity_on_hand"] == 0
    assert body["stats"]["total_invested"] == "0.00"
    assert body["history"] == []


def test_the_first_purchase_is_rolled_back_with_the_product(client, game_id):
    """Both happen in one transaction, so a bad product id creates neither."""
    response = client.post(
        "/api/v1/products",
        json={
            "name": "Doomed",
            "game_id": str(game_id),
            "product_type_id": str(uuid.uuid4()),
            "initial_purchase": {"quantity": 1, "amount": "10.00"},
        },
    )
    assert response.status_code == 422
    assert client.get("/api/v1/products", params={"q": "Doomed"}).json()["total"] == 0


# --------------------------------------------------------------------- delete/archive


def test_a_product_with_no_history_can_be_deleted(client, make_product):
    product = make_product()
    assert client.delete(f"/api/v1/products/{product['id']}").status_code == 204
    assert client.get(f"/api/v1/products/{product['id']}").status_code == 404


def test_a_product_with_history_cannot_be_deleted(client, make_product):
    product = make_product()
    buy(client, product["id"], 1, "100.00")

    response = client.delete(f"/api/v1/products/{product['id']}")
    assert response.status_code == 409
    assert "Archive it instead" in response.json()["detail"]


def test_voided_history_still_blocks_deletion(client, make_product):
    product = make_product()
    purchase = buy(client, product["id"], 1, "100.00")
    client.post(f"/api/v1/purchases/{purchase['id']}/void", json={"reason": "mistake"})

    assert client.delete(f"/api/v1/products/{product['id']}").status_code == 409


def test_deleting_a_missing_product_is_404(client):
    assert client.delete(f"/api/v1/products/{uuid.uuid4()}").status_code == 404


# ------------------------------------------------------------------- stock filtering


def test_products_can_be_filtered_by_stock(client, make_product):
    in_stock = make_product("Alpha Box")
    sold_out = make_product("Beta Box")
    buy(client, in_stock["id"], 2, "200.00")
    buy(client, sold_out["id"], 1, "100.00")
    sell(client, sold_out["id"], 1, "150.00")

    only_in = client.get("/api/v1/products", params={"stock": "in"}).json()
    assert [item["name"] for item in only_in["items"]] == ["Alpha Box"]

    only_out = client.get("/api/v1/products", params={"stock": "out"}).json()
    assert [item["name"] for item in only_out["items"]] == ["Beta Box"]


def test_the_product_list_carries_stock_and_cost(client, make_product):
    product = make_product("Alpha Box")
    buy(client, product["id"], 4, "400.00")

    row = client.get("/api/v1/products").json()["items"][0]
    assert row["stats"]["quantity_on_hand"] == 4
    assert row["stats"]["remaining_cost"] == "400.00"


# ----------------------------------------------------------------------- dashboard


def test_the_dashboard_reports_profit_and_roi(client, make_product):
    product = make_product()
    buy(client, product["id"], 4, "400.00")
    sell(client, product["id"], 2, "300.00")

    body = client.get("/api/v1/dashboard").json()

    assert body["realized_profit"] == "100.00"
    assert body["cost_of_sales"] == "200.00"
    assert body["roi"] == pytest.approx(0.5)
    assert body["inventory_at_cost"] == "200.00"
    assert body["total_invested"] == "400.00"
    assert body["total_sales"] == "300.00"
    assert body["units_in_stock"] == 2
    assert body["sale_count"] == 1
    assert body["average_sale"] == "300.00"


def test_the_dashboard_excludes_unknown_cost_sales_and_says_so(client, make_product):
    product = make_product()
    buy(client, product["id"], 1, "100.00")
    sell(client, product["id"], 1, "200.00")
    sell(client, product["id"], 1, "900.00", allow_oversell=True)

    body = client.get("/api/v1/dashboard").json()

    assert body["sale_count"] == 2
    assert body["sales_missing_cost"] == 1
    assert body["realized_profit"] == "100.00", "the unknown sale must not inflate profit"
    assert body["total_sales"] == "1100.00", "but its revenue is still real"


def test_the_dashboard_flags_negative_stock(client, make_product):
    product = make_product()
    sell(client, product["id"], 2, "100.00", allow_oversell=True)

    body = client.get("/api/v1/dashboard").json()
    assert body["products_with_negative_stock"] == 1


def test_write_offs_are_reported_separately_from_profit(client, make_product):
    product = make_product()
    buy(client, product["id"], 2, "200.00")
    client.post(
        "/api/v1/adjustments",
        json={"product_id": product["id"], "quantity_delta": -1, "reason": "opened"},
    )

    body = client.get("/api/v1/dashboard").json()
    assert body["cost_written_off"] == "100.00"
    assert body["realized_profit"] == "0.00", "opening a box is not a trading loss"


def test_an_empty_store_reports_zeroes_not_errors(client):
    body = client.get("/api/v1/dashboard").json()
    assert body["realized_profit"] == "0.00"
    assert body["roi"] is None
    assert body["average_sale"] is None
    assert body["units_in_stock"] == 0


# ------------------------------------------------------------------ period filtering


def test_periods_only_count_sales_inside_them(client, make_product):
    product = make_product()
    buy(client, product["id"], 4, "400.00", on=TODAY - timedelta(days=200))
    sell(client, product["id"], 1, "200.00", on=TODAY - timedelta(days=200))
    sell(client, product["id"], 1, "200.00", on=TODAY)

    all_time = client.get("/api/v1/dashboard", params={"period": "all"}).json()
    recent = client.get("/api/v1/dashboard", params={"period": "30d"}).json()

    assert all_time["sale_count"] == 2
    assert recent["sale_count"] == 1
    assert recent["realized_profit"] == "100.00"


def test_inventory_at_cost_ignores_the_period(client, make_product):
    """A date filter cannot change what is physically on the shelf today."""
    product = make_product()
    buy(client, product["id"], 2, "200.00", on=TODAY - timedelta(days=300))

    recent = client.get("/api/v1/dashboard", params={"period": "30d"}).json()
    assert recent["inventory_at_cost"] == "200.00"
    assert recent["purchases_in_period"] == "0.00", "but the spend was outside the window"
    assert recent["total_invested"] == "200.00", "all-time invested stays all-time"


def test_an_unknown_period_is_rejected(client):
    assert client.get("/api/v1/dashboard", params={"period": "forever"}).status_code == 422


@pytest.mark.parametrize("period", ["all", "ytd", "mtd", "30d"])
def test_every_documented_period_works(client, period):
    assert client.get("/api/v1/dashboard", params={"period": period}).status_code == 200


def test_period_start_boundaries():
    today = date(2026, 7, 28)
    assert reporting.period_start("all", today) is None
    assert reporting.period_start("ytd", today) == date(2026, 1, 1)
    assert reporting.period_start("mtd", today) == date(2026, 7, 1)
    assert reporting.period_start("30d", today) == date(2026, 6, 28)


# --------------------------------------------------------------------------- groups


def test_profit_by_game(client, db, make_product, lorcana_ids):
    pokemon = make_product("Pokemon Box")
    buy(client, pokemon["id"], 2, "200.00")
    sell(client, pokemon["id"], 1, "250.00")

    game_id, type_id = lorcana_ids
    lorcana = client.post(
        "/api/v1/products",
        json={"name": "Lorcana Single", "game_id": str(game_id), "product_type_id": str(type_id)},
    ).json()
    buy(client, lorcana["id"], 1, "50.00")
    sell(client, lorcana["id"], 1, "500.00")

    rows = client.get("/api/v1/reports/by-game").json()
    by_label = {row["label"]: row for row in rows}

    assert by_label["Lorcana"]["realized_profit"] == "450.00"
    assert by_label["Pokémon"]["realized_profit"] == "150.00"
    assert rows[0]["label"] == "Lorcana", "best performer first"
    assert by_label["Pokémon"]["inventory_at_cost"] == "100.00"


def test_by_game_omits_games_with_no_activity(client, make_product):
    product = make_product()
    buy(client, product["id"], 1, "100.00")

    labels = [row["label"] for row in client.get("/api/v1/reports/by-game").json()]
    assert labels == ["Pokémon"], "the other nine seeded games have nothing to report"


def test_seller_activity(client, make_product):
    product = make_product()
    buy(client, product["id"], 2, "200.00")
    sell(client, product["id"], 1, "300.00")

    me = client.get("/api/v1/members/me").json()
    rows = client.get("/api/v1/reports/by-seller").json()

    assert len(rows) == 1
    assert rows[0]["key"] == me["id"]
    assert rows[0]["label"] == me["display_name"]
    assert rows[0]["realized_profit"] == "200.00"
    assert rows[0]["sale_count"] == 1


def test_seller_report_is_empty_before_any_sales(client):
    assert client.get("/api/v1/reports/by-seller").json() == []


@pytest.mark.parametrize("report", ["by-game", "by-seller"])
def test_group_reports_respect_the_period(client, make_product, report: str):
    product = make_product()
    buy(client, product["id"], 4, "400.00", on=TODAY - timedelta(days=200))
    sell(client, product["id"], 1, "200.00", on=TODAY - timedelta(days=200))
    sell(client, product["id"], 1, "200.00", on=TODAY)

    all_time = client.get(f"/api/v1/reports/{report}", params={"period": "all"}).json()
    recent = client.get(f"/api/v1/reports/{report}", params={"period": "30d"}).json()

    assert all_time[0]["sale_count"] == 2
    assert recent[0]["sale_count"] == 1


# ------------------------------------------------------------- optional text fields


def test_blank_optional_text_is_stored_as_null_not_whitespace(client, make_product):
    product = make_product()
    purchase = client.post(
        "/api/v1/purchases",
        json={
            "product_id": product["id"],
            "quantity": 1,
            "amount": "100.00",
            "source": "   ",
            "notes": "",
        },
    ).json()
    assert purchase["source"] is None
    assert purchase["notes"] is None

    sale = client.post(
        "/api/v1/sales",
        json={
            "product_id": product["id"],
            "quantity": 1,
            "amount": "200.00",
            "marketplace": "  ",
            "notes": "   ",
        },
    ).json()
    assert sale["marketplace"] is None
    assert sale["notes"] is None

    adjustment = client.post(
        "/api/v1/adjustments",
        json={
            "product_id": product["id"],
            "quantity_delta": 1,
            "reason": "correction",
            "notes": "  ",
        },
    ).json()
    assert adjustment["notes"] is None


def test_explicit_null_optional_text_is_accepted(client, make_product):
    """Distinct from omitting the field: sending null clears it deliberately."""
    product = make_product()
    purchase = client.post(
        "/api/v1/purchases",
        json={
            "product_id": product["id"],
            "quantity": 1,
            "amount": "100.00",
            "source": None,
            "notes": None,
        },
    )
    assert purchase.status_code == 201
    assert purchase.json()["source"] is None


def test_optional_text_survives_when_it_has_content(client, make_product):
    product = make_product()
    purchase = client.post(
        "/api/v1/purchases",
        json={
            "product_id": product["id"],
            "quantity": 1,
            "amount": "100.00",
            "source": "  Facebook Marketplace  ",
            "notes": "sealed",
        },
    ).json()
    assert purchase["source"] == "Facebook Marketplace"
    assert purchase["notes"] == "sealed"


# ------------------------------------------------------------------------ attention


def test_attention_lists_data_problems(client, make_product):
    product = make_product("Oversold Box")
    sell(client, product["id"], 2, "100.00", allow_oversell=True)

    body = client.get("/api/v1/reports/attention").json()

    assert body["sales_missing_cost"] == 1
    assert body["products_with_negative_stock"] == 1
    assert body["negative_stock_products"][0]["name"] == "Oversold Box"
    assert body["negative_stock_products"][0]["quantity"] == -2


def test_attention_counts_sold_out_products(client, make_product):
    product = make_product()
    buy(client, product["id"], 1, "100.00")
    sell(client, product["id"], 1, "150.00")

    body = client.get("/api/v1/reports/attention").json()
    assert body["products_out_of_stock"] == 1
    assert body["products_with_negative_stock"] == 0


def test_attention_is_clean_for_a_healthy_store(client, make_product):
    product = make_product()
    buy(client, product["id"], 5, "500.00")
    sell(client, product["id"], 1, "150.00")

    body = client.get("/api/v1/reports/attention").json()
    assert body == {
        "sales_missing_cost": 0,
        "products_with_negative_stock": 0,
        "undated_sales": 0,
        "products_out_of_stock": 0,
        "negative_stock_products": [],
    }


# ------------------------------------------------------------------ reconciliation


def test_dashboard_totals_reconcile_with_the_products_beneath_them(client, make_product):
    """Accuracy criterion 10, computed independently from the product rows."""
    first = make_product("Alpha")
    second = make_product("Beta")
    buy(client, first["id"], 4, "400.00")
    buy(client, second["id"], 2, "300.00")
    sell(client, first["id"], 2, "300.00")
    sell(client, second["id"], 1, "200.00", platform_fees="10.00")

    dashboard = client.get("/api/v1/dashboard").json()
    products = client.get("/api/v1/products").json()["items"]

    def total(field):
        return sum(round(float(p["stats"][field]) * 100) for p in products)

    assert round(float(dashboard["realized_profit"]) * 100) == total("realized_profit")
    assert round(float(dashboard["inventory_at_cost"]) * 100) == total("remaining_cost")
    assert round(float(dashboard["total_invested"]) * 100) == total("total_invested")
    assert round(float(dashboard["total_sales"]) * 100) == total("gross_revenue")
    assert dashboard["units_in_stock"] == sum(p["stats"]["quantity_on_hand"] for p in products)


# -------------------------------------------------------------------------- history


def test_history_is_newest_first_and_includes_voided_rows(client, make_product):
    product = make_product()
    purchase = buy(client, product["id"], 3, "300.00", on=TODAY - timedelta(days=10))
    sell(client, product["id"], 1, "200.00", on=TODAY - timedelta(days=1))
    client.post(f"/api/v1/purchases/{purchase['id']}/void", json={"reason": "wrong"})

    history = client.get(f"/api/v1/products/{product['id']}").json()["history"]

    assert [row["kind"] for row in history] == ["sale", "purchase"]
    assert history[1]["status"] == "voided", "voided rows stay visible - they explain a change"
    assert history[0]["quantity"] == -1, "sales are negative in a stock-movement list"


def test_history_shows_adjustment_reasons(client, make_product):
    product = make_product()
    buy(client, product["id"], 2, "200.00")
    client.post(
        "/api/v1/adjustments",
        json={"product_id": product["id"], "quantity_delta": -1, "reason": "damaged"},
    )

    history = client.get(f"/api/v1/products/{product['id']}").json()["history"]
    adjustment = next(row for row in history if row["kind"] == "adjustment")
    assert adjustment["label"] == "damaged"
    assert adjustment["cost"] == "100.00"
