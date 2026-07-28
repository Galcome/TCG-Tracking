"""Tests for the cross-product sales ledger and the by-marketplace report."""

import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import select

from src.models.taxonomy import Game, ProductType

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
    response = client.post(
        "/api/v1/sales",
        json={
            "product_id": product_id,
            "quantity": quantity,
            "amount": amount,
            "sale_date": (on or TODAY).isoformat(),
            **extra,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


# ------------------------------------------------------------------- the ledger


def test_sales_are_listed_across_every_product(client, make_product):
    first = make_product("Alpha Box")
    second = make_product("Beta Box")
    buy(client, first["id"], 2, "200.00")
    buy(client, second["id"], 2, "200.00")
    sell(client, first["id"], 1, "150.00")
    sell(client, second["id"], 1, "180.00")

    body = client.get("/api/v1/sales").json()

    assert body["total"] == 2
    assert {row["product"]["name"] for row in body["items"]} == {"Alpha Box", "Beta Box"}


def test_each_row_carries_its_product_so_the_client_need_not_refetch(client, make_product):
    product = make_product("Vivid Voltage Booster Box")
    buy(client, product["id"], 1, "150.00")
    sell(client, product["id"], 1, "200.00")

    row = client.get("/api/v1/sales").json()["items"][0]

    assert row["product"]["id"] == product["id"]
    assert row["product"]["name"] == "Vivid Voltage Booster Box"
    assert row["product"]["game"]["slug"] == "pokemon"
    assert row["product"]["product_type"]["slug"] == "booster-box"


def test_money_stays_a_decimal_string(client, make_product):
    product = make_product()
    buy(client, product["id"], 1, "150.00")
    sell(client, product["id"], 1, "200.00", platform_fees="10.00")

    row = client.get("/api/v1/sales").json()["items"][0]
    assert row["amount"] == "200.00"
    assert row["platform_fees"] == "10.00"
    assert row["net_proceeds"] == "190.00"
    assert row["cost_basis"] == "150.00"
    assert row["realized_profit"] == "40.00"


def test_unknown_cost_is_null_never_zero(client, make_product):
    product = make_product()
    sell(client, product["id"], 1, "200.00", allow_oversell=True)

    row = client.get("/api/v1/sales").json()["items"][0]
    assert row["has_unknown_cost"] is True
    assert row["cost_basis"] is None
    assert row["realized_profit"] is None


def test_newest_sales_come_first(client, make_product):
    product = make_product()
    buy(client, product["id"], 3, "300.00", on=TODAY - timedelta(days=10))
    sell(client, product["id"], 1, "100.00", on=TODAY - timedelta(days=5))
    sell(client, product["id"], 1, "200.00", on=TODAY - timedelta(days=1))

    amounts = [row["amount"] for row in client.get("/api/v1/sales").json()["items"]]
    assert amounts == ["200.00", "100.00"]


def test_voided_sales_stay_visible_and_flagged(client, make_product):
    product = make_product()
    buy(client, product["id"], 2, "200.00")
    sale = sell(client, product["id"], 1, "150.00")
    client.post(f"/api/v1/sales/{sale['id']}/void", json={"reason": "buyer backed out"})

    body = client.get("/api/v1/sales").json()

    assert body["total"] == 1, "a voided sale explains why a number changed - keep it"
    assert body["items"][0]["status"] == "voided"


# ---------------------------------------------------------------------- filters


def test_filter_by_product_name(client, make_product):
    alpha = make_product("Vivid Voltage Booster Box")
    beta = make_product("Brilliant Stars Booster Box")
    for product in (alpha, beta):
        buy(client, product["id"], 1, "100.00")
        sell(client, product["id"], 1, "150.00")

    body = client.get("/api/v1/sales", params={"q": "vivid"}).json()
    assert body["total"] == 1
    assert body["items"][0]["product"]["name"] == "Vivid Voltage Booster Box"


def test_search_wildcards_are_literal(client, make_product):
    product = make_product()
    buy(client, product["id"], 1, "100.00")
    sell(client, product["id"], 1, "150.00")

    assert client.get("/api/v1/sales", params={"q": "%"}).json()["total"] == 0


def test_filter_by_marketplace(client, make_product):
    product = make_product()
    buy(client, product["id"], 3, "300.00")
    sell(client, product["id"], 1, "150.00", marketplace="eBay")
    sell(client, product["id"], 1, "160.00", marketplace="Facebook")

    body = client.get("/api/v1/sales", params={"marketplace": "eBay"}).json()
    assert body["total"] == 1
    assert body["items"][0]["marketplace"] == "eBay"


def test_filter_by_unspecified_marketplace(client, make_product):
    product = make_product()
    buy(client, product["id"], 3, "300.00")
    sell(client, product["id"], 1, "150.00", marketplace="eBay")
    sell(client, product["id"], 1, "160.00")

    body = client.get("/api/v1/sales", params={"marketplace": "Unspecified"}).json()
    assert body["total"] == 1
    assert body["items"][0]["marketplace"] is None


def test_filter_by_seller(client, make_product):
    product = make_product()
    buy(client, product["id"], 2, "200.00")
    sell(client, product["id"], 1, "150.00")
    me = client.get("/api/v1/members/me").json()

    assert client.get("/api/v1/sales", params={"sold_by_member_id": me["id"]}).json()["total"] == 1
    assert (
        client.get("/api/v1/sales", params={"sold_by_member_id": str(uuid.uuid4())}).json()["total"]
        == 0
    )


def test_filter_by_game(client, make_product, lorcana_ids):
    pokemon = make_product("Pokemon Box")
    buy(client, pokemon["id"], 1, "100.00")
    sell(client, pokemon["id"], 1, "150.00")

    game_id, type_id = lorcana_ids
    lorcana = client.post(
        "/api/v1/products",
        json={"name": "Lorcana Single", "game_id": str(game_id), "product_type_id": str(type_id)},
    ).json()
    buy(client, lorcana["id"], 1, "50.00")
    sell(client, lorcana["id"], 1, "90.00")

    body = client.get("/api/v1/sales", params={"game": "lorcana"}).json()
    assert body["total"] == 1
    assert body["items"][0]["product"]["name"] == "Lorcana Single"


def test_period_filters_the_ledger(client, make_product):
    product = make_product()
    buy(client, product["id"], 4, "400.00", on=TODAY - timedelta(days=200))
    sell(client, product["id"], 1, "150.00", on=TODAY - timedelta(days=200))
    sell(client, product["id"], 1, "160.00", on=TODAY)

    assert client.get("/api/v1/sales", params={"period": "all"}).json()["total"] == 2
    assert client.get("/api/v1/sales", params={"period": "30d"}).json()["total"] == 1


def test_an_unknown_period_is_rejected(client):
    assert client.get("/api/v1/sales", params={"period": "forever"}).status_code == 422


def test_filters_combine(client, make_product):
    product = make_product("Vivid Voltage Booster Box")
    buy(client, product["id"], 3, "300.00")
    sell(client, product["id"], 1, "150.00", marketplace="eBay")
    sell(client, product["id"], 1, "160.00", marketplace="Facebook")

    body = client.get("/api/v1/sales", params={"q": "vivid", "marketplace": "eBay"}).json()
    assert body["total"] == 1


# ------------------------------------------------------------------- pagination


def test_pagination_reports_the_full_total(client, make_product):
    product = make_product()
    buy(client, product["id"], 5, "500.00")
    for _ in range(3):
        sell(client, product["id"], 1, "150.00")

    body = client.get("/api/v1/sales", params={"limit": 2}).json()
    assert body["total"] == 3, "total is the whole result set, not the page"
    assert len(body["items"]) == 2
    assert body["limit"] == 2
    assert body["offset"] == 0

    second = client.get("/api/v1/sales", params={"limit": 2, "offset": 2}).json()
    assert len(second["items"]) == 1


def test_paging_does_not_repeat_or_drop_rows(client, make_product):
    """Same-day sales must still page deterministically."""
    product = make_product()
    buy(client, product["id"], 6, "600.00")
    for _ in range(5):
        sell(client, product["id"], 1, "150.00")

    first = client.get("/api/v1/sales", params={"limit": 3}).json()["items"]
    second = client.get("/api/v1/sales", params={"limit": 3, "offset": 3}).json()["items"]

    ids = [row["id"] for row in first + second]
    assert len(ids) == 5
    assert len(set(ids)) == 5


@pytest.mark.parametrize(("limit", "offset"), [(0, 0), (201, 0), (10, -1)])
def test_pagination_bounds_are_enforced(client, limit: int, offset: int):
    response = client.get("/api/v1/sales", params={"limit": limit, "offset": offset})
    assert response.status_code == 422


def test_an_empty_ledger_is_an_empty_envelope(client):
    body = client.get("/api/v1/sales").json()
    assert body == {"items": [], "total": 0, "limit": 50, "offset": 0}


# --------------------------------------------------------------- by-marketplace


def test_marketplace_report_groups_and_ranks(client, make_product):
    product = make_product()
    buy(client, product["id"], 4, "400.00")
    sell(client, product["id"], 1, "300.00", marketplace="eBay")
    sell(client, product["id"], 1, "150.00", marketplace="Facebook")

    rows = client.get("/api/v1/reports/by-marketplace").json()
    by_label = {row["label"]: row for row in rows}

    assert by_label["eBay"]["realized_profit"] == "200.00"
    assert by_label["Facebook"]["realized_profit"] == "50.00"
    assert rows[0]["label"] == "eBay", "best first"


def test_sales_without_a_marketplace_collapse_into_one_row(client, make_product):
    product = make_product()
    buy(client, product["id"], 4, "400.00")
    sell(client, product["id"], 1, "150.00")
    sell(client, product["id"], 1, "160.00")
    sell(client, product["id"], 1, "300.00", marketplace="eBay")

    rows = client.get("/api/v1/reports/by-marketplace").json()
    by_label = {row["label"]: row for row in rows}

    assert by_label["Unspecified"]["sale_count"] == 2, "unrecorded revenue is still revenue"
    assert by_label["eBay"]["sale_count"] == 1


def test_marketplace_report_excludes_unknown_cost_from_profit(client, make_product):
    product = make_product()
    buy(client, product["id"], 1, "100.00")
    sell(client, product["id"], 1, "200.00", marketplace="eBay")
    sell(client, product["id"], 1, "900.00", marketplace="eBay", allow_oversell=True)

    row = client.get("/api/v1/reports/by-marketplace").json()[0]

    assert row["sale_count"] == 2
    assert row["sales_missing_cost"] == 1
    assert row["realized_profit"] == "100.00"
    assert row["revenue"] == "1100.00", "revenue is still real"


def test_marketplace_report_respects_the_period(client, make_product):
    product = make_product()
    buy(client, product["id"], 4, "400.00", on=TODAY - timedelta(days=200))
    sell(client, product["id"], 1, "150.00", marketplace="eBay", on=TODAY - timedelta(days=200))
    sell(client, product["id"], 1, "160.00", marketplace="eBay", on=TODAY)

    assert client.get("/api/v1/reports/by-marketplace").json()[0]["sale_count"] == 2
    recent = client.get("/api/v1/reports/by-marketplace", params={"period": "30d"}).json()
    assert recent[0]["sale_count"] == 1


def test_marketplace_report_ignores_voided_sales(client, make_product):
    product = make_product()
    buy(client, product["id"], 2, "200.00")
    sale = sell(client, product["id"], 1, "150.00", marketplace="eBay")
    client.post(f"/api/v1/sales/{sale['id']}/void", json={"reason": "returned"})

    assert client.get("/api/v1/reports/by-marketplace").json() == []


def test_marketplace_report_is_empty_before_any_sales(client):
    assert client.get("/api/v1/reports/by-marketplace").json() == []
