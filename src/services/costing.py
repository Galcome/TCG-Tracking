"""FIFO cost-basis allocation.

This module is pure: it takes a list of events for one product and returns which purchase
lots funded which sales. No database, no ORM, no clock. Everything that makes the ledger
trustworthy is decided here, so it is kept free of I/O to stay exhaustively testable.

Why FIFO rather than weighted average:

* The brief requires that separate purchases retain separate cost information. An average
  destroys lot identity by definition.
* Some sales have genuinely unknown cost (legacy data, or selling more than was recorded).
  Averaging across an unknown either poisons every figure for that product or invents a
  number. FIFO confines the unknown to the specific sales that lack a lot.
* "The two cheap boxes went out first" is a sentence a human can check. An average is not.

Why the whole history is rebuilt on every write rather than appending incrementally: people
back-date purchases, fix typos, and void things. Any of those invalidates allocations made
earlier. A product has tens of events, so recomputing is microseconds and is correct by
construction; an incremental allocator would be a permanent source of subtle bugs.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime

# Sorts before every real date so undated events lead. Undated data is historical by
# definition - it comes from records that predate this system.
_EPOCH = date.min


@dataclass(frozen=True)
class Event:
    """A single thing that happened to one product's stock.

    `landed_cost_cents` is only meaningful for supply. `None` on supply means the cost is
    genuinely unknown (imported history, or an opening-inventory count) and must never be
    treated as zero.
    """

    id: uuid.UUID
    quantity: int
    is_supply: bool
    occurred_on: date | None
    created_at: datetime
    landed_cost_cents: int | None = None

    def __post_init__(self) -> None:
        if self.quantity <= 0:
            raise ValueError("event quantity must be positive")
        if not self.is_supply and self.landed_cost_cents is not None:
            raise ValueError("consumers do not carry a landed cost")


@dataclass(frozen=True)
class Allocation:
    """`quantity` units of `supply_id` funded `consumer_id`.

    `cost_cents is None` means this slice has no known cost, which makes the whole consumer
    unknown-cost. It is never 0 - that would be a claim the units were free.
    """

    consumer_id: uuid.UUID
    supply_id: uuid.UUID | None
    quantity: int
    cost_cents: int | None


@dataclass
class LotState:
    """What remains of one supply event after allocation."""

    supply_id: uuid.UUID
    quantity_remaining: int
    cost_remaining_cents: int | None


@dataclass
class ConsumerResult:
    consumer_id: uuid.UUID
    quantity: int
    cost_basis_cents: int | None  #: None when any unit had unknown cost
    has_unknown_cost: bool


@dataclass
class CostingResult:
    allocations: list[Allocation] = field(default_factory=list)
    consumers: dict[uuid.UUID, ConsumerResult] = field(default_factory=dict)
    lots: dict[uuid.UUID, LotState] = field(default_factory=dict)

    @property
    def quantity_on_hand(self) -> int:
        """Units still in lots. Clamped at zero by construction - a shortfall consumes
        nothing, so this cannot go negative. For the signed figure that surfaces oversells
        as a data error, use `services.inventory.quantity_on_hand`.
        """
        return sum(lot.quantity_remaining for lot in self.lots.values())

    @property
    def remaining_cost_cents(self) -> int:
        """Cost basis still sitting in stock. Unknown-cost lots contribute nothing."""
        return sum(lot.cost_remaining_cents or 0 for lot in self.lots.values())


def split_cost(total_cents: int, units: int) -> list[int]:
    """Divide a lot's landed cost across its units without losing a cent.

    Largest-remainder: the leftover pennies go to the earliest units, so $100.00 over 3
    becomes 3334 + 3333 + 3333. Guarantees `sum(result) == total_cents` exactly, which is
    what makes "allocated + remaining == landed cost" hold for every product.
    """
    if units <= 0:
        raise ValueError("cannot split a cost across zero units")
    base, leftover = divmod(total_cents, units)
    return [base + 1 if index < leftover else base for index in range(units)]


def _sort_key(event: Event) -> tuple:
    # Supply before consumers on the same date, so a purchase entered the same day as its
    # sale funds that sale. created_at then id make the order total, so the result never
    # depends on the order rows happen to come back from the database.
    return (
        event.occurred_on or _EPOCH,
        0 if event.is_supply else 1,
        event.created_at,
        str(event.id),
    )


def allocate(events: list[Event]) -> CostingResult:
    """Run FIFO allocation over one product's complete history.

    Callers pass *every* non-voided event for the product; this rebuilds from scratch.
    """
    result = CostingResult()
    open_lots: list[LotState] = []
    # Per-unit costs for the lot currently being drawn from, so a lot bought at an odd
    # price gives up its pennies in the same order it would have had they been sold at once.
    unit_costs: dict[uuid.UUID, list[int]] = {}

    for event in sorted(events, key=_sort_key):
        if event.is_supply:
            lot = LotState(
                supply_id=event.id,
                quantity_remaining=event.quantity,
                cost_remaining_cents=event.landed_cost_cents,
            )
            open_lots.append(lot)
            result.lots[event.id] = lot
            if event.landed_cost_cents is not None:
                unit_costs[event.id] = split_cost(event.landed_cost_cents, event.quantity)
            continue

        _consume(event, open_lots, unit_costs, result)

    return result


def _consume(
    event: Event,
    open_lots: list[LotState],
    unit_costs: dict[uuid.UUID, list[int]],
    result: CostingResult,
) -> None:
    outstanding = event.quantity
    cost_basis = 0
    unknown = False

    while outstanding > 0 and open_lots:
        lot = open_lots[0]
        if lot.quantity_remaining == 0:
            open_lots.pop(0)
            continue

        taken = min(outstanding, lot.quantity_remaining)
        slice_cost = _take_from_lot(lot, taken, unit_costs)

        result.allocations.append(
            Allocation(
                consumer_id=event.id,
                supply_id=lot.supply_id,
                quantity=taken,
                cost_cents=slice_cost,
            )
        )
        if slice_cost is None:
            unknown = True
        else:
            cost_basis += slice_cost

        outstanding -= taken

    if outstanding > 0:
        # More was sold than was ever bought. Record the shortfall explicitly rather than
        # silently pretending those units were free.
        unknown = True
        result.allocations.append(
            Allocation(
                consumer_id=event.id,
                supply_id=None,
                quantity=outstanding,
                cost_cents=None,
            )
        )

    result.consumers[event.id] = ConsumerResult(
        consumer_id=event.id,
        quantity=event.quantity,
        cost_basis_cents=None if unknown else cost_basis,
        has_unknown_cost=unknown,
    )


def _take_from_lot(
    lot: LotState,
    units: int,
    unit_costs: dict[uuid.UUID, list[int]],
) -> int | None:
    """Remove `units` from `lot`, returning their cost, or None if the lot's cost is unknown."""
    lot.quantity_remaining -= units

    per_unit = unit_costs.get(lot.supply_id)
    if per_unit is None:
        return None

    slice_cost = sum(per_unit[:units])
    del per_unit[:units]
    lot.cost_remaining_cents = (lot.cost_remaining_cents or 0) - slice_cost
    return slice_cost
