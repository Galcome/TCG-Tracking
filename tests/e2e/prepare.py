"""Create and migrate a throwaway database for the end-to-end suite.

The suite drives the real app, so it writes real rows. Pointing it at the development
database means the next `pytest` run fails on store-wide aggregates that now include
browser-test data - which is exactly what happened the first time this suite was run.

So it gets its own database, derived from DATABASE_URL by suffixing the name, and this
module refuses to touch anything whose name does not say `e2e`. That guard is the whole
point: everything below is destructive, and it must never reach a real database.

The data tables are emptied before each run. Left to accumulate, the suite's own fixtures
made every page slower than the run before - `list_products` computes stats for every
matching product before paging, so a few hundred leftover rows eventually pushed page loads
past the assertion timeout and the suite started failing a different test each time. A
flaky suite is worse than no suite, because it teaches you to ignore it.

Run before the e2e server starts:
    uv run python -m tests.e2e.prepare
"""

import os
import subprocess
import sys
from urllib.parse import urlparse, urlunparse

import sqlalchemy
from sqlalchemy import text

#: Appended to the development database's name to get the throwaway one.
SUFFIX = "_e2e"


def e2e_url(base_url: str) -> str:
    """The e2e database URL derived from a normal one, same server, different database."""
    parsed = urlparse(base_url)
    name = parsed.path.lstrip("/")
    if not name:
        raise SystemExit("DATABASE_URL has no database name")
    if name.endswith(SUFFIX):
        return base_url
    return urlunparse(parsed._replace(path=f"/{name}{SUFFIX}"))


def ensure_database(url: str) -> None:
    """Create the database if it is missing. Never drops, never touches a non-e2e name."""
    parsed = urlparse(url)
    name = parsed.path.lstrip("/")
    if SUFFIX.strip("_") not in name:
        raise SystemExit(f"refusing to manage {name!r}: an e2e database must be named for it")

    # Connect to the maintenance database; CREATE DATABASE cannot run inside a transaction.
    admin = urlunparse(parsed._replace(path="/postgres"))
    engine = sqlalchemy.create_engine(admin, isolation_level="AUTOCOMMIT")
    with engine.connect() as connection:
        exists = connection.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": name}
        ).scalar()
        if not exists:
            # Identifier, so it cannot be a bound parameter. The name is derived from
            # DATABASE_URL and validated above, never from user input.
            connection.execute(text(f'CREATE DATABASE "{name}"'))
            print(f"created {name}")
    engine.dispose()


def resolve() -> str:
    """The e2e database URL, however DATABASE_URL was supplied.

    Reads it through the app's own settings rather than os.environ, because locally it
    lives in .env and only pydantic-settings knows that.
    """
    if override := os.environ.get("E2E_DATABASE_URL"):
        return override

    from src.config import settings

    return e2e_url(settings.database_url)


#: Emptied before every run, children first. Taxonomy and the seeded set calendar are
#: left alone: they come from migrations, not from the suite.
DATA_TABLES = (
    "money_postings",
    "money_movements",
    "money_accounts",
    "cost_allocations",
    "stock_moves",
    "inventory_adjustments",
    "sales",
    "purchases",
    "audit_log",
    "products",
)


def clear_data(url: str) -> None:
    """Empty the suite's own rows so each run starts from the same place."""
    name = urlparse(url).path.lstrip("/")
    if SUFFIX.strip("_") not in name:
        raise SystemExit(f"refusing to clear {name!r}: an e2e database must be named for it")

    engine = sqlalchemy.create_engine(url)
    with engine.begin() as connection:
        # One statement so foreign keys between them never block the order.
        connection.execute(text(f"TRUNCATE {', '.join(DATA_TABLES)} CASCADE"))
        # Sets somebody's product created, but not the seeded calendar.
        connection.execute(text("DELETE FROM card_sets WHERE released_on IS NULL"))
    engine.dispose()


def main() -> None:
    url = resolve()
    ensure_database(url)

    migrate = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        env={**os.environ, "DATABASE_URL": url, "DIRECT_DATABASE_URL": ""},
        check=False,
    )
    if migrate.returncode != 0:
        raise SystemExit("migrations failed against the e2e database")

    clear_data(url)
    print(url)


if __name__ == "__main__":
    main()
