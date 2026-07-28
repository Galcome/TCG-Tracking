"""Database connection and session management."""

import logging
from collections.abc import Generator
from contextlib import contextmanager

from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from src.config import settings

logger = logging.getLogger(__name__)

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_timeout=settings.db_pool_timeout_seconds,
    pool_recycle=settings.db_pool_recycle_seconds,
    pool_use_lifo=True,
    echo=settings.debug,
    # PgBouncer/Supavisor transaction-mode poolers do not support prepared statements.
    # Keep this off by default so a pasted transaction-pooler URL does not take the app down.
    connect_args={"prepare_threshold": None},
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
