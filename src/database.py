"""Database connection and session management."""

import logging
from collections.abc import Generator
from contextlib import contextmanager

from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import NullPool

from src.config import settings

logger = logging.getLogger(__name__)

# Neon suspends compute only when there are zero open connections. A persistent
# client-side pool would hold connections open around the clock and burn the free
# tier's monthly compute allowance while nobody is using the app, so we deliberately
# do not pool: each request opens and closes its own connection, and Neon suspends
# after its idle timeout. Neon's own PgBouncer sits in front of Postgres and does the
# real pooling, so this costs a TCP+TLS handshake per request, not a backend spawn.
#
# If this ever moves to an always-on database, swap NullPool back for QueuePool.
CONNECT_TIMEOUT_SECONDS = 10

engine = create_engine(
    settings.database_url,
    poolclass=NullPool,
    echo=settings.debug,
    connect_args={
        # PgBouncer transaction-mode pooling does not support prepared statements.
        "prepare_threshold": None,
        # Neon cold-starts a suspended compute on first connect; fail fast rather
        # than hanging a request forever if it cannot be reached.
        "connect_timeout": CONNECT_TIMEOUT_SECONDS,
    },
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    """Base class for all ORM models. Import and inherit to define a table."""

    pass


@contextmanager
def get_db() -> Generator[Session, None, None]:
    """Yield a database session. Commits on success, rolls back on error."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        try:
            db.rollback()
        except SQLAlchemyError as exc:
            logger.warning("Database rollback failed during cleanup: %s", type(exc).__name__)
            db.invalidate()
        raise
    finally:
        try:
            db.close()
        except SQLAlchemyError as exc:
            logger.warning("Database session close failed during cleanup: %s", type(exc).__name__)
            db.invalidate()


def check_connection() -> bool:
    """Return True if the database is reachable."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as exc:
        logger.error("Database connection check failed: %s", type(exc).__name__)
        return False
