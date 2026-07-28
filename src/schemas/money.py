"""Money crosses the API as a decimal string; the database stores integer cents.

Why strings rather than numbers: `19.99 * 100` is `1998.9999999999998` in JavaScript, so
any client-side dollars-to-cents conversion is a place for a cent to go missing. Keeping the
arithmetic here, in `Decimal`, means the client only ever formats for display.

Why integer cents rather than NUMERIC: the costing engine splits a lot's landed cost across
its units, and integer arithmetic with a largest-remainder split is the only way to guarantee
the parts sum back to the whole exactly.
"""

from decimal import Decimal, InvalidOperation
from typing import Annotated

from pydantic import BeforeValidator, PlainSerializer

CENTS_PER_UNIT = 100
MAX_DECIMAL_PLACES = 2

# Well beyond any plausible single transaction, and far short of BIGINT overflow. Exists so a
# fat-fingered "10000000000" is rejected as input rather than stored as a real amount.
MAX_AMOUNT_CENTS = 100_000_000_000  # $1,000,000,000.00


def cents_to_decimal_string(cents: int) -> str:
    """1999 -> '19.99'. Always two decimal places."""
    return f"{Decimal(cents) / CENTS_PER_UNIT:.2f}"


def parse_money_to_cents(value: object) -> int:
    """Accept a decimal string, int, float or Decimal; return exact integer cents.

    Floats are accepted because JSON numbers arrive as floats, but they are routed through
    `str()` first so `19.99` becomes `Decimal('19.99')` rather than the binary approximation.
    """
    if isinstance(value, bool):
        raise ValueError("amount must be a number, not a boolean")
    if isinstance(value, int):
        amount = Decimal(value)
    else:
        try:
            amount = Decimal(str(value).strip())
        except (InvalidOperation, ArithmeticError, AttributeError, TypeError):
            raise ValueError(f"'{value}' is not a valid amount")

    if not amount.is_finite():
        raise ValueError("amount must be a finite number")
    if amount < 0:
        raise ValueError("amount cannot be negative")
    if -amount.as_tuple().exponent > MAX_DECIMAL_PLACES:
        raise ValueError("amount cannot have more than 2 decimal places")

    cents = int(amount.scaleb(2))
    if cents > MAX_AMOUNT_CENTS:
        raise ValueError("amount is implausibly large")
    return cents


def optional_cents_to_decimal_string(cents: int | None) -> str | None:
    """None stays None. An unknown cost must never render as '0.00'."""
    return None if cents is None else cents_to_decimal_string(cents)


#: Request-side money: a decimal string in, integer cents on the model.
MoneyIn = Annotated[int, BeforeValidator(parse_money_to_cents)]

#: Response-side money: integer cents on the model, decimal string out.
MoneyOut = Annotated[int, PlainSerializer(cents_to_decimal_string, return_type=str)]

#: Response-side money that may be genuinely unknown.
MoneyOutOptional = Annotated[
    int | None, PlainSerializer(optional_cents_to_decimal_string, return_type=str | None)
]
