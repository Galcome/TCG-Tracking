"""Suggest the catalog listing for one product, so pricing it is a tap instead of a search.

The set a product is filed under already knows its catalog group (set sync links them), so
the listing is somewhere in one group of a few hundred. Two ways to pick it:

- **Code**, when it can be certain: exactly one listing whose name is the product's name
  (with or without the set name in front) and, for a card with a number, the same number.
- **A cheap model**, when it cannot: the closest few listings by shared words go to
  `ai.choose`, which answers with one of them or none.

Either way the result is a suggestion. A person confirms it before any quote is taken, the
same as a mapping picked by hand, and a quote never touches cost, stock or profit.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Literal

from src.models.product import Product
from src.services import ai
from src.services.pricing import CatalogProduct, TCGCSVProvider
from src.services.set_sync import display_name

#: Enough to hold the right listing among near misses; few enough to keep the prompt cheap.
MAX_CANDIDATES = 8

#: Product type names whose listing is one card. Everything else is a sealed product.
SINGLE_KINDS = frozenset({"single", "raw single", "graded card"})

#: Product types whose name is also how the catalog lists them, so a group without one
#: really has none. "Box Set" or "Collection" never appear in a listing's name.
LISTED_KINDS = frozenset({"booster box", "booster pack"})

Method = Literal["exact", "ai"]


@dataclass(frozen=True)
class Suggestion:
    candidates: list[CatalogProduct]
    #: Index into `candidates`, or None when neither code nor a model could tell.
    suggested: int | None = None
    method: Method | None = None
    #: Why the list is empty or cannot hold the product, for the person looking at it.
    message: str | None = None


def _normalise(text: str | None) -> str:
    # "Pokémon" and "Pokemon", "&" and "and" are the same words to a person.
    plain = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    plain = plain.casefold().replace("&", " and ")
    return " ".join(re.sub(r"[^a-z0-9]+", " ", plain).split())


def _words(text: str | None) -> set[str]:
    return set(_normalise(text).split())


def _card_number(text: str | None) -> str | None:
    """ "025/165" and "25" are the same card; "TG05" stays "tg05"."""
    head = _normalise((text or "").split("/")[0]).replace(" ", "")
    if not head:
        return None
    return (head.lstrip("0") or "0") if head.isdigit() else head


@dataclass(frozen=True)
class Identity:
    """What a card or product is, from a stored product or from a camera read."""

    name: str
    set_name: str
    kind: str
    number: str | None = None
    variant: str | None = None


def identity(product: Product) -> Identity:
    return Identity(
        name=product.name,
        set_name=product.card_set.name,
        kind=product.product_type.name,
        number=product.collector_number,
        variant=product.variant,
    )


def wants_a_card(wanted: Identity) -> bool:
    """Whether this is one card rather than a sealed product.

    A catalog carries both in the same group, and only the cards have a printed number.
    A recorded number settles it; otherwise the product type does.
    """
    return _card_number(wanted.number) is not None or _normalise(wanted.kind) in SINGLE_KINDS


def _listed_names(item: CatalogProduct) -> set[str]:
    # "ME: 30th Celebration Elite Trainer Box": the set code is not part of the name.
    return {
        _normalise(name)
        for text in (item.name, item.clean_name)
        if text
        for name in (text, display_name(text))
    }


def _exact(wanted: Identity, catalog: list[CatalogProduct]) -> list[CatalogProduct]:
    names = {_normalise(wanted.name), _normalise(f"{wanted.set_name} {wanted.name}")}
    number = _card_number(wanted.number)
    # A sealed product is never a numbered card, whatever its name says. The reverse is
    # not assumed: a catalog single can be listed without a number.
    card = wants_a_card(wanted)
    return [
        item
        for item in catalog
        if _listed_names(item) & names
        and (number is None or _card_number(item.number) == number)
        and (card or _card_number(item.number) is None)
    ]


def overlap(wanted: str, offered: str, ignore: set[str] | frozenset[str] = frozenset()) -> float:
    """Shared words over all words: 1.0 for the same words, 0.0 for none in common."""
    left, right = _words(wanted) - ignore, _words(offered) - ignore
    union = left | right
    return len(left & right) / len(union) if union else 0.0


def _ranked(wanted: Identity, catalog: list[CatalogProduct]) -> list[CatalogProduct]:
    """The closest listings by shared words, ignoring the set name every listing carries.

    A listing of the wrong kind sorts below every listing of the right kind however many
    words it shares, so a single never outranks a box for a box.
    """
    set_words = _words(wanted.set_name)
    number = _card_number(wanted.number)
    card = wants_a_card(wanted)
    scored: list[tuple[bool, float, str, CatalogProduct]] = []
    for item in catalog:
        score = overlap(wanted.name, item.name, set_words)
        if number is not None and _card_number(item.number) == number:
            score += 1.0
        if score > 0:
            same_kind = (_card_number(item.number) is not None) == card
            scored.append((same_kind, score, item.name.casefold(), item))
    scored.sort(key=lambda row: (not row[0], -row[1], row[2]))
    return [item for _, _, _, item in scored[:MAX_CANDIDATES]]


def _subject(wanted: Identity) -> str:
    details = [f"set: {wanted.set_name}"]
    if wanted.number:
        details.append(f"number: {wanted.number}")
    if wanted.variant:
        details.append(f"variant: {wanted.variant}")
    return f"{wanted.kind} - {wanted.name} ({', '.join(details)})"


def _option(item: CatalogProduct) -> str:
    return f"{item.name} (number {item.number})" if item.number else item.name


def _missing_kind(wanted: Identity, catalog: list[CatalogProduct]) -> str | None:
    """A message when the set has no listing of this product's type at all."""
    kind = _normalise(wanted.kind)
    if kind not in LISTED_KINDS or any(kind in _normalise(item.name) for item in catalog):
        return None
    return (
        f"{wanted.set_name} has no {wanted.kind} listing. If you bought something else, "
        "edit this product's type and name to match it; otherwise skip it."
    )


def match(wanted: Identity, catalog: list[CatalogProduct]) -> Suggestion:
    """The listing in one catalog group that `wanted` most likely is."""
    exact = _exact(wanted, catalog)
    if len(exact) == 1:
        return Suggestion(exact, suggested=0, method="exact")

    missing = _missing_kind(wanted, catalog)
    candidates = _ranked(wanted, catalog)
    if missing:
        # Any pick would be a different product; the list is only there to jog a memory.
        return Suggestion(candidates, message=missing)
    if not candidates:
        return Suggestion([], message=f"No listing in {wanted.set_name} looks like this.")
    try:
        chosen = ai.choose(_subject(wanted), [_option(item) for item in candidates])
    except ai.AIUnavailable:
        # No model reachable: the ranked list is still a much shorter search than the group.
        chosen = None
    if chosen is None:
        return Suggestion(candidates)
    return Suggestion(candidates, suggested=chosen, method="ai")


def suggest(product: Product, provider: TCGCSVProvider) -> Suggestion:
    """The listing this product most likely is. Raises `PricingError` if the catalog is down."""
    category_id = product.game.tcgcsv_category_id
    card_set = product.card_set
    if category_id is None or card_set is None or card_set.tcgcsv_group_id is None:
        return Suggestion([], message="This product's set is not linked to the price catalog yet.")
    return match(identity(product), provider.group_products(category_id, card_set.tcgcsv_group_id))
