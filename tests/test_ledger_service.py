"""Tests for the ledger write paths and the derived aggregates.

These run against real Postgres. The costing engine is already proven in isolation; what
matters here is that events are loaded correctly, allocations are persisted, and the SQL
aggregates agree with the engine.
"""

import uuid
from datetime import date

import pytest
from sqlalchemy import func, select

from src.models.ledger import (
    STATUS_ACTIVE,
    STATUS_VOIDED,
    CostAllocation,
    InventoryAdjustment,
    Purchase,
    Sale,
)
from src.models.product import Product
from src.models.taxonomy import Game, ProductType
from src.services import inventory, ledger


@pytest.fixture
def product(db) -> Product:
    game_id = db.scalar(select(Game.id).where(Game.slug == "pokemon"))
    type_id = db.scalar(select(ProductType.id).where(ProductType.slug == "booster-box"))
    record = Product(name="Vivid Voltage Booster Box", game_id=game_id, product_type_id=type_id)
    db.add(record)
    db.flush()
    return record


def add_purchase(db, product, quantity, gross, on=None, **kwargs) -> Purchase:
    record = Purchase(
        product_id=product.id,
        quantity=quantity,
        gross_amount_cents=gross,
        purchase_date=on,
        **kwargs,
    )
    db.add(record)
    db.flush()
    ledger.recompute_product(db, product.id)
    return record


def add_sale(db, product, quantity, gross, on=None, **kwargs) -> Sale:
    record = Sale(
        product_id=product.id,
        quantity=quantity,
        gross_amount_cents=gross,
        sale_date=on,
        **kwargs,
    )
    db.add(record)
    db.flush()
    ledger.recompute_product(db, product.id)
    return record


def add_adjustment(
    db, product, delta, reason, cost=None, on=date(2026, 6, 1)
) -> InventoryAdjustment:
    """`on` defaults to a real date deliberately.

    An undated event sorts before every dated one, which is right for imported history and
    wrong for something entered today. The API layer defaults dates to today for exactly
    this reason; passing `on=None` here means "this is legacy data".
    """
    record = InventoryAdjustment(
        product_id=product.id,
        quantity_delta=delta,
        reason=reason,
        landed_cost_cents=cost,
        adjustment_date=on,
    )
    db.add(record)
    db.flush()
    ledger.recompute_product(db, product.id)
    return record


# --------------------------------------------------------------------- basic ledger


def test_a_purchase_adds_stock_and_cost(db, product):
    add_purchase(db, product, 2, 30000, date(2026, 1, 10))

    stats = inventory.product_stats(db, [product.id])[product.id]
    assert stats.quantity_on_hand == 2
    assert stats.total_invested_cents == 30000
    assert stats.remaining_cost_cents == 30000
    assert stats.average_unit_cost_cents == 15000


def test_landed_cost_includes_shipping_tax_and_fees(db, product):
    add_purchase(
        db, product, 1, 10000, date(2026, 1, 1), shipping_cents=1500, tax_cents=1300,
        fees_cents=200,
    )
    stats = inventory.product_stats(db, [product.id])[product.id]
    assert stats.total_invested_cents == 13000
    assert stats.average_unit_cost_cents == 13000


def test_a_sale_reduces_stock_and_records_cost_basis(db, product):
    add_purchase(db, product, 2, 30000, date(2026, 1, 10))
    sale = add_sale(db, product, 1, 20000, date(2026, 2, 1))

    db.refresh(sale)
    assert sale.cost_basis_cents == 15000
    assert sale.has_unknown_cost is False
    assert sale.net_proceeds_cents == 20000
    assert sale.realized_profit_cents == 5000

    stats = inventory.product_stats(db, [product.id])[product.id]
    assert stats.quantity_on_hand == 1
    assert stats.remaining_cost_cents == 15000
    assert stats.realized_profit_cents == 5000


def test_fees_reduce_net_proceeds_and_profit(db, product):
    add_purchase(db, product, 1, 10000, date(2026, 1, 1))
    sale = add_sale(
        db, product, 1, 20000, date(2026, 2, 1),
        platform_fees_cents=1000, payment_fees_cents=500, shipping_paid_cents=1500,
    )
    db.refresh(sale)

    assert sale.net_proceeds_cents == 17000
    assert sale.realized_profit_cents == 7000


def test_fifo_across_two_purchase_lots(db, product):
    """2 @ $150 then 3 @ $180; selling 3 costs 2x150 + 1x180 = $480."""
    add_purchase(db, product, 2, 30000, date(2026, 1, 10))
    add_purchase(db, product, 3, 54000, date(2026, 2, 10))
    sale = add_sale(db, product, 3, 60000, date(2026, 3, 1))

    db.refresh(sale)
    assert sale.cost_basis_cents == 48000

    stats = inventory.product_stats(db, [product.id])[product.id]
    assert stats.quantity_on_hand == 2
    assert stats.remaining_cost_cents == 36000


def test_allocations_are_persisted_and_point_at_real_lots(db, product):
    first = add_purchase(db, product, 2, 30000, date(2026, 1, 10))
    second = add_purchase(db, product, 3, 54000, date(2026, 2, 10))
    sale = add_sale(db, product, 3, 60000, date(2026, 3, 1))

    rows = db.scalars(
        select(CostAllocation)
        .where(CostAllocation.sale_id == sale.id)
        .order_by(CostAllocation.cost_cents.desc())
    ).all()

    assert {(r.purchase_id, r.quantity, r.cost_cents) for r in rows} == {
        (first.id, 2, 30000),
        (second.id, 1, 18000),
    }


# ------------------------------------------------------------------- unknown cost


def test_selling_more_than_was_bought_leaves_cost_unknown(db, product):
    add_purchase(db, product, 1, 10000, date(2026, 1, 1))
    sale = add_sale(db, product, 3, 60000, date(2026, 2, 1))

    db.refresh(sale)
    assert sale.has_unknown_cost is True
    assert sale.cost_basis_cents is None
    assert sale.realized_profit_cents is None, "never a partial number"


def test_stock_counted_in_without_a_cost_makes_sales_unknown(db, product):
    add_adjustment(db, product, 2, "opening_inventory", cost=None, on=date(2026, 1, 1))
    sale = add_sale(db, product, 1, 20000, date(2026, 2, 1))

    db.refresh(sale)
    assert sale.has_unknown_cost is True

    stats = inventory.product_stats(db, [product.id])[product.id]
    assert stats.quantity_on_hand == 1, "quantity is known even when cost is not"
    assert stats.remaining_cost_cents == 0
    assert stats.sales_missing_cost == 1


def test_unknown_cost_sales_are_excluded_from_profit(db, product):
    add_purchase(db, product, 1, 10000, date(2026, 1, 1))
    add_sale(db, product, 1, 20000, date(2026, 2, 1))  # known: profit 10000
    add_sale(db, product, 1, 90000, date(2026, 3, 1))  # unknown: excluded

    stats = inventory.product_stats(db, [product.id])[product.id]
    assert stats.sale_count == 2
    assert stats.sales_missing_cost == 1
    assert stats.realized_profit_cents == 10000, "the unknown sale must not inflate profit"
    assert stats.gross_revenue_cents == 110000, "but its revenue is still real"


# ------------------------------------------------------------------- adjustments


def test_a_negative_adjustment_removes_stock_and_writes_off_cost(db, product):
    add_purchase(db, product, 3, 30000, date(2026, 1, 1))
    add_adjustment(db, product, -1, "damaged")

    stats = inventory.product_stats(db, [product.id])[product.id]
    assert stats.quantity_on_hand == 2
    assert stats.cost_written_off_cents == 10000
    assert stats.remaining_cost_cents == 20000
    assert stats.realized_profit_cents == 0, "a write-off is not a sale and must not move profit"


def test_a_positive_adjustment_with_a_cost_counts_as_invested(db, product):
    add_adjustment(db, product, 2, "opening_inventory", cost=30000)

    stats = inventory.product_stats(db, [product.id])[product.id]
    assert stats.quantity_on_hand == 2
    assert stats.total_invested_cents == 30000
    assert stats.remaining_cost_cents == 30000


# ------------------------------------------------------------------------- voids


def test_voiding_a_purchase_recomputes_the_sales_it_funded(db, product):
    cheap = add_purchase(db, product, 2, 30000, date(2026, 1, 10))
    add_purchase(db, product, 3, 54000, date(2026, 2, 10))
    sale = add_sale(db, product, 3, 60000, date(2026, 3, 1))

    db.refresh(sale)
    assert sale.cost_basis_cents == 48000

    ledger.void(db, cheap, entity_type="purchase", member_id=None, reason="entered twice")
    db.refresh(sale)

    assert sale.cost_basis_cents == 54000, "all three units now come from the dearer lot"
    assert cheap.status == STATUS_VOIDED

    stats = inventory.product_stats(db, [product.id])[product.id]
    assert stats.quantity_on_hand == 0


def test_voiding_the_only_purchase_makes_the_sale_unknown(db, product):
    purchase = add_purchase(db, product, 2, 30000, date(2026, 1, 10))
    sale = add_sale(db, product, 1, 20000, date(2026, 3, 1))

    ledger.void(db, purchase, entity_type="purchase", member_id=None, reason="wrong product")
    db.refresh(sale)

    assert sale.has_unknown_cost is True
    assert sale.cost_basis_cents is None


def test_voiding_a_sale_returns_the_stock(db, product):
    add_purchase(db, product, 2, 30000, date(2026, 1, 10))
    sale = add_sale(db, product, 1, 20000, date(2026, 3, 1))

    assert inventory.quantity_on_hand(db, product.id) == 1
    ledger.void(db, sale, entity_type="sale", member_id=None, reason="buyer backed out")

    assert inventory.quantity_on_hand(db, product.id) == 2
    stats = inventory.product_stats(db, [product.id])[product.id]
    assert stats.remaining_cost_cents == 30000
    assert stats.sale_count == 0


def test_voided_rows_leave_no_allocations_behind(db, product):
    add_purchase(db, product, 2, 30000, date(2026, 1, 10))
    sale = add_sale(db, product, 1, 20000, date(2026, 3, 1))

    ledger.void(db, sale, entity_type="sale", member_id=None, reason="mistake")

    assert db.scalar(
        select(func.count()).select_from(CostAllocation).where(CostAllocation.sale_id == sale.id)
    ) == 0


def test_voiding_writes_an_audit_entry(db, product):
    purchase = add_purchase(db, product, 1, 10000, date(2026, 1, 1))
    ledger.void(db, purchase, entity_type="purchase", member_id=None, reason="duplicate")

    from src.models.audit import AuditLog

    entry = db.scalar(select(AuditLog).where(AuditLog.entity_id == purchase.id))
    assert entry.action == "void"
    assert entry.reason == "duplicate"
    assert entry.before == {"status": STATUS_ACTIVE}
    assert entry.after == {"status": STATUS_VOIDED}


# --------------------------------------------------------------- back-dating


def test_back_dating_a_purchase_reallocates_an_existing_sale(db, product):
    add_purchase(db, product, 1, 20000, date(2026, 2, 1))
    sale = add_sale(db, product, 1, 30000, date(2026, 3, 1))
    db.refresh(sale)
    assert sale.cost_basis_cents == 20000

    # A cheaper lot the group forgot to enter, dated earlier.
    add_purchase(db, product, 1, 5000, date(2026, 1, 1))
    db.refresh(sale)

    assert sale.cost_basis_cents == 5000, "the older lot must fund the sale"


# ------------------------------------------------------- reconciliation & helpers


def test_recompute_is_idempotent(db, product):
    add_purchase(db, product, 3, 10000, date(2026, 1, 1))
    sale = add_sale(db, product, 2, 40000, date(2026, 2, 1))

    def allocation_fingerprint():
        rows = db.scalars(select(CostAllocation).order_by(CostAllocation.quantity)).all()
        return sorted((r.quantity, r.cost_cents, r.sale_id) for r in rows)

    first = allocation_fingerprint()
    ledger.recompute_product(db, product.id)
    ledger.recompute_product(db, product.id)

    assert allocation_fingerprint() == first
    db.refresh(sale)
    assert sale.cost_basis_cents == 6667


def test_invested_reconciles_with_cost_of_sales_write_offs_and_remaining(db, product):
    add_purchase(db, product, 4, 64000, date(2026, 3, 14))
    add_sale(db, product, 1, 32000, date(2026, 5, 2))
    add_adjustment(db, product, -1, "opened")

    stats = inventory.product_stats(db, [product.id])[product.id]
    assert (
        stats.cost_of_sales_cents + stats.cost_written_off_cents + stats.remaining_cost_cents
        == stats.total_invested_cents
    ), "not one cent may appear or disappear"


def test_product_stats_covers_many_products_at_once(db, product):
    other = Product(
        name="Brilliant Stars Booster Box",
        game_id=product.game_id,
        product_type_id=product.product_type_id,
    )
    db.add(other)
    db.flush()

    add_purchase(db, product, 1, 10000, date(2026, 1, 1))
    add_purchase(db, other, 2, 50000, date(2026, 1, 1))

    stats = inventory.product_stats(db)
    assert stats[product.id].quantity_on_hand == 1
    assert stats[other.id].quantity_on_hand == 2


def test_a_product_with_no_transactions_has_no_stats_row(db, product):
    assert inventory.product_stats(db, [product.id]) == {}
    assert inventory.quantity_on_hand(db, product.id) == 0
    assert inventory.has_any_transactions(db, product.id) is False


def test_has_any_transactions_sees_voided_history_too(db, product):
    purchase = add_purchase(db, product, 1, 10000, date(2026, 1, 1))
    ledger.void(db, purchase, entity_type="purchase", member_id=None, reason="oops")

    assert inventory.has_any_transactions(db, product.id) is True, (
        "voided history still counts - the product must not be deletable"
    )


def test_average_unit_cost_is_none_when_nothing_is_in_stock(db, product):
    add_purchase(db, product, 1, 10000, date(2026, 1, 1))
    add_sale(db, product, 1, 20000, date(2026, 2, 1))

    stats = inventory.product_stats(db, [product.id])[product.id]
    assert stats.quantity_on_hand == 0
    assert stats.average_unit_cost_cents is None
    assert stats.roi == pytest.approx(1.0), "$100 cost, $200 sale = 100% ROI"


def test_roi_is_none_without_a_known_cost_of_sales(db, product):
    add_purchase(db, product, 1, 10000, date(2026, 1, 1))
    stats = inventory.product_stats(db, [product.id])[product.id]
    assert stats.roi is None


def test_load_events_ignores_voided_rows(db, product):
    purchase = add_purchase(db, product, 1, 10000, date(2026, 1, 1))
    events, sources = ledger.load_events(db, product.id)
    assert len(events) == 1

    ledger.void(db, purchase, entity_type="purchase", member_id=None, reason="x")
    events, sources = ledger.load_events(db, product.id)
    assert events == [] and sources == {}


def test_snapshot_serialises_dates(db, product):
    purchase = add_purchase(db, product, 1, 10000, date(2026, 1, 1))
    snap = ledger.snapshot(purchase, ["quantity", "purchase_date", "gross_amount_cents"])
    assert snap == {"quantity": 1, "purchase_date": "2026-01-01", "gross_amount_cents": 10000}


def test_quantity_is_supply_minus_consumption(db, product):
    add_purchase(db, product, 5, 10000, date(2026, 1, 1))
    add_sale(db, product, 2, 40000, date(2026, 2, 1))
    add_adjustment(db, product, -1, "damaged")

    assert inventory.quantity_on_hand(db, product.id) == 2


def test_overselling_shows_as_negative_stock_rather_than_zero(db, product):
    """The brief treats negative inventory as a data error to surface, not hide."""
    add_purchase(db, product, 1, 10000, date(2026, 1, 1))
    add_sale(db, product, 3, 60000, date(2026, 2, 1))

    assert inventory.quantity_on_hand(db, product.id) == -2


def test_allocation_rows_are_scoped_to_the_product(db, product):
    add_purchase(db, product, 1, 10000, date(2026, 1, 1))
    add_sale(db, product, 1, 20000, date(2026, 2, 1))

    rows = db.scalars(select(CostAllocation)).all()
    assert rows and all(r.product_id == product.id for r in rows)


def test_recompute_handles_a_product_with_nothing_at_all(db, product):
    ledger.recompute_product(db, product.id)
    assert db.scalar(select(func.count()).select_from(CostAllocation)) == 0


def test_unknown_product_id_yields_empty_stats(db):
    assert inventory.product_stats(db, [uuid.uuid4()]) == {}


def test_active_status_is_the_default(db, product):
    purchase = add_purchase(db, product, 1, 10000, date(2026, 1, 1))
    assert purchase.status == STATUS_ACTIVE
