"""Sets as records, with a seeded release calendar.

`products.set_name` was free text. Free text plus a suggestion list breeds near twins -
"Fable", "Fabled", "Lorcana Fable" - and a set rollup then splits across three rows and
undercounts all of them. So a set becomes a record, unique per game and case-insensitively
by name, still created by typing a new one.

The calendar is seeded with release dates and each set only starts appearing on its own
date. That is what makes it maintenance-free: nothing has to be pruned, and an unmaintained
calendar cannot confidently name the wrong latest set six months from now. A set somebody
typed themselves carries no date and is always offered, which is also how pre-orders work.

**Anything uncertain is left out.** A missing set costs one typing session; a wrong one
silently corrupts every report that groups by set. Omitted on those grounds: Magic's TMNT
crossover (sources give both February and March), Lorcana's unnamed Q4 set, Yu-Gi-Oh's
"Beyond the Brave", and anything whose date was only given as a month.

Existing `set_name` values are backfilled into real sets, matched case-insensitively so a
product already saying "fabled" lands on the seeded "Fabled" rather than making a second one.

Revision ID: 0008_card_sets
Revises: 0007_store_credit
"""

import uuid
from collections.abc import Sequence
from datetime import date

import sqlalchemy as sa
from alembic import op

revision: str = "0008_card_sets"
down_revision: str | None = "0007_store_credit"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Games the calendar needs that the original seed did not have. All currently in print.
NEW_GAMES = [
    ("Riftbound", "riftbound"),
    ("Star Wars Unlimited", "star-wars-unlimited"),
    ("Gundam", "gundam"),
    ("Dragon Ball", "dragon-ball"),
]

#: (game slug, set name, release date). Sets appear on their date and not before.
SETS = [
    # Pokémon
    ("pokemon", "Mega Evolution: Ascended Heroes", date(2026, 1, 30)),
    ("pokemon", "Mega Evolution: Perfect Order", date(2026, 3, 20)),
    ("pokemon", "Mega Evolution: Rising Chaos", date(2026, 5, 22)),
    ("pokemon", "Mega Evolution: Pitch Black Night", date(2026, 7, 17)),
    ("pokemon", "30th Celebration", date(2026, 9, 16)),
    ("pokemon", "Delta Reign", date(2026, 11, 6)),
    # Magic: The Gathering
    ("magic-the-gathering", "Lorwyn Eclipsed", date(2026, 1, 23)),
    ("magic-the-gathering", "Marvel Super Heroes", date(2026, 6, 26)),
    ("magic-the-gathering", "The Hobbit", date(2026, 8, 14)),
    ("magic-the-gathering", "Reality Fracture", date(2026, 10, 2)),
    ("magic-the-gathering", "Mystery Booster Commander", date(2026, 11, 9)),
    ("magic-the-gathering", "Star Trek", date(2026, 11, 13)),
    # Lorcana
    ("lorcana", "Winterspell", date(2026, 2, 20)),
    ("lorcana", "Wilds Unknown", date(2026, 5, 15)),
    ("lorcana", "Attack of the Vine!", date(2026, 7, 24)),
    # One Piece
    ("one-piece", "EB-04 Adventure on KAMI's Island", date(2026, 4, 3)),
    ("one-piece", "OP-16 The Time of Battle", date(2026, 6, 12)),
    ("one-piece", "OP-17 The World's Strongest Warriors", date(2026, 8, 28)),
    # Yu-Gi-Oh!
    ("yu-gi-oh", "Burst Protocol", date(2026, 1, 26)),
    ("yu-gi-oh", "Maze of Muertos", date(2026, 2, 20)),
    ("yu-gi-oh", "Blazing Dominion", date(2026, 5, 8)),
    ("yu-gi-oh", "Chaos Origins", date(2026, 7, 3)),
    # Riftbound
    ("riftbound", "Unleashed", date(2026, 5, 8)),
    ("riftbound", "Vendetta", date(2026, 7, 31)),
    ("riftbound", "Radiance", date(2026, 10, 23)),
    # Star Wars Unlimited
    ("star-wars-unlimited", "A Lawless Time", date(2026, 3, 13)),
    # Gundam
    ("gundam", "GD05 Freedom Ascension", date(2026, 7, 24)),
    # Dragon Ball
    ("dragon-ball", "Masters Ultra Bout 3", date(2026, 3, 27)),
]


def upgrade() -> None:
    op.create_table(
        "card_sets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("game_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("released_on", sa.Date(), nullable=True),
        sa.Column("created_by_member_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("clock_timestamp()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("clock_timestamp()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["game_id"], ["games.id"]),
        sa.ForeignKeyConstraint(["created_by_member_id"], ["members.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_card_sets_game_id", "card_sets", ["game_id"])
    op.create_index(
        "uq_card_sets_game_name",
        "card_sets",
        ["game_id", sa.text("lower(name)")],
        unique=True,
    )
    op.create_index(
        "ix_card_sets_name_trgm",
        "card_sets",
        ["name"],
        postgresql_using="gin",
        postgresql_ops={"name": "gin_trgm_ops"},
    )

    connection = op.get_bind()

    for index, (name, slug) in enumerate(NEW_GAMES):
        connection.execute(
            sa.text(
                "INSERT INTO games (id, name, slug, is_system, sort_order, "
                "                   created_at, updated_at) "
                "VALUES (:id, :name, :slug, true, :sort_order, "
                "        clock_timestamp(), clock_timestamp()) "
                "ON CONFLICT (slug) DO NOTHING"
            ),
            # After the original ten, in the order listed, so the picker stays stable.
            {
                "id": uuid.uuid4(),
                "name": name,
                "slug": slug,
                "sort_order": 100 + index,
            },
        )

    for slug, name, released_on in SETS:
        connection.execute(
            sa.text(
                "INSERT INTO card_sets (id, game_id, name, released_on, created_at, updated_at) "
                "SELECT :id, games.id, :name, :released_on, clock_timestamp(), clock_timestamp() "
                "FROM games WHERE games.slug = :slug "
                "ON CONFLICT DO NOTHING"
            ),
            {"id": uuid.uuid4(), "name": name, "released_on": released_on, "slug": slug},
        )

    op.add_column("products", sa.Column("set_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_products_set_id", "products", "card_sets", ["set_id"], ["id"]
    )
    op.create_index("ix_products_set_id", "products", ["set_id"])

    # Turn every set name already in use into a real set. Matched case-insensitively, so a
    # product saying "fabled" lands on the seeded "Fabled" rather than making a second row.
    connection.execute(
        sa.text(
            "INSERT INTO card_sets (id, game_id, name, created_at, updated_at) "
            "SELECT gen_random_uuid(), game_id, min(trim(set_name)), "
            "       clock_timestamp(), clock_timestamp() "
            "FROM products "
            "WHERE set_name IS NOT NULL AND length(trim(set_name)) > 0 "
            "GROUP BY game_id, lower(trim(set_name)) "
            "ON CONFLICT DO NOTHING"
        )
    )
    connection.execute(
        sa.text(
            "UPDATE products SET set_id = card_sets.id "
            "FROM card_sets "
            "WHERE card_sets.game_id = products.game_id "
            "  AND lower(card_sets.name) = lower(trim(products.set_name))"
        )
    )


def downgrade() -> None:
    op.drop_index("ix_products_set_id", table_name="products")
    op.drop_constraint("fk_products_set_id", "products", type_="foreignkey")
    op.drop_column("products", "set_id")

    op.drop_index("ix_card_sets_name_trgm", table_name="card_sets")
    op.drop_index("uq_card_sets_game_name", table_name="card_sets")
    op.drop_index("ix_card_sets_game_id", table_name="card_sets")
    op.drop_table("card_sets")

    connection = op.get_bind()
    for _, slug in NEW_GAMES:
        connection.execute(
            sa.text("DELETE FROM games WHERE slug = :slug"), {"slug": slug}
        )
