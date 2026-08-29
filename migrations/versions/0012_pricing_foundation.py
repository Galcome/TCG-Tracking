"""Provider mappings and display-only market quote history.

Revision ID: 0012_pricing_foundation
Revises: 0011_grading
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012_pricing_foundation"
down_revision: str | None = "0011_grading"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamps() -> list[sa.Column]:
    return [
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
    ]


def upgrade() -> None:
    op.create_table(
        "catalog_mappings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(length=40), nullable=False),
        sa.Column("external_product_id", sa.String(length=120), nullable=False),
        sa.Column("external_group_id", sa.String(length=80), nullable=True),
        sa.Column("external_category_id", sa.String(length=80), nullable=True),
        sa.Column("subtype_name", sa.String(length=80), nullable=False),
        sa.Column("condition", sa.String(length=40), nullable=True),
        sa.Column("language", sa.String(length=40), nullable=True),
        sa.Column("match_status", sa.String(length=20), nullable=False, server_default="confirmed"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_member_id", sa.Uuid(), nullable=True),
        *_timestamps(),
        sa.CheckConstraint(
            "length(trim(provider)) > 0", name="ck_catalog_mappings_provider_present"
        ),
        sa.CheckConstraint(
            "length(trim(external_product_id)) > 0",
            name="ck_catalog_mappings_external_product_present",
        ),
        sa.CheckConstraint(
            "length(trim(subtype_name)) > 0", name="ck_catalog_mappings_subtype_present"
        ),
        sa.CheckConstraint(
            "match_status IN ('confirmed', 'disabled')",
            name="ck_catalog_mappings_status",
        ),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["created_by_member_id"], ["members.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("product_id", "provider", name="uq_catalog_mappings_product_provider"),
    )
    op.create_index(
        "ix_catalog_mappings_provider_status",
        "catalog_mappings",
        ["provider", "match_status"],
    )

    op.create_table(
        "current_market_quotes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("mapping_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="unavailable"),
        sa.Column("original_currency", sa.String(length=3), nullable=True),
        sa.Column("original_value_cents", sa.BigInteger(), nullable=True),
        sa.Column("cad_value_cents", sa.BigInteger(), nullable=True),
        sa.Column("fx_rate", sa.Numeric(precision=20, scale=10), nullable=True),
        sa.Column("fx_as_of", sa.Date(), nullable=True),
        sa.Column("source_revision", sa.String(length=120), nullable=True),
        sa.Column("source_as_of", sa.Date(), nullable=True),
        sa.Column("last_attempted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_successful_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        *_timestamps(),
        sa.CheckConstraint(
            "status IN ('fresh', 'stale', 'unavailable')",
            name="ck_current_market_quotes_status",
        ),
        sa.CheckConstraint(
            "original_value_cents IS NULL OR original_value_cents >= 0",
            name="ck_current_market_quotes_original_non_negative",
        ),
        sa.CheckConstraint(
            "cad_value_cents IS NULL OR cad_value_cents >= 0",
            name="ck_current_market_quotes_cad_non_negative",
        ),
        sa.ForeignKeyConstraint(
            ["mapping_id"], ["catalog_mappings.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("mapping_id", name="uq_current_market_quotes_mapping"),
    )
    op.create_index("ix_current_market_quotes_product", "current_market_quotes", ["product_id"])

    op.create_table(
        "market_price_snapshots",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("mapping_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(length=40), nullable=False),
        sa.Column("external_product_id", sa.String(length=120), nullable=False),
        sa.Column("subtype_name", sa.String(length=80), nullable=False),
        sa.Column("condition", sa.String(length=40), nullable=True),
        sa.Column("original_currency", sa.String(length=3), nullable=False),
        sa.Column("original_value_cents", sa.BigInteger(), nullable=False),
        sa.Column("cad_value_cents", sa.BigInteger(), nullable=False),
        sa.Column("fx_rate", sa.Numeric(precision=20, scale=10), nullable=False),
        sa.Column("fx_as_of", sa.Date(), nullable=False),
        sa.Column("source_revision", sa.String(length=120), nullable=False),
        sa.Column("source_as_of", sa.Date(), nullable=False),
        sa.Column("captured_on", sa.Date(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        *_timestamps(),
        sa.CheckConstraint(
            "length(trim(original_currency)) = 3",
            name="ck_market_price_snapshots_currency",
        ),
        sa.CheckConstraint(
            "original_value_cents >= 0",
            name="ck_market_price_snapshots_original_non_negative",
        ),
        sa.CheckConstraint(
            "cad_value_cents >= 0",
            name="ck_market_price_snapshots_cad_non_negative",
        ),
        sa.ForeignKeyConstraint(
            ["mapping_id"], ["catalog_mappings.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_market_price_snapshots_product_date",
        "market_price_snapshots",
        ["product_id", "captured_on"],
    )
    op.create_index(
        "ix_market_price_snapshots_mapping_date",
        "market_price_snapshots",
        ["mapping_id", "captured_on"],
    )


def downgrade() -> None:
    op.drop_index("ix_market_price_snapshots_mapping_date", table_name="market_price_snapshots")
    op.drop_index("ix_market_price_snapshots_product_date", table_name="market_price_snapshots")
    op.drop_table("market_price_snapshots")
    op.drop_index("ix_current_market_quotes_product", table_name="current_market_quotes")
    op.drop_table("current_market_quotes")
    op.drop_index("ix_catalog_mappings_provider_status", table_name="catalog_mappings")
    op.drop_table("catalog_mappings")
