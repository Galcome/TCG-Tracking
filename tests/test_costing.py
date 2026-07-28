"""Tests for the FIFO costing engine.

The engine is pure, so this suite needs no database and runs in milliseconds. It is the
place where the project's financial correctness is actually established.
"""

import uuid
from datetime import date, datetime, timedelta

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from src.services.costing import Allocation, Event, allocate, split_cost

BASE_TIME = datetime(2026, 1, 1, 12, 0, 0)


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


# --------------------------------------------------------------------------- splitting


@pytest.mark.parametrize(
    ("total", "units", "expected"),
    [
        (30000, 2, [15000, 15000]),
        (10000, 3, [3334, 3333, 3333]),
        (1, 3, [1, 0, 0]),
        (0, 2, [0, 0]),
        (100, 1, [100]),
        (7, 2, [4, 3]),
    ],
)
def test_split_cost_distributes_every_cent(total: int, units: int, expected: list[int]):
    assert split_cost(total, units) == expected
    assert sum(split_cost(total, units)) == total


def test_split_cost_rejects_zero_units():
    with pytest.raises(ValueError):
        split_cost(100, 0)


@given(total=st.integers(min_value=0, max_value=10**9), units=st.integers(1, 500))
def test_split_cost_always_sums_back_to_the_total(total: int, units: int):
    parts = split_cost(total, units)
    assert len(parts) == units
    assert sum(parts) == total
    assert max(parts) - min(parts) <= 1, "cents must be spread evenly, not dumped on one unit"


# --------------------------------------------------------------------------- event guards


def test_events_must_have_positive_quantity():
    with pytest.raises(ValueError, match="positive"):
        supply(0, 100)


def test_consumers_cannot_carry_a_cost():
    with pytest.raises(ValueError, match="landed cost"):
        Event(
            id=uuid.uuid4(),
            quantity=1,
            is_supply=False,
            occurred_on=None,
            created_at=BASE_TIME,
            landed_cost_cents=100,
        )


# --------------------------------------------------------------------------- worked example


def test_the_briefs_vivid_voltage_example():
    """Straight from the product brief. If this disagrees, the code is wrong."""
    purchase = supply(4, 64000, date(2026, 3, 14), seq=0)
    first_sale = consume(1, date(2026, 5, 2), seq=1)
    second_sale = consume(1, date(2026, 7, 8), seq=2)

    result = allocate([purchase, first_sale, second_sale])

    assert result.quantity_on_hand == 2
    assert result.remaining_cost_cents == 32000
    assert result.consumers[first_sale.id].cost_basis_cents == 16000
    assert result.consumers[second_sale.id].cost_basis_cents == 16000
    total_cost_of_sales = sum(c.cost_basis_cents for c in result.consumers.values())
    assert total_cost_of_sales == 32000


def test_fifo_draws_from_the_oldest_lot_first():
    """2 @ $150 then 3 @ $180; selling 3 must cost 2x150 + 1x180 = $480."""
    cheap = supply(2, 30000, date(2026, 1, 10), seq=0)
    dear = supply(3, 54000, date(2026, 2, 10), seq=1)
    sale = consume(3, date(2026, 3, 1), seq=2)

    result = allocate([cheap, dear, sale])

    assert result.consumers[sale.id].cost_basis_cents == 48000
    assert result.quantity_on_hand == 2
    assert result.remaining_cost_cents == 36000
    assert result.lots[cheap.id].quantity_remaining == 0
    assert result.lots[dear.id].quantity_remaining == 2


def test_a_sale_is_split_across_two_lots_in_order():
    cheap = supply(2, 30000, date(2026, 1, 10), seq=0)
    dear = supply(3, 54000, date(2026, 2, 10), seq=1)
    sale = consume(3, date(2026, 3, 1), seq=2)

    result = allocate([cheap, dear, sale])
    slices = [a for a in result.allocations if a.consumer_id == sale.id]

    assert slices == [
        Allocation(sale.id, cheap.id, 2, 30000),
        Allocation(sale.id, dear.id, 1, 18000),
    ]


# --------------------------------------------------------------------- unknown cost


def test_selling_more_than_was_bought_marks_the_sale_unknown():
    purchase = supply(1, 10000, date(2026, 1, 1), seq=0)
    sale = consume(3, date(2026, 2, 1), seq=1)

    result = allocate([purchase, sale])
    outcome = result.consumers[sale.id]

    assert outcome.has_unknown_cost is True
    assert outcome.cost_basis_cents is None, "must be unknown, never a partial number"
    shortfall = [a for a in result.allocations if a.supply_id is None]
    assert shortfall == [Allocation(sale.id, None, 2, None)]


def test_a_lot_with_unknown_cost_never_contributes_zero():
    """Legacy stock: quantity known, cost not. Profit must be unknown, not 100%."""
    legacy = supply(2, None, None, seq=0)
    sale = consume(1, date(2026, 5, 1), seq=1)

    result = allocate([legacy, sale])

    assert result.consumers[sale.id].cost_basis_cents is None
    assert result.consumers[sale.id].has_unknown_cost is True
    assert result.remaining_cost_cents == 0
    assert result.quantity_on_hand == 1, "quantity is still known even when cost is not"


def test_a_sale_spanning_known_and_unknown_lots_is_unknown_overall():
    legacy = supply(1, None, None, seq=0)
    known = supply(1, 10000, date(2026, 1, 1), seq=1)
    sale = consume(2, date(2026, 2, 1), seq=2)

    result = allocate([legacy, known, sale])

    assert result.consumers[sale.id].has_unknown_cost is True
    assert result.consumers[sale.id].cost_basis_cents is None


def test_nothing_in_stock_at_all():
    sale = consume(2, date(2026, 2, 1), seq=0)
    result = allocate([sale])

    assert result.consumers[sale.id].has_unknown_cost is True
    assert result.quantity_on_hand == 0


# ------------------------------------------------------------------------- ordering


def test_undated_events_sort_before_dated_ones():
    """Undated data is historical, so it must fund the earliest sales."""
    undated = supply(1, 5000, None, seq=5)
    dated = supply(1, 20000, date(2026, 1, 1), seq=0)
    sale = consume(1, date(2026, 6, 1), seq=9)

    result = allocate([dated, sale, undated])

    assert result.consumers[sale.id].cost_basis_cents == 5000


def test_a_purchase_entered_the_same_day_funds_that_days_sale():
    same_day = date(2026, 4, 1)
    purchase = supply(1, 9000, same_day, seq=9)
    sale = consume(1, same_day, seq=0)

    result = allocate([sale, purchase])

    assert result.consumers[sale.id].cost_basis_cents == 9000, "supply sorts before consumers"


def test_allocation_is_independent_of_input_order():
    events = [
        supply(2, 30000, date(2026, 1, 10), seq=0),
        supply(3, 54000, date(2026, 2, 10), seq=1),
        consume(3, date(2026, 3, 1), seq=2),
        consume(1, date(2026, 4, 1), seq=3),
    ]
    baseline = allocate(events)

    for rotation in range(1, len(events)):
        shuffled = events[rotation:] + events[:rotation]
        assert allocate(shuffled).allocations == baseline.allocations


def test_rebuilding_twice_gives_an_identical_result():
    events = [
        supply(5, 12345, date(2026, 1, 1), seq=0),
        consume(2, date(2026, 2, 1), seq=1),
    ]
    assert allocate(events).allocations == allocate(events).allocations


# --------------------------------------------------------- mutation: voids and edits


def test_voiding_a_purchase_shifts_cost_to_the_next_lot():
    """Voiding is modelled by rebuilding without that event - the caller drops it."""
    cheap = supply(2, 30000, date(2026, 1, 10), seq=0)
    dear = supply(3, 54000, date(2026, 2, 10), seq=1)
    sale = consume(3, date(2026, 3, 1), seq=2)

    before = allocate([cheap, dear, sale])
    after = allocate([dear, sale])

    # Losing the cheap lot makes the sale *more* expensive: all 3 now come from the $180 lot.
    assert before.consumers[sale.id].cost_basis_cents == 48000
    assert after.consumers[sale.id].cost_basis_cents == 54000
    assert after.quantity_on_hand == 0
    assert before.quantity_on_hand == 2


def test_voiding_the_only_purchase_makes_the_sale_unknown():
    purchase = supply(2, 30000, date(2026, 1, 10), seq=0)
    sale = consume(1, date(2026, 3, 1), seq=1)

    assert allocate([purchase, sale]).consumers[sale.id].cost_basis_cents == 15000
    assert allocate([sale]).consumers[sale.id].has_unknown_cost is True


def test_back_dating_a_purchase_after_the_sale_exists_reallocates():
    late_entry = supply(1, 5000, date(2026, 1, 1), seq=99)
    original = supply(1, 20000, date(2026, 2, 1), seq=0)
    sale = consume(1, date(2026, 3, 1), seq=1)

    without = allocate([original, sale])
    with_backdated = allocate([original, sale, late_entry])

    assert without.consumers[sale.id].cost_basis_cents == 20000
    assert with_backdated.consumers[sale.id].cost_basis_cents == 5000, "older lot wins"


# --------------------------------------------------------------------- invariants


@st.composite
def event_histories(draw):
    """Random but well-formed histories: supply and consumers in arbitrary order."""
    count = draw(st.integers(min_value=1, max_value=12))
    events = []
    for seq in range(count):
        is_supply = draw(st.booleans())
        qty = draw(st.integers(min_value=1, max_value=20))
        day = draw(st.one_of(st.none(), st.integers(min_value=1, max_value=28)))
        on = date(2026, 6, day) if day else None
        if is_supply:
            cost = draw(st.one_of(st.none(), st.integers(min_value=0, max_value=10**7)))
            events.append(supply(qty, cost, on, seq))
        else:
            events.append(consume(qty, on, seq))
    return events


@settings(max_examples=250, deadline=None)
@given(events=event_histories())
def test_every_consumer_is_fully_allocated(events):
    result = allocate(events)
    for consumer_id, outcome in result.consumers.items():
        allocated = sum(a.quantity for a in result.allocations if a.consumer_id == consumer_id)
        assert allocated == outcome.quantity


@settings(max_examples=250, deadline=None)
@given(events=event_histories())
def test_stock_equals_supply_minus_consumption(events):
    result = allocate(events)
    supplied = sum(e.quantity for e in events if e.is_supply)
    consumed = sum(e.quantity for e in events if not e.is_supply)
    # Consumption beyond available stock is recorded as a shortfall, not negative stock.
    shortfall = sum(a.quantity for a in result.allocations if a.supply_id is None)
    assert result.quantity_on_hand == supplied - (consumed - shortfall)


@settings(max_examples=250, deadline=None)
@given(events=event_histories())
def test_allocated_cost_plus_remaining_equals_landed_cost(events):
    """The reconciliation guarantee: not one cent appears or disappears."""
    result = allocate(events)
    known_lots = {e.id for e in events if e.is_supply and e.landed_cost_cents is not None}

    landed = sum(e.landed_cost_cents for e in events if e.id in known_lots)
    allocated = sum(
        a.cost_cents or 0 for a in result.allocations if a.supply_id in known_lots
    )
    remaining = sum(
        result.lots[lot_id].cost_remaining_cents or 0 for lot_id in known_lots
    )
    assert allocated + remaining == landed


@settings(max_examples=250, deadline=None)
@given(events=event_histories())
def test_unknown_cost_is_never_reported_as_a_number(events):
    result = allocate(events)
    for outcome in result.consumers.values():
        if outcome.has_unknown_cost:
            assert outcome.cost_basis_cents is None
        else:
            assert outcome.cost_basis_cents is not None


@settings(max_examples=100, deadline=None)
@given(events=event_histories())
def test_rebuilding_is_idempotent_for_any_history(events):
    assert allocate(events).allocations == allocate(events).allocations
