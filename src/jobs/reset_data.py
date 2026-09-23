"""Empty the app's data so a real opening position can be loaded on top.

This exists for exactly one moment: going live. The database held test data, the group's
real records live in a spreadsheet, and the two must not be mixed - a demo purchase left
behind would sit in the cost basis forever and quietly make every report wrong.

What survives is what is not data: the schema, the alembic version, the seeded taxonomy
(games and product types, which migrations own), and the members, because a member row is
a person's access, not a transaction. Everything else goes.

Deleting is ordered by the metadata's own dependency sort, reversed, so children go before
parents and no foreign key has to be named here by hand. Nothing is truncated and no schema
object is dropped: a mistake in this file should fail loudly against a constraint rather
than quietly succeed against the wrong database.

Run it, on purpose, against the database in DATABASE_URL:

    uv run python -m src.jobs.reset_data --i-understand-this-deletes-everything
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections.abc import Callable
from contextlib import AbstractContextManager

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from src.database import Base, get_db
from src.services import money

logger = logging.getLogger(__name__)

#: Tables the reset leaves alone. Taxonomy is seeded by migration 0001 and referenced by
#: slug all over the app; members are people, and deleting them would only mean everyone
#: re-provisions on their next request with new ids and no audit trail.
KEEP_TABLES = ("games", "product_types", "members", "alembic_version")

#: Typed back by the operator. Long enough that it cannot be muscle memory.
CONFIRM_PHRASE = "DELETE ALL DATA"

FLAG = "--i-understand-this-deletes-everything"


class ResetAborted(RuntimeError):
    """The operator did not confirm, so nothing was touched."""


def _target_tables() -> list:
    """Child-before-parent order, straight from the model metadata."""
    return [
        table
        for table in reversed(Base.metadata.sorted_tables)
        if table.name not in KEEP_TABLES
    ]


def counts(db: Session) -> dict[str, int]:
    """Row count per table the reset would empty, skipping the ones already empty."""
    tallies = {}
    for table in _target_tables():
        total = db.scalar(select(func.count()).select_from(table)) or 0
        if total:
            tallies[table.name] = total
    return tallies


def reset(db: Session) -> dict[str, int]:
    """Delete every row from the data tables and re-create the money accounts.

    Returns what was deleted, per table. `ensure_accounts` runs last because the joint
    account is infrastructure the app expects to exist, not data somebody entered.
    """
    deleted = {}
    for table in _target_tables():
        removed = db.execute(delete(table)).rowcount or 0
        if removed:
            deleted[table.name] = removed
    money.ensure_accounts(db)
    db.commit()
    return deleted


def main(
    argv: list[str] | None = None,
    *,
    prompt: Callable[[str], str] = input,
    db_factory: Callable[[], AbstractContextManager] = get_db,
) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        FLAG,
        dest="confirmed",
        action="store_true",
        help="Required. Without it the script only reports what it would delete.",
    )
    args = parser.parse_args(argv)

    with db_factory() as db:
        before = counts(db)
        total = sum(before.values())
        for name, rows in sorted(before.items()):
            logger.info("reset_would_delete table=%s rows=%d", name, rows)
        logger.info("reset_total rows=%d confirmed=%s", total, args.confirmed)

        if not args.confirmed:
            logger.warning("reset_skipped reason=flag_missing flag=%s", FLAG)
            return 1
        if total and prompt(f"Type {CONFIRM_PHRASE} to erase {total} rows: ") != CONFIRM_PHRASE:
            raise ResetAborted("confirmation phrase did not match; nothing was deleted")

        deleted = reset(db)

    logger.info("reset_complete tables=%d rows=%d", len(deleted), sum(deleted.values()))
    return 0


if __name__ == "__main__":  # pragma: no cover - module entry point
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    sys.exit(main())
