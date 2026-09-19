"""Price a card from what the camera read, before it is a product.

A scan yields an identity - name, set, number, variant - and a person wants to see what it
is worth before deciding to add it. That takes three steps, each settled by code when code
can be certain and by a cheap model only when it cannot:

1. **The set.** The read set name (or its printed code, "SVI") against the game's sets that
   the daily sync has linked to a catalog group. Equal names or codes are certain; anything
   less goes to `ai.choose` as a short list.
2. **The listing.** `price_match.match` within that one group.
3. **The price.** The catalog's own market price for that listing and printing, converted
   to CAD like the nightly refresh does. Never a model's number.

The result prefills a row the person can still change. Nothing is written here.
"""

from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.card_set import CardSet
from src.models.taxonomy import Game
from src.services import ai, price_match
from src.services.pricing import (
    BankOfCanadaProvider,
    CatalogProduct,
    PricingError,
    TCGCSVProvider,
    _cents,
)

#: A printed code or a read name, compared the same forgiving way product names are.
_normalise = price_match._normalise


@dataclass(frozen=True)
class PricedListing:
    listing: CatalogProduct
    subtype: str
    #: CAD cents, or None when the catalog has no market price for this printing today.
    market_cents: int | None


@dataclass(frozen=True)
class Lookup:
    set_id: uuid.UUID | None = None
    set_name: str | None = None
    candidates: list[PricedListing] = field(default_factory=list)
    suggested: int | None = None
    method: price_match.Method | None = None
    message: str | None = None


def preferred_subtype(subtypes: tuple[str, ...], variant: str | None) -> str:
    """The printing the read variant names, else Normal, else the first there is.

    Same rule as the app's `preferredSubtype`, plus the one shorthand a camera reads off a
    Pokémon card: "holo" is what TCGCSV calls "Holofoil".
    """
    wanted = _normalise(variant)
    spelled = {wanted, wanted.replace("holo", "holofoil").replace("holofoilfoil", "holofoil")}
    for subtype in subtypes:
        if _normalise(subtype) in spelled:
            return subtype
    return next((subtype for subtype in subtypes if subtype == "Normal"), None) or (
        subtypes[0] if subtypes else "Normal"
    )


class _DailyRate:
    """USD to CAD, fetched once a day. A scan session prices dozens of cards on one rate."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._rate: tuple[date, Decimal] | None = None

    def get(self, fx: BankOfCanadaProvider, today: date) -> Decimal:
        with self._lock:
            if self._rate is None or self._rate[0] != today:
                self._rate = (today, fx.usd_cad(today).rate)
            return self._rate[1]


daily_rate = _DailyRate()


def _resolve_set(
    db: Session, game: Game, set_name: str, provider: TCGCSVProvider
) -> CardSet | None:
    """The linked set the camera's set name means, or None when nobody can tell."""
    linked = {
        card_set.tcgcsv_group_id: card_set
        for card_set in db.scalars(
            select(CardSet)
            .where(CardSet.game_id == game.id, CardSet.tcgcsv_group_id.is_not(None))
            .order_by(CardSet.name)
        )
    }
    if not linked:
        return None
    codes = {
        group.group_id: group.abbreviation
        for group in provider.groups(game.tcgcsv_category_id)
        if group.group_id in linked
    }
    wanted = _normalise(set_name)
    exact = [
        card_set
        for group_id, card_set in linked.items()
        if wanted in {_normalise(card_set.name), _normalise(codes.get(group_id))}
    ]
    if len(exact) == 1:
        return exact[0]

    scored = sorted(
        (
            (price_match.overlap(set_name, card_set.name), card_set.name.casefold(), card_set)
            for card_set in linked.values()
        ),
        key=lambda row: (-row[0], row[1]),
    )
    options = [card_set for score, _, card_set in scored if score > 0][
        : price_match.MAX_CANDIDATES
    ]
    if not options:
        return None
    try:
        chosen = ai.choose(
            f"{game.name} set, as read off a card: {set_name}",
            [card_set.name for card_set in options],
        )
    except ai.AIUnavailable:
        return None
    return None if chosen is None else options[chosen]


def lookup(
    db: Session,
    game: Game,
    *,
    name: str,
    set_name: str,
    number: str | None,
    variant: str | None,
    provider: TCGCSVProvider,
    kind: str = "Single",
    fx: BankOfCanadaProvider,
    today: date | None = None,
) -> Lookup:
    """What this card is in the catalog, and what it is worth. `PricingError` if it is down."""
    if game.tcgcsv_category_id is None:
        return Lookup(message=f"{game.name} is not in the price catalog.")
    if not set_name.strip():
        return Lookup(message="The set was not readable. Pick it by hand.")

    card_set = _resolve_set(db, game, set_name, provider)
    if card_set is None:
        return Lookup(message=f"Could not tell which set “{set_name}” is.")

    found = price_match.match(
        price_match.Identity(
            name=name, set_name=card_set.name, kind=kind, number=number, variant=variant
        ),
        provider.group_products(game.tcgcsv_category_id, card_set.tcgcsv_group_id),
    )
    if not found.candidates:
        return Lookup(card_set.id, card_set.name, message=found.message)

    prices = provider.market_prices(game.tcgcsv_category_id, card_set.tcgcsv_group_id)
    try:
        rate = daily_rate.get(fx, today or date.today())
    except PricingError:
        # The listing is still worth showing; the person types the price instead.
        rate = None

    priced: list[PricedListing] = []
    for listing in found.candidates:
        subtype = preferred_subtype(listing.subtypes, variant)
        usd = prices.get((listing.product_id, subtype.casefold()))
        cents = None if usd is None or rate is None else _cents(usd * rate)
        priced.append(PricedListing(listing, subtype, cents))

    return Lookup(
        set_id=card_set.id,
        set_name=card_set.name,
        candidates=priced,
        suggested=found.suggested,
        method=found.method,
        message=None if rate is not None else "Exchange rate unavailable; enter the price.",
    )
