"""Railway Cron entry point for the daily display-only market refresh.

This process is a private Railway service, not a public HTTP endpoint. It receives the
same secret Neon ``DATABASE_URL`` as the API, requires ``APP_ROLE=worker``, and calls the
pricing service directly. PostgreSQL's transaction advisory lock protects against an
overlapping run. The API service remains the only service that runs migrations.
"""

from __future__ import annotations

import logging
import sys
import time
from collections.abc import Callable
from contextlib import AbstractContextManager
from typing import Protocol

from sqlalchemy.exc import SQLAlchemyError

from src.config import settings
from src.database import get_db
from src.services import pricing

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
RETRY_DELAYS_SECONDS = (5.0, 15.0)


class RefreshFn(Protocol):
    def __call__(self, db) -> pricing.RefreshSummary: ...


class PricingJobError(RuntimeError):
    """The bounded worker retry policy was exhausted."""


def _log_summary(summary: pricing.RefreshSummary) -> None:
    logger.info(
        "pricing_refresh_complete attempted=%d refreshed=%d skipped=%d stale=%d "
        "unavailable=%d source_revision=%s systemic_failure=%s errors=%d",
        summary.attempted,
        summary.refreshed,
        summary.skipped,
        summary.stale,
        summary.unavailable,
        summary.source_revision or "none",
        summary.systemic_failure,
        len(summary.errors),
    )
    if summary.errors:
        # Error messages are provider/service text, not request data. Keep them visible in
        # Railway logs without logging URLs, credentials, or raw provider responses.
        logger.warning(
            "pricing_refresh_item_errors count=%d messages=%s",
            len(summary.errors),
            summary.errors,
        )


def run(
    *,
    refresh_fn: RefreshFn = pricing.refresh,
    db_factory: Callable[[], AbstractContextManager] = get_db,
    sleep: Callable[[float], None] = time.sleep,
    attempts: int = MAX_ATTEMPTS,
) -> pricing.RefreshSummary:
    """Run once with bounded retries for lock, DB, marker, and FX failures."""
    if attempts < 1 or attempts > MAX_ATTEMPTS:
        raise ValueError(f"attempts must be between 1 and {MAX_ATTEMPTS}")

    last_error: BaseException | None = None
    for attempt in range(1, attempts + 1):
        try:
            with db_factory() as db:
                summary = refresh_fn(db)
            _log_summary(summary)
            if summary.systemic_failure:
                raise PricingJobError(
                    "pricing provider or exchange-rate refresh failed systemically"
                )
            return summary
        except PricingJobError as error:
            last_error = error
            logger.warning(
                "pricing_refresh_systemic_failure attempt=%d/%d", attempt, attempts
            )
        except pricing.PricingRefreshBusy as error:
            last_error = error
            logger.warning("pricing_refresh_busy attempt=%d/%d", attempt, attempts)
        except pricing.PricingError as error:
            last_error = error
            logger.warning(
                "pricing_refresh_failed attempt=%d/%d error=%s", attempt, attempts, error
            )
        except SQLAlchemyError as error:
            last_error = error
            logger.warning(
                "pricing_refresh_database_failed attempt=%d/%d error=%s",
                attempt,
                attempts,
                type(error).__name__,
            )

        if attempt < attempts:
            sleep(RETRY_DELAYS_SECONDS[min(attempt - 1, len(RETRY_DELAYS_SECONDS) - 1)])

    detail = str(last_error) if last_error is not None else "unknown failure"
    raise PricingJobError(
        f"pricing refresh failed after {attempts} attempts: {detail}"
    ) from last_error


def main() -> int:
    """Run only when Railway has explicitly assigned this process the worker role."""
    if settings.app_role != "worker":
        logger.error("pricing_refresh_refused app_role=%s expected=worker", settings.app_role)
        return 2
    try:
        run()
    except PricingJobError as error:
        logger.error("pricing_refresh_aborted error=%s", error)
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised by Railway, not import tests
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    sys.exit(main())


__all__ = [
    "MAX_ATTEMPTS",
    "PricingJobError",
    "RETRY_DELAYS_SECONDS",
    "main",
    "run",
]
