"""Pure rip-cost allocation policy tests.

The allocator receives the source cost only after the ledger has consumed the locked
source FIFO. These tests intentionally do not use a database so the money policy can also
be reused by a preview without introducing a second calculation.
"""

import pytest

from src.services.transformations import RipCostSpec, allocate_rip_costs


def test_weighted_shares_use_per_unit_value_times_quantity() -> None:
    shares, bulk = allocate_rip_costs(
        12_000,
        [
            RipCostSpec(quantity=2, value=1_000),
            RipCostSpec(quantity=1, value=2_000),
        ],
    )

    assert shares == [6_000, 6_000]
    assert bulk == 0


def test_largest_remainder_preserves_every_cent() -> None:
    shares, bulk = allocate_rip_costs(
        10_000,
        [
            RipCostSpec(quantity=1, value=1),
            RipCostSpec(quantity=1, value=2),
            RipCostSpec(quantity=1, value=3),
        ],
    )

    assert shares == [1_667, 3_333, 5_000]
    assert sum(shares) + bulk == 10_000


def test_zero_estimates_fall_back_to_equal_rows() -> None:
    shares, bulk = allocate_rip_costs(
        12_000,
        [
            RipCostSpec(quantity=2, value=0),
            RipCostSpec(quantity=1, value=0),
        ],
    )

    assert shares == [6_000, 6_000]
    assert bulk == 0


def test_explicit_costs_are_kept_and_remainder_is_bulk() -> None:
    shares, bulk = allocate_rip_costs(
        15_000,
        [RipCostSpec(quantity=1, value=500, cost=10_000)],
    )

    assert shares == [10_000]
    assert bulk == 5_000


def test_partial_explicit_costs_share_only_the_remaining_source() -> None:
    shares, bulk = allocate_rip_costs(
        15_000,
        [
            RipCostSpec(quantity=1, value=500, cost=10_000),
            RipCostSpec(quantity=1, value=50),
            RipCostSpec(quantity=1, value=10),
        ],
    )

    assert shares == [10_000, 4_167, 833]
    assert bulk == 0


def test_unknown_source_never_becomes_zero_cost() -> None:
    shares, bulk = allocate_rip_costs(
        None,
        [
            RipCostSpec(quantity=1, value=500),
            RipCostSpec(quantity=1, value=50, cost=100),
        ],
    )

    assert shares == [None, None]
    assert bulk is None


def test_no_hits_write_off_known_source_or_preserve_unknown() -> None:
    assert allocate_rip_costs(15_000, []) == ([], 15_000)
    assert allocate_rip_costs(None, []) == ([], None)


def test_explicit_costs_cannot_exceed_actual_source() -> None:
    with pytest.raises(ValueError, match="exceed"):
        allocate_rip_costs(10_000, [RipCostSpec(quantity=1, value=1, cost=10_001)])


@pytest.mark.parametrize(
    ("source_cost", "hit"),
    [
        (-1, RipCostSpec(quantity=1, value=1)),
        (1, RipCostSpec(quantity=0, value=1)),
        (1, RipCostSpec(quantity=1, value=-1)),
        (1, RipCostSpec(quantity=1, value=1, cost=-1)),
    ],
)
def test_negative_or_invalid_policy_inputs_are_rejected(
    source_cost: int, hit: RipCostSpec
) -> None:
    with pytest.raises(ValueError):
        allocate_rip_costs(source_cost, [hit])
