"""Tests for shelf time and the velocity figures built on it."""

import uuid
from datetime import date, datetime, timedelta

import pytest

from src.services.costing import Event, allocate

BASE_TIME = datetime(2026, 1, 1, 12, 0, 0)
TODAY = date.today()


def supply(qty: int, cost: int | None, on: date | None = None, seq: int = 0) -> Event:
    return Event(
        id=uuid.uuid4(),
        quantity=qty,
        is_supply=True,
        occurred_on=on,
        created_at=BASE_TIME + timedelta(seconds=seq),
        landed_cost_cents=cost,
    )


def consume(qty: int, on: date | None = None, seq: int = 0) -> Event:
    return Event(
        id=uuid.uuid4(),
        quantity=qty,
        is_supply=False,
        occurred_on=on,
        created_at=BASE_TIME + timedelta(seconds=seq),
    )


# ------------------------------------------------------------------ the engine


def test_a_single_lot_sale_reports_its_shelf_time():
    purchase = supply(2, 20000, date(2026, 1, 1), seq=0)
    sale = consume(1, date(2026, 1, 31), seq=1)

    result = allocate([purchase, sale])
    assert result.consumers[sale.id].days_held_weighted == 30


def test_same_day_sales_are_zero_days_not_unknown():
    day = date(2026, 3, 1)
    result = allocate([supply(1, 10000, day, seq=0), (sale := consume(1, day, seq=1))])
    assert result.consumers[sale.id].days_held_weighted == 0


def test_mixed_lots_are_quantity_weighted():
    """2 units held 100 days and 1 held 10 -> (2x100 + 1x10) / 3 = 70."""
    old = supply(2, 20000, date(2026, 1, 1), seq=0)
    recent = supply(1, 10000, date(2026, 4, 1), seq=1)
    sale = consume(3, date(2026, 4, 11), seq=2)

    result = allocate([old, recent, sale])
    assert result.consumers[sale.id].days_held_weighted == 70


def test_weighting_is_not_a_plain_mean_of_lots():
    """A big cheap lot must dominate a single old unit."""
    old = supply(1, 10000, date(2026, 1, 1), seq=0)
    bulk = supply(9, 90000, date(2026, 3, 22), seq=1)
    sale = consume(10, date(2026, 4, 1), seq=2)

    result = allocate([old, bulk, sale])
    # (1x90 + 9x10) / 10 = 18, not the unweighted (90 + 10) / 2 = 50.
    assert result.consumers[sale.id].days_held_weighted == 18


def test_an_undated_lot_leaves_hold_time_unknown():
    undated = supply(1, 10000, None, seq=0)
    sale = consume(1, date(2026, 5, 1), seq=1)

    result = allocate([undated, sale])
    assert result.consumers[sale.id].days_held_weighted is None


def test_one_undated_lot_poisons_a_mixed_sale():
    """Same rule the cost side follows: partly unknown is unknown."""
    undated = supply(1, 10000, None, seq=0)
    dated = supply(1, 10000, date(2026, 1, 1), seq=1)
    sale = consume(2, date(2026, 3, 1), seq=2)

    result = allocate([undated, dated, sale])
    assert result.consumers[sale.id].days_held_weighted is None


def test_an_undated_sale_has_no_hold_time():
    purchase = supply(1, 10000, date(2026, 1, 1), seq=0)
    sale = consume(1, None, seq=1)

    result = allocate([purchase, sale])
    assert result.consumers[sale.id].days_held_weighted is None


def test_overselling_leaves_hold_time_unknown():
    """Units that were never bought have no shelf time to report."""
    purchase = supply(1, 10000, date(2026, 1, 1), seq=0)
    sale = consume(3, date(2026, 2, 1), seq=1)

    result = allocate([purchase, sale])
    assert result.consumers[sale.id].days_held_weighted is None
    assert result.consumers[sale.id].has_unknown_cost is True


def test_a_sale_cannot_borrow_stock_from_the_future():
    """A sale dated before every lot draws from nothing rather than producing negative
    shelf time - which is why hold time never needs clamping."""
    purchase = supply(1, 10000, date(2026, 6, 1), seq=0)
    sale = consume(1, date(2026, 1, 1), seq=1)

    result = allocate([purchase, sale])
    outcome = result.consumers[sale.id]

    assert outcome.days_held_weighted is None
    assert outcome.has_unknown_cost is True
    assert result.quantity_on_hand == 1, "the later lot is untouched and still in stock"


def test_hold_time_survives_a_rebuild_unchanged():
    events = [supply(3, 30000, date(2026, 1, 1), seq=0), consume(2, date(2026, 2, 1), seq=1)]
    first = allocate(events)
    second = allocate(events)
    assert [c.days_held_weighted for c in first.consumers.values()] == [
        c.days_held_weighted for c in second.consumers.values()
    ]


def test_negative_adjustments_also_get_a_hold_time():
    """A write-off consumes lots like a sale, so shelf time applies to it too."""
    purchase = supply(2, 20000, date(2026, 1, 1), seq=0)
    written_off = consume(1, date(2026, 2, 20), seq=1)

    result = allocate([purchase, written_off])
    assert result.consumers[written_off.id].days_held_weighted == 50


# ------------------------------------------------------------------ persistence


def buy(client, product_id, quantity, amount, on):
    return client.post(
        "/api/v1/purchases",
        json={
            "product_id": product_id,
            "quantity": quantity,
            "amount": amount,
            "purchase_date": on.isoformat(),
        },
    ).json()


def sell(client, product_id, quantity, amount, on, **extra):
    response = client.post(
        "/api/v1/sales",
        json={
            "product_id": product_id,
            "quantity": quantity,
            "amount": amount,
            "sale_date": on.isoformat(),
            **extra,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_hold_time_is_persisted_and_exposed(client, make_product):
    product = make_product()
    buy(client, product["id"], 2, "200.00", TODAY - timedelta(days=45))
    sale = sell(client, product["id"], 1, "150.00", TODAY)

    assert sale["days_held_weighted"] == 45


def test_hold_time_is_null_when_unknown(client, make_product):
    product = make_product()
    sale = sell(client, product["id"], 1, "150.00", TODAY, allow_oversell=True)
    assert sale["days_held_weighted"] is None


def test_editing_a_purchase_date_recomputes_hold_time(client, db, make_product):
    """Correcting a receipt date must move the shelf time it implies."""
    from sqlalchemy import select

    from src.models.ledger import Sale

    product = make_product()
    purchase = buy(client, product["id"], 1, "100.00", TODAY - timedelta(days=10))
    sale = sell(client, product["id"], 1, "150.00", TODAY)
    assert sale["days_held_weighted"] == 10

    client.patch(
        f"/api/v1/purchases/{purchase['id']}",
        json={
            "purchase_date": (TODAY - timedelta(days=100)).isoformat(),
            "reason": "receipt was older than recorded",
        },
    )

    stored = db.scalar(select(Sale).where(Sale.id == uuid.UUID(sale["id"])))
    db.refresh(stored)
    assert stored.days_held_weighted == 100


def test_voiding_the_funding_purchase_makes_hold_time_unknown(client, db, make_product):
    from sqlalchemy import select

    from src.models.ledger import Sale

    product = make_product()
    purchase = buy(client, product["id"], 2, "200.00", TODAY - timedelta(days=30))
    sale = sell(client, product["id"], 1, "150.00", TODAY)

    client.post(f"/api/v1/purchases/{purchase['id']}/void", json={"reason": "never happened"})

    stored = db.scalar(select(Sale).where(Sale.id == uuid.UUID(sale["id"])))
    db.refresh(stored)
    assert stored.days_held_weighted is None, "nothing left to have held"
    assert stored.has_unknown_cost is True


# ------------------------------------------------------------------- reporting


def test_group_reports_carry_velocity_figures(client, make_product):
    product = make_product()
    buy(client, product["id"], 4, "400.00", TODAY - timedelta(days=60))
    sell(client, product["id"], 2, "300.00", TODAY)

    row = client.get("/api/v1/reports/by-game").json()[0]

    assert row["avg_days_held"] == 60
    assert row["units_sold"] == 2
    assert row["units_purchased"] == 4
    assert row["sell_through"] == pytest.approx(0.5)
    # $100 profit over 60 days.
    assert row["profit_per_day"] == "1.67"


def test_profit_per_day_is_null_for_same_day_sales(client, make_product):
    product = make_product()
    buy(client, product["id"], 2, "200.00", TODAY)
    sell(client, product["id"], 1, "150.00", TODAY)

    row = client.get("/api/v1/reports/by-game").json()[0]
    assert row["avg_days_held"] == 0
    assert row["profit_per_day"] is None, "dividing by zero days would report an infinite rate"


def test_sell_through_is_null_without_purchases(client, make_product):
    product = make_product()
    sell(client, product["id"], 1, "150.00", TODAY, allow_oversell=True)

    row = client.get("/api/v1/reports/by-game").json()[0]
    assert row["sell_through"] is None


def test_stock_ageing_buckets_units_on_hand(client, make_product):
    product = make_product()
    buy(client, product["id"], 2, "200.00", TODAY - timedelta(days=5))
    buy(client, product["id"], 3, "300.00", TODAY - timedelta(days=60))
    buy(client, product["id"], 5, "500.00", TODAY - timedelta(days=120))
    buy(client, product["id"], 4, "400.00", TODAY - timedelta(days=200))

    row = client.get("/api/v1/reports/by-game").json()[0]

    assert row["units_by_age"] == {"d0_30": 2, "d31_90": 3, "d91_180": 5, "d180_plus": 4}


@pytest.mark.parametrize(
    ("days", "bucket"),
    [
        (0, "d0_30"),
        (30, "d0_30"),
        (31, "d31_90"),
        (90, "d31_90"),
        (91, "d91_180"),
        (180, "d91_180"),
        (181, "d180_plus"),
    ],
)
def test_ageing_bucket_boundaries(days: int, bucket: str):
    """Each bound belongs to the lower bucket - 30 days is still "0-30"."""
    from src.services.reporting import UnitsByAge

    ages = UnitsByAge()
    ages.add(days, 1)
    assert getattr(ages, bucket) == 1
    assert sum((ages.d0_30, ages.d31_90, ages.d91_180, ages.d180_plus)) == 1


def test_selling_ages_out_of_the_oldest_bucket_first(client, make_product):
    product = make_product()
    buy(client, product["id"], 2, "200.00", TODAY - timedelta(days=200))
    buy(client, product["id"], 2, "200.00", TODAY - timedelta(days=5))
    sell(client, product["id"], 2, "300.00", TODAY)

    row = client.get("/api/v1/reports/by-game").json()[0]
    assert row["units_by_age"] == {"d0_30": 2, "d31_90": 0, "d91_180": 0, "d180_plus": 0}


def test_voided_sales_are_excluded_from_velocity(client, make_product):
    product = make_product()
    buy(client, product["id"], 4, "400.00", TODAY - timedelta(days=60))
    sale = sell(client, product["id"], 2, "300.00", TODAY)
    client.post(f"/api/v1/sales/{sale['id']}/void", json={"reason": "returned"})

    row = client.get("/api/v1/reports/by-game").json()[0]
    assert row["sale_count"] == 0
    assert row["units_sold"] == 0
    assert row["avg_days_held"] is None


def test_by_product_groups_individually(client, make_product):
    alpha = make_product("Alpha Box")
    beta = make_product("Beta Box")
    buy(client, alpha["id"], 2, "200.00", TODAY - timedelta(days=30))
    buy(client, beta["id"], 2, "200.00", TODAY - timedelta(days=30))
    sell(client, alpha["id"], 1, "400.00", TODAY)
    sell(client, beta["id"], 1, "150.00", TODAY)

    rows = client.get("/api/v1/reports/by-product").json()
    labels = [row["label"] for row in rows]

    assert labels[0] == "Alpha Box", "best performer first"
    assert {row["label"] for row in rows} == {"Alpha Box", "Beta Box"}


def test_by_product_type_groups_sealed_against_singles(client, db, make_product):
    from sqlalchemy import select

    from src.models.taxonomy import ProductType

    box = make_product("A Box")
    single_type = db.scalar(select(ProductType.id).where(ProductType.slug == "single"))
    single = client.post(
        "/api/v1/products",
        json={
            "name": "A Single",
            "game_id": box["game"]["id"],
            "product_type_id": str(single_type),
        },
    ).json()

    buy(client, box["id"], 1, "100.00", TODAY - timedelta(days=10))
    buy(client, single["id"], 1, "10.00", TODAY - timedelta(days=10))
    sell(client, box["id"], 1, "300.00", TODAY)

    rows = client.get("/api/v1/reports/by-product-type").json()
    by_label = {row["label"]: row for row in rows}

    assert by_label["Booster Box"]["realized_profit"] == "200.00"
    assert by_label["Single"]["units_in_stock"] == 1
    assert by_label["Single"]["sale_count"] == 0


def test_seller_and_marketplace_reports_report_no_inventory(client, make_product):
    """Stock does not belong to a marketplace or a person - it belongs to the store."""
    product = make_product()
    buy(client, product["id"], 4, "400.00", TODAY - timedelta(days=10))
    sell(client, product["id"], 1, "150.00", TODAY, marketplace="eBay")

    for report in ("by-seller", "by-marketplace"):
        row = client.get(f"/api/v1/reports/{report}").json()[0]
        assert row["units_in_stock"] == 0, report
        assert row["inventory_at_cost"] == "0.00", report
        assert row["avg_days_held"] == 10, report


def test_undated_lots_are_left_out_of_ageing(client, make_product):
    """An undated lot cannot be aged; inventing a date would be worse than omitting it."""
    product = make_product()
    client.post(
        "/api/v1/adjustments",
        json={
            "product_id": product["id"],
            "quantity_delta": 5,
            "reason": "opening_inventory",
            "adjustment_date": TODAY.isoformat(),
        },
    )

    row = client.get("/api/v1/reports/by-game").json()[0]
    assert row["units_in_stock"] == 5
    # Adjustment-sourced stock is not a purchase lot, so it does not appear in ageing.
    assert sum(row["units_by_age"].values()) == 0
