"""Tests for the money boundary.

Every cent that enters or leaves the system passes through here, so this is the one place
where a rounding bug would be invisible everywhere else.
"""

import pytest
from pydantic import BaseModel, ValidationError

from src.schemas.money import (
    MAX_AMOUNT_CENTS,
    MoneyIn,
    MoneyOut,
    cents_to_decimal_string,
    parse_money_to_cents,
)


class AmountIn(BaseModel):
    amount: MoneyIn


class AmountOut(BaseModel):
    amount: MoneyOut


@pytest.mark.parametrize(
    ("raw", "cents"),
    [
        ("0", 0),
        ("0.00", 0),
        ("0.01", 1),
        ("19.99", 1999),
        ("150", 15000),
        ("150.00", 15000),
        ("  640.50  ", 64050),
        ("1234567.89", 123456789),
        (150, 15000),
        (19.99, 1999),
    ],
)
def test_amounts_parse_to_exact_cents(raw: object, cents: int):
    assert parse_money_to_cents(raw) == cents


def test_float_input_avoids_binary_representation_error():
    """19.99 as a float is 19.989999... in binary; it must still land on 1999.

    This works because floats are routed through str() before Decimal, which gives the
    shortest repr that round-trips rather than the full binary expansion.
    """
    assert parse_money_to_cents(19.99) == 1999
    assert parse_money_to_cents(0.07) == 7
    assert parse_money_to_cents(1.1) == 110


@pytest.mark.parametrize(
    "raw",
    ["-1", "-0.01", "abc", "", "   ", "1.234", "0.001", "nan", "inf", None, True],
)
def test_invalid_amounts_are_rejected(raw: object):
    with pytest.raises(ValueError):
        parse_money_to_cents(raw)


def test_implausibly_large_amounts_are_rejected():
    with pytest.raises(ValueError, match="implausibly large"):
        parse_money_to_cents(MAX_AMOUNT_CENTS // 100 + 1)


def test_the_maximum_amount_itself_is_accepted():
    assert parse_money_to_cents(MAX_AMOUNT_CENTS // 100) == MAX_AMOUNT_CENTS


@pytest.mark.parametrize(
    ("cents", "rendered"),
    [(0, "0.00"), (1, "0.01"), (1999, "19.99"), (15000, "150.00"), (123456789, "1234567.89")],
)
def test_cents_render_with_two_decimal_places(cents: int, rendered: str):
    assert cents_to_decimal_string(cents) == rendered


@pytest.mark.parametrize("raw", ["0.00", "0.01", "19.99", "150.00", "1234567.89"])
def test_round_trip_is_lossless(raw: str):
    assert cents_to_decimal_string(parse_money_to_cents(raw)) == raw


def test_pydantic_parses_request_money_to_cents():
    assert AmountIn(amount="150.00").amount == 15000


def test_pydantic_rejects_bad_request_money():
    with pytest.raises(ValidationError):
        AmountIn(amount="-5.00")


def test_pydantic_serialises_response_money_as_a_decimal_string():
    assert AmountOut(amount=15000).model_dump()["amount"] == "150.00"
    assert AmountOut(amount=1).model_dump()["amount"] == "0.01"
