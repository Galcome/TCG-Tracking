"""Tests for what the Inventory list shows, and for editing adjustments.

Inventory answers "what does the store hold". A product that sold out belongs in the
sales record, not in the stock list - but it must stay retrievable, and an oversell must
stay visible, because this is the screen where that gets corrected.
"""

import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import select

from src.models.audit import AuditLog

TODAY = date.today()


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


def sell(client, product_id, quantity, amount, **extra):
    response = client.post(
        "/api/v1/sales",
        json={
            "product_id": product_id,
            "quantity": quantity,
            "amount": amount,
            "sale_date": TODAY.isoformat(),
            **extra,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def adjust(client, product_id, delta, reason="damaged", **extra):
    response = client.post(
        "/api/v1/adjustments",
        json={
            "product_id": product_id,
            "quantity_delta": delta,
            "reason": reason,
            "adjustment_date": TODAY.isoformat(),
            **extra,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def names(body) -> list[str]:
    return [item["name"] for item in body["items"]]


# ------------------------------------------------------------------ the stock view


def test_sold_out_products_leave_the_in_stock_view(client, make_product):
    held = make_product("Still Here")
    gone = make_product("All Sold")
    buy(client, held["id"], 2, "200.00")
    buy(client, gone["id"], 1, "100.00")
    sell(client, gone["id"], 1, "150.00")

    assert names(client.get("/api/v1/products", params={"stock": "in"}).json()) == ["Still Here"]
    assert names(client.get("/api/v1/products", params={"stock": "out"}).json()) == ["All Sold"]


def test_everything_is_still_reachable_without_a_filter(client, make_product):
    held = make_product("Still Here")
    gone = make_product("All Sold")
    buy(client, held["id"], 2, "200.00")
    buy(client, gone["id"], 1, "100.00")
    sell(client, gone["id"], 1, "150.00")

    body = client.get("/api/v1/products").json()
    assert sorted(names(body)) == ["All Sold", "Still Here"]
    assert body["total"] == 2


def test_negative_stock_stays_in_the_in_stock_view(client, make_product):
    """An oversell is a data error, and this list is where it gets fixed."""
    oversold = make_product("Oversold Box")
    sell(client, oversold["id"], 2, "300.00", allow_oversell=True)

    body = client.get("/api/v1/products", params={"stock": "in"}).json()

    assert names(body) == ["Oversold Box"]
    assert body["items"][0]["stats"]["quantity_on_hand"] == -2
    assert names(client.get("/api/v1/products", params={"stock": "out"}).json()) == []


def test_a_product_with_no_transactions_counts_as_sold_out(client, make_product):
    """Created by mistake, never bought. Not stock, but must remain findable."""
    make_product("Pitch Black")

    assert names(client.get("/api/v1/products", params={"stock": "in"}).json()) == []
    assert names(client.get("/api/v1/products", params={"stock": "out"}).json()) == ["Pitch Black"]


def test_stock_written_off_leaves_the_in_stock_view(client, make_product):
    product = make_product("Opened Box")
    buy(client, product["id"], 1, "100.00")
    adjust(client, product["id"], -1, "opened")

    assert names(client.get("/api/v1/products", params={"stock": "in"}).json()) == []
    assert names(client.get("/api/v1/products", params={"stock": "out"}).json()) == ["Opened Box"]


# ------------------------------------------------------------------- pagination


def test_total_counts_the_whole_filtered_set_not_the_page(client, make_product):
    """Filtering a page and reporting its length was turning 12 products into 5."""
    for index in range(12):
        product = make_product(f"Box {index:02d}")
        buy(client, product["id"], 1, "100.00")

    body = client.get("/api/v1/products", params={"stock": "in", "limit": 5}).json()

    assert body["total"] == 12, "total is the filtered set, not this page"
    assert len(body["items"]) == 5


def test_paging_with_a_stock_filter_walks_the_whole_set(client, make_product):
    for index in range(7):
        product = make_product(f"Box {index:02d}")
        buy(client, product["id"], 1, "100.00")
    # One sold-out product that must never appear in the in-stock pages.
    gone = make_product("Zeta Gone")
    buy(client, gone["id"], 1, "100.00")
    sell(client, gone["id"], 1, "150.00")

    seen: list[str] = []
    for offset in (0, 3, 6):
        page = client.get(
            "/api/v1/products", params={"stock": "in", "limit": 3, "offset": offset}
        ).json()
        seen.extend(names(page))

    assert len(seen) == 7
    assert len(set(seen)) == 7, "no product appears on two pages"
    assert "Zeta Gone" not in seen


def test_search_and_stock_filter_combine(client, make_product):
    held = make_product("Vivid Voltage Booster Box")
    gone = make_product("Vivid Voltage Single")
    buy(client, held["id"], 1, "100.00")
    buy(client, gone["id"], 1, "50.00")
    sell(client, gone["id"], 1, "90.00")

    body = client.get("/api/v1/products", params={"q": "vivid", "stock": "in"}).json()
    assert names(body) == ["Vivid Voltage Booster Box"]
    assert body["total"] == 1


# --------------------------------------------------------------- editing adjustments


def test_editing_an_adjustment_recomputes_stock(client, make_product):
    product = make_product()
    buy(client, product["id"], 5, "500.00")
    adjustment = adjust(client, product["id"], -1, "damaged")

    assert client.get(f"/api/v1/products/{product['id']}").json()["stats"][
        "quantity_on_hand"
    ] == 4

    response = client.patch(
        f"/api/v1/adjustments/{adjustment['id']}",
        json={"quantity_delta": -3, "audit_reason": "found two more broken"},
    )
    assert response.status_code == 200
    assert response.json()["quantity_delta"] == -3

    stats = client.get(f"/api/v1/products/{product['id']}").json()["stats"]
    assert stats["quantity_on_hand"] == 2
    assert stats["cost_written_off"] == "300.00", "written-off cost follows the quantity"


def test_editing_an_adjustment_can_change_its_reason(client, make_product):
    product = make_product()
    buy(client, product["id"], 2, "200.00")
    adjustment = adjust(client, product["id"], -1, "missing")

    body = client.patch(
        f"/api/v1/adjustments/{adjustment['id']}", json={"reason": "damaged"}
    ).json()
    assert body["reason"] == "damaged"


def test_editing_an_adjustment_writes_an_audit_diff(client, db, make_product):
    product = make_product()
    buy(client, product["id"], 5, "500.00")
    adjustment = adjust(client, product["id"], -1, "damaged")

    client.patch(
        f"/api/v1/adjustments/{adjustment['id']}",
        json={"quantity_delta": -2, "audit_reason": "recounted"},
    )

    entry = db.scalar(
        select(AuditLog).where(
            AuditLog.entity_id == uuid.UUID(adjustment["id"]), AuditLog.action == "update"
        )
    )
    assert entry.before == {"quantity_delta": -1}
    assert entry.after == {"quantity_delta": -2}
    assert entry.reason == "recounted"


def test_a_cost_cannot_be_added_to_stock_leaving(client, make_product):
    """Checked against the merged row: sending only a cost must not slip past."""
    product = make_product()
    buy(client, product["id"], 2, "200.00")
    adjustment = adjust(client, product["id"], -1, "damaged")

    response = client.patch(
        f"/api/v1/adjustments/{adjustment['id']}", json={"cost": "10.00"}
    )
    assert response.status_code == 422
    assert "adding stock" in response.json()["detail"]


def test_a_cost_is_allowed_when_the_edit_also_flips_it_positive(client, make_product):
    product = make_product()
    adjustment = adjust(client, product["id"], -1, "damaged")

    response = client.patch(
        f"/api/v1/adjustments/{adjustment['id']}",
        json={"quantity_delta": 3, "reason": "opening_inventory", "cost": "300.00"},
    )
    assert response.status_code == 200

    stats = client.get(f"/api/v1/products/{product['id']}").json()["stats"]
    assert stats["quantity_on_hand"] == 3
    assert stats["total_invested"] == "300.00"


@pytest.mark.parametrize(
    "payload",
    [
        {"quantity_delta": 0},
        {"reason": "vibes"},
        {"quantity_delta": None},
        {"reason": None},
        {"adjustment_date": None},
    ],
)
def test_invalid_adjustment_edits_are_rejected(client, make_product, payload: dict):
    product = make_product()
    adjustment = adjust(client, product["id"], -1, "damaged")

    response = client.patch(f"/api/v1/adjustments/{adjustment['id']}", json=payload)
    assert response.status_code == 422, payload


def test_a_voided_adjustment_cannot_be_edited(client, make_product):
    product = make_product()
    adjustment = adjust(client, product["id"], -1, "damaged")
    client.post(f"/api/v1/adjustments/{adjustment['id']}/void", json={"reason": "wrong"})

    response = client.patch(
        f"/api/v1/adjustments/{adjustment['id']}", json={"quantity_delta": -2}
    )
    assert response.status_code == 409


def test_editing_a_missing_adjustment_is_404(client):
    response = client.patch(
        f"/api/v1/adjustments/{uuid.uuid4()}", json={"quantity_delta": -1}
    )
    assert response.status_code == 404


def test_editing_an_adjustment_date_reallocates_cost(client, make_product):
    """Moving an adjustment earlier makes it consume the older, cheaper lot."""
    product = make_product()
    buy(client, product["id"], 1, "100.00", TODAY - timedelta(days=30))
    buy(client, product["id"], 1, "500.00", TODAY - timedelta(days=1))
    adjustment = adjust(client, product["id"], -1, "damaged")

    # Dated today, it still takes the oldest lot - FIFO, not most-recent.
    assert client.get(f"/api/v1/products/{product['id']}").json()["stats"][
        "cost_written_off"
    ] == "100.00"

    client.patch(
        f"/api/v1/adjustments/{adjustment['id']}",
        json={"adjustment_date": (TODAY - timedelta(days=15)).isoformat()},
    )
    stats = client.get(f"/api/v1/products/{product['id']}").json()["stats"]
    assert stats["cost_written_off"] == "100.00"
    assert stats["remaining_cost"] == "500.00"


def test_editing_notes_leaves_everything_else_alone(client, make_product):
    product = make_product()
    buy(client, product["id"], 3, "300.00")
    adjustment = adjust(client, product["id"], -1, "damaged")

    body = client.patch(
        f"/api/v1/adjustments/{adjustment['id']}", json={"notes": "  water damage  "}
    ).json()

    assert body["notes"] == "water damage"
    assert body["quantity_delta"] == -1
    assert body["reason"] == "damaged"
