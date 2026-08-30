"""Conservative identity matching for product-entry reuse suggestions.

The matching service only produces candidates.  It never chooses a product or writes a
transaction: the person recording a rip still explicitly chooses ``reuse`` or ``create``.
Identity is compared after Unicode normalization and punctuation folding so a camera's
``123 / 204`` and a typed ``123/204`` can describe the same card without pretending that
similar names are proof of identity.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from src.models.product import Product
from src.models.taxonomy import ProductType
from src.services.search import escape_like

MAX_CANDIDATES = 20
MAX_DATABASE_CANDIDATES = 100
REUSABLE_HIT_PRODUCT_TYPE_SLUGS = frozenset({"single", "raw-single"})

IDENTITY_FIELDS = ("name", "set_name", "collector_number", "variant", "language")


def normalize_identity(value: str | None) -> str:
    """Fold case, Unicode composition, whitespace, and punctuation for comparison."""
    if not value:
        return ""
    folded = unicodedata.normalize("NFKC", value).casefold()
    # Alphanumeric identity is deliberately stricter than free-text search while still
    # treating common camera/typing differences (``123 / 204`` vs ``123/204``) alike.
    return "".join(char for char in folded if char.isalnum())


@dataclass(frozen=True)
class ProductIdentity:
    game_id: object
    name: str
    set_name: str | None = None
    collector_number: str | None = None
    variant: str | None = None
    language: str | None = None


@dataclass(frozen=True)
class Match:
    product: Product
    score: int
    matched_fields: tuple[str, ...]


def _score(product: Product, identity: ProductIdentity) -> Match | None:
    if product.game_id != identity.game_id:
        return None

    expected_name = normalize_identity(identity.name)
    if not expected_name or normalize_identity(product.name) != expected_name:
        return None

    # A supplied identity detail that contradicts the stored value is not a candidate.
    # Blank input remains intentionally permissive: the UI can show a possible same-name
    # product and the operator can inspect it before choosing reuse.
    score = 100
    matched = ["game", "name"]
    for field, weight in (
        ("set_name", 30),
        ("collector_number", 40),
        ("variant", 20),
        ("language", 10),
    ):
        expected = normalize_identity(getattr(identity, field))
        if not expected:
            continue
        actual = normalize_identity(getattr(product, field, None))
        if actual != expected:
            return None
        score += weight
        matched.append(field)

    return Match(product=product, score=score, matched_fields=tuple(matched))


def find_candidates(db: Session, identity: ProductIdentity) -> list[Match]:
    """Find strong, non-archived candidates without making a reuse decision.

    PostgreSQL does the bounded prefilter by name tokens, then the exact normalized
    comparison above makes the final identity decision.  The limit is intentional: this
    endpoint is called while somebody is entering a hit and must not load a catalogue-sized
    result into the browser.
    """
    name = unicodedata.normalize("NFKC", identity.name).strip()
    if not name:
        return []

    tokens = [token for token in re.split(r"[^\w]+", name, flags=re.UNICODE) if token]
    prefilter = [Product.name.ilike(f"%{escape_like(token)}%", escape="\\") for token in tokens]
    statement = (
        select(Product)
        .where(
            Product.game_id == identity.game_id,
            Product.is_archived.is_(False),
            Product.product_type.has(
                ProductType.slug.in_(REUSABLE_HIT_PRODUCT_TYPE_SLUGS)
            ),
        )
        .order_by(Product.updated_at.desc(), Product.id.asc())
        .limit(MAX_DATABASE_CANDIDATES)
    )
    if prefilter:
        statement = statement.where(and_(*prefilter))

    matches = [
        found
        for product in db.scalars(statement).unique()
        if (found := _score(product, identity)) is not None
    ]
    matches.sort(key=lambda item: (-item.score, item.product.name.casefold(), str(item.product.id)))
    return matches[:MAX_CANDIDATES]


__all__ = [
    "IDENTITY_FIELDS",
    "MAX_CANDIDATES",
    "Match",
    "ProductIdentity",
    "REUSABLE_HIT_PRODUCT_TYPE_SLUGS",
    "find_candidates",
    "normalize_identity",
]
