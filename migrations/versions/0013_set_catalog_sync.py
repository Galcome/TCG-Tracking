"""Link games and sets to the TCGCSV catalog so new releases arrive by themselves.

Revision ID: 0013_set_catalog_sync
Revises: 0012_pricing_foundation
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013_set_catalog_sync"
down_revision: str | None = "0012_pricing_foundation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: TCGplayer category IDs as TCGCSV publishes them. English-language catalogs only.
#: Sports and Other have no single category, and Dragon Ball spans two live ones
#: (Masters and Fusion World), so those stay unsynced and are typed as before.
CATEGORY_IDS = (
    ("magic-the-gathering", 1),
    ("yu-gi-oh", 2),
    ("pokemon", 3),
    ("flesh-and-blood", 62),
    ("digimon", 63),
    ("one-piece", 68),
    ("lorcana", 71),
    ("sorcery", 77),
    ("star-wars-unlimited", 79),
    ("gundam", 86),
    ("riftbound", 89),
)


def upgrade() -> None:
    op.add_column("games", sa.Column("tcgcsv_category_id", sa.Integer(), nullable=True))
    op.create_index(
        "ix_games_tcgcsv_category_id", "games", ["tcgcsv_category_id"], unique=True
    )
    op.add_column("card_sets", sa.Column("tcgcsv_group_id", sa.Integer(), nullable=True))
    # TCGplayer group IDs are global, so one catalog group can back at most one set.
    op.create_index(
        "ix_card_sets_tcgcsv_group_id", "card_sets", ["tcgcsv_group_id"], unique=True
    )

    games = sa.table(
        "games", sa.column("slug", sa.String), sa.column("tcgcsv_category_id", sa.Integer)
    )
    for slug, category_id in CATEGORY_IDS:
        op.execute(
            games.update()
            .where(games.c.slug == slug)
            .values(tcgcsv_category_id=category_id)
        )


def downgrade() -> None:
    op.drop_index("ix_card_sets_tcgcsv_group_id", table_name="card_sets")
    op.drop_column("card_sets", "tcgcsv_group_id")
    op.drop_index("ix_games_tcgcsv_category_id", table_name="games")
    op.drop_column("games", "tcgcsv_category_id")
