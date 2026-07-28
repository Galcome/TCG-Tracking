"""Foundation: members, taxonomy, products, trigram search.

Revision ID: 0001_foundation
Revises:
Create Date: 2026-07-27

Seed rows use uuid5 derived from their slug so every environment - local, CI, Neon -
ends up with byte-identical taxonomy IDs without hardcoding literals.
"""

import uuid

import sqlalchemy as sa
from alembic import op

revision = "0001_foundation"
down_revision = None
branch_labels = None
depends_on = None

SEED_NAMESPACE = uuid.UUID("6f0f5b1a-0b5e-5e6f-9a2c-0d1f2e3a4b5c")

SEARCH_TEXT_EXPRESSION = (
    "coalesce(name, '') || ' ' || "
    "coalesce(set_name, '') || ' ' || "
    "coalesce(collector_number, '') || ' ' || "
    "coalesce(cert_number, '') || ' ' || "
    "coalesce(storage_location, '') || ' ' || "
    "coalesce(notes, '')"
)

GAMES = [
    ("Pokémon", "pokemon"),
    ("Magic: The Gathering", "magic-the-gathering"),
    ("Yu-Gi-Oh!", "yu-gi-oh"),
    ("Lorcana", "lorcana"),
    ("One Piece", "one-piece"),
    ("Digimon", "digimon"),
    ("Flesh and Blood", "flesh-and-blood"),
    ("Sorcery", "sorcery"),
    ("Sports", "sports"),
    ("Other", "other"),
]

PRODUCT_TYPES = [
    ("Single", "single"),
    ("Raw Single", "raw-single"),
    ("Graded Card", "graded-card"),
    ("Booster Pack", "booster-pack"),
    ("Booster Box", "booster-box"),
    ("Sealed Case", "sealed-case"),
    ("Collection", "collection"),
    ("Binder", "binder"),
    ("Deck", "deck"),
    ("Box Set", "box-set"),
    ("Lot", "lot"),
    ("Other", "other"),
]


def seed_id(kind: str, slug: str) -> uuid.UUID:
    """Stable ID for a seeded taxonomy row."""
    return uuid.uuid5(SEED_NAMESPACE, f"{kind}/{slug}")


def _timestamp_columns() -> list[sa.Column]:
    now = sa.text("now()")
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
    ]


def _taxonomy_columns() -> list[sa.Column]:
    return [
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(60), nullable=False, unique=True),
        sa.Column("slug", sa.String(60), nullable=False, unique=True),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("100")),
        *_timestamp_columns(),
    ]


def upgrade() -> None:
    # Trigram matching powers forgiving product search (partial words, typos).
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    op.create_table(
        "members",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("auth_user_id", sa.String(128), nullable=True, unique=True),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("display_name", sa.String(100), nullable=False),
        sa.Column("role", sa.String(20), nullable=False, server_default="member"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        *_timestamp_columns(),
        sa.CheckConstraint("role IN ('member', 'admin')", name="ck_members_role"),
        sa.CheckConstraint(
            "length(trim(display_name)) > 0", name="ck_members_display_name_present"
        ),
    )

    games = op.create_table(
        "games",
        *_taxonomy_columns(),
        sa.CheckConstraint("length(trim(name)) > 0", name="ck_games_name_present"),
        sa.CheckConstraint("length(trim(slug)) > 0", name="ck_games_slug_present"),
    )
    product_types = op.create_table(
        "product_types",
        *_taxonomy_columns(),
        sa.CheckConstraint("length(trim(name)) > 0", name="ck_product_types_name_present"),
        sa.CheckConstraint("length(trim(slug)) > 0", name="ck_product_types_slug_present"),
    )

    op.create_table(
        "products",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("game_id", sa.Uuid(), sa.ForeignKey("games.id"), nullable=False),
        sa.Column(
            "product_type_id", sa.Uuid(), sa.ForeignKey("product_types.id"), nullable=False
        ),
        sa.Column("set_name", sa.String(120), nullable=True),
        sa.Column("collector_number", sa.String(40), nullable=True),
        sa.Column("variant", sa.String(80), nullable=True),
        sa.Column("language", sa.String(40), nullable=True),
        sa.Column("condition", sa.String(40), nullable=True),
        sa.Column("grading_company", sa.String(40), nullable=True),
        sa.Column("grade", sa.String(20), nullable=True),
        sa.Column("cert_number", sa.String(40), nullable=True),
        sa.Column("external_ref", sa.String(120), nullable=True),
        sa.Column("image_url", sa.String(500), nullable=True),
        sa.Column("storage_location", sa.String(120), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_by_member_id", sa.Uuid(), sa.ForeignKey("members.id"), nullable=True),
        sa.Column(
            "search_text",
            sa.Text(),
            sa.Computed(SEARCH_TEXT_EXPRESSION, persisted=True),
            nullable=False,
        ),
        *_timestamp_columns(),
        sa.CheckConstraint("length(trim(name)) > 0", name="ck_products_name_present"),
    )
    op.create_index("ix_products_game_id", "products", ["game_id"])
    op.create_index("ix_products_product_type_id", "products", ["product_type_id"])
    op.create_index("ix_products_is_archived", "products", ["is_archived"])
    op.create_index(
        "ix_products_search_text_trgm",
        "products",
        ["search_text"],
        postgresql_using="gin",
        postgresql_ops={"search_text": "gin_trgm_ops"},
    )

    op.bulk_insert(
        games,
        [
            {
                "id": seed_id("game", slug),
                "name": name,
                "slug": slug,
                "is_system": True,
                "sort_order": index,
            }
            for index, (name, slug) in enumerate(GAMES)
        ],
    )
    op.bulk_insert(
        product_types,
        [
            {
                "id": seed_id("product_type", slug),
                "name": name,
                "slug": slug,
                "is_system": True,
                "sort_order": index,
            }
            for index, (name, slug) in enumerate(PRODUCT_TYPES)
        ],
    )


def downgrade() -> None:
    op.drop_table("products")
    op.drop_table("product_types")
    op.drop_table("games")
    op.drop_table("members")
    # pg_trgm is left installed: other objects may depend on it and dropping an
    # extension is not something a schema downgrade should decide.
