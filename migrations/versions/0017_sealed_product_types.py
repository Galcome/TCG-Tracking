"""Name the sealed products that were all being filed under Box Set.

Revision ID: 0017_sealed_product_types
Revises: 0016_hidden_products
"""

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017_sealed_product_types"
down_revision: str | None = "0016_hidden_products"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The namespace the foundation migration seeds taxonomy with, so IDs stay derivable.
SEED_NAMESPACE = uuid.UUID("6f0f5b1a-0b5e-5e6f-9a2c-0d1f2e3a4b5c")

# An Elite Trainer Box and a Pokémon Center one are separate types because they hold a
# different number of packs, and the pack count is what a crack divides the cost by.
PRODUCT_TYPES = [
    ("Elite Trainer Box", "elite-trainer-box"),
    ("Pokémon Center Elite Trainer Box", "pokemon-center-elite-trainer-box"),
    ("ETB Case", "etb-case"),
    ("Booster Bundle", "booster-bundle"),
    ("Collector Booster Box", "collector-booster-box"),
    ("Premium Collection", "premium-collection"),
    ("Illumineer's Trove", "illumineers-trove"),
    ("Tin", "tin"),
    ("Blister", "blister"),
    ("Gift Set", "gift-set"),
    ("Prerelease Kit", "prerelease-kit"),
    ("Secret Lair", "secret-lair"),
]
FIRST_SORT_ORDER = 12
CATCH_ALLS = {"lot": 40, "other": 41}
FORMER_CATCH_ALLS = {"lot": 10, "other": 11}


def upgrade() -> None:
    insert = sa.text(
        "INSERT INTO product_types (id, name, slug, is_system, sort_order) "
        "SELECT CAST(:id AS uuid), CAST(:name AS varchar), CAST(:slug AS varchar), true, "
        "CAST(:sort_order AS integer) "
        "WHERE NOT EXISTS ("
        "SELECT 1 FROM product_types "
        "WHERE slug = CAST(:slug AS varchar) OR lower(name) = lower(CAST(:name AS varchar)))"
    )
    connection = op.get_bind()
    for index, (name, slug) in enumerate(PRODUCT_TYPES):
        connection.execute(
            insert,
            {
                "id": uuid.uuid5(SEED_NAMESPACE, f"product_type/{slug}"),
                "name": name,
                "slug": slug,
                "sort_order": FIRST_SORT_ORDER + index,
            },
        )
    _reorder(CATCH_ALLS)


def downgrade() -> None:
    # A type somebody has filed a product under stays; removing it would orphan the product.
    op.get_bind().execute(
        sa.text(
            "DELETE FROM product_types WHERE slug IN :slugs AND NOT EXISTS ("
            "SELECT 1 FROM products WHERE products.product_type_id = product_types.id)"
        ).bindparams(sa.bindparam("slugs", expanding=True)),
        {"slugs": [slug for _, slug in PRODUCT_TYPES]},
    )
    _reorder(FORMER_CATCH_ALLS)


def _reorder(orders: dict[str, int]) -> None:
    """Keep Lot and Other at the end of the list, after the named sealed products."""
    update = sa.text("UPDATE product_types SET sort_order = :sort_order WHERE slug = :slug")
    for slug, sort_order in orders.items():
        op.get_bind().execute(update, {"slug": slug, "sort_order": sort_order})
