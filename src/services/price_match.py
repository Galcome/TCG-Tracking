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

#: Enough to hold the right listing among near misses; few enough to keep the prompt cheap.
MAX_CANDIDATES = 8

Method = Literal["exact", "ai"]


@dataclass(frozen=True)
class Suggestion:
    candidates: list[CatalogProduct]
    #: Index into `candidates`, or None when neither code nor a model could tell.
    suggested: int | None = None
    method: Method | None = None
    #: Why there are no candidates at all, for the person looking at an empty list.
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


def _exact(product: Product, catalog: list[CatalogProduct]) -> list[CatalogProduct]:
    names = {_normalise(product.name), _normalise(f"{product.card_set.name} {product.name}")}
    number = _card_number(product.collector_number)
    return [
        item
        for item in catalog
        if (_normalise(item.name) in names or _normalise(item.clean_name) in names)
        and (number is None or _card_number(item.number) == number)
    ]


def _ranked(product: Product, catalog: list[CatalogProduct]) -> list[CatalogProduct]:
    """The closest listings by shared words, ignoring the set name every listing carries."""
    set_words = _words(product.card_set.name)
    wanted = _words(product.name) - set_words
    number = _card_number(product.collector_number)
    scored: list[tuple[float, str, CatalogProduct]] = []
    for item in catalog:
        words = _words(item.name) - set_words
        union = wanted | words
        score = len(wanted & words) / len(union) if union else 0.0
        if number is not None and _card_number(item.number) == number:
            score += 1.0
        if score > 0:
            scored.append((score, item.name.casefold(), item))
    scored.sort(key=lambda row: (-row[0], row[1]))
    return [item for _, _, item in scored[:MAX_CANDIDATES]]


def _subject(product: Product) -> str:
    details = [f"set: {product.card_set.name}"]
    if product.collector_number:
        details.append(f"number: {product.collector_number}")
    if product.variant:
        details.append(f"variant: {product.variant}")
    return f"{product.product_type.name} - {product.name} ({', '.join(details)})"


def _option(item: CatalogProduct) -> str:
    return f"{item.name} (number {item.number})" if item.number else item.name


def suggest(product: Product, provider: TCGCSVProvider) -> Suggestion:
    """The listing this product most likely is. Raises `PricingError` if the catalog is down."""
    category_id = product.game.tcgcsv_category_id
    card_set = product.card_set
    if category_id is None or card_set is None or card_set.tcgcsv_group_id is None:
        return Suggestion(
            [], message="This product's set is not linked to the price catalog yet."
        )

    catalog = provider.group_products(category_id, card_set.tcgcsv_group_id)
    exact = _exact(product, catalog)
    if len(exact) == 1:
        return Suggestion(exact, suggested=0, method="exact")

    candidates = _ranked(product, catalog)
    if not candidates:
        return Suggestion(
            [], message=f"No listing in {card_set.name} looks like this product."
        )
    try:
        chosen = ai.choose(_subject(product), [_option(item) for item in candidates])
    except ai.AIUnavailable:
        # No model reachable: the ranked list is still a much shorter search than the group.
        chosen = None
    if chosen is None:
        return Suggestion(candidates)
    return Suggestion(candidates, suggested=chosen, method="ai")
