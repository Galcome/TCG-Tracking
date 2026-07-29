"""Create and migrate a throwaway database for the end-to-end suite.

The suite drives the real app, so it writes real rows. Pointing it at the development
database means the next `pytest` run fails on store-wide aggregates that now include
browser-test data - which is exactly what happened the first time this suite was run.

So it gets its own database, derived from DATABASE_URL by suffixing the name, and this
module refuses to touch anything whose name does not say `e2e`. That guard is the whole
point: this module drops nothing, but it does hand a URL to a suite that will happily fill
it with fixtures.

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

    print(url)


if __name__ == "__main__":
    main()
