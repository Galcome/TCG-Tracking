"""Give the rest of the Pokémon sealed lineup its own product types.

0017 filed an Ultra-Premium Collection, a Build & Battle Box and a Mini Tin under types
that do not describe them. Each is a separate product with its own market price and,
for most, its own pack count, so each gets a type.

Revision ID: 0018_more_pokemon_sealed_types
Revises: 0017_sealed_product_types
"""

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018_more_pokemon_sealed_types"
down_revision: str | None = "0017_sealed_product_types"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The namespace the foundation migration seeds taxonomy with, so IDs stay derivable.
SEED_NAMESPACE = uuid.UUID("6f0f5b1a-0b5e-5e6f-9a2c-0d1f2e3a4b5c")

NEW_TYPES = [
    ("Ultra-Premium Collection", "ultra-premium-collection"),
    ("Super-Premium Collection", "super-premium-collection"),
    ("Pin Collection", "pin-collection"),
    ("Poster Collection", "poster-collection"),
    ("Build & Battle Box", "build-and-battle-box"),
    ("Build & Battle Stadium", "build-and-battle-stadium"),
    ("Trainer's Toolkit", "trainers-toolkit"),
    ("Holiday Calendar", "holiday-calendar"),
    ("Mini Tin", "mini-tin"),
]
NEW_SLUGS = [slug for _, slug in NEW_TYPES]

# Every sealed type after Collector Booster Box (16), in list order. Collections stay
# together, and a Mini Tin sits beside the Tin. Lot and Other keep 40 and 41.
ORDER = [
    "premium-collection",
    "ultra-premium-collection",
    "super-premium-collection",
    "pin-collection",
    "poster-collection",
    "build-and-battle-box",
    "build-and-battle-stadium",
    "trainers-toolkit",
    "holiday-calendar",
    "illumineers-trove",
    "tin",
    "mini-tin",
    "blister",
    "gift-set",
    "prerelease-kit",
    "secret-lair",
]
FIRST_SORT_ORDER = 17


def upgrade() -> None:
    insert = sa.text(
        "INSERT INTO product_types (id, name, slug, is_system, sort_order) "
        "SELECT CAST(:id AS uuid), CAST(:name AS varchar), CAST(:slug AS varchar), true, 0 "
        "WHERE NOT EXISTS ("
        "SELECT 1 FROM product_types "
        "WHERE slug = CAST(:slug AS varchar) OR lower(name) = lower(CAST(:name AS varchar)))"
    )
    for name, slug in NEW_TYPES:
        op.get_bind().execute(
            insert,
            {"id": uuid.uuid5(SEED_NAMESPACE, f"product_type/{slug}"), "name": name, "slug": slug},
        )
    _reorder(ORDER)


def downgrade() -> None:
    # A type somebody has filed a product under stays; removing it would orphan the product.
    op.get_bind().execute(
        sa.text(
            "DELETE FROM product_types WHERE slug IN :slugs AND NOT EXISTS ("
            "SELECT 1 FROM products WHERE products.product_type_id = product_types.id)"
        ).bindparams(sa.bindparam("slugs", expanding=True)),
        {"slugs": NEW_SLUGS},
    )
    _reorder([slug for slug in ORDER if slug not in NEW_SLUGS])


def _reorder(slugs: list[str]) -> None:
    update = sa.text("UPDATE product_types SET sort_order = :sort_order WHERE slug = :slug")
    for index, slug in enumerate(slugs):
        op.get_bind().execute(update, {"slug": slug, "sort_order": FIRST_SORT_ORDER + index})
