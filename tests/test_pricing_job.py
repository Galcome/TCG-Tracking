"""Tests for the private Railway Cron pricing worker."""

from contextlib import contextmanager

import pytest
from sqlalchemy.exc import SQLAlchemyError

from src.jobs import pricing_refresh as job
from src.services import pricing, set_sync


class FakeDB:
    pass


def summary(*, systemic_failure=False, errors=()):
    return pricing.RefreshSummary(1, 1, 0, 0, 0, "revision", tuple(errors), systemic_failure)


def test_run_returns_success_and_keeps_item_warnings_visible(caplog):
    seen = []

    @contextmanager
    def database():
        yield FakeDB()

    def refresh(db):
        seen.append(db)
        return summary(errors=("one mapping unavailable",))

    result = job.run(refresh_fn=refresh, db_factory=database, sleep=seen.append)
    assert result.errors == ("one mapping unavailable",)
    assert len(seen) == 1
    assert "pricing_refresh_item_errors" in caplog.text


@pytest.mark.parametrize("attempts", [0, job.MAX_ATTEMPTS + 1])
def test_run_rejects_unbounded_attempt_configuration(attempts):
    with pytest.raises(ValueError, match="attempts"):
        job.run(attempts=attempts)


def test_run_retries_busy_lock_then_succeeds():
    outcomes = iter(
        [pricing.PricingRefreshBusy("busy"), pricing.PricingRefreshBusy("busy"), summary()]
    )
    delays = []

    def refresh(_db):
        outcome = next(outcomes)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome

    result = job.run(
        refresh_fn=refresh,
        db_factory=lambda: _database(),
        sleep=delays.append,
    )
    assert result.refreshed == 1
    assert delays == list(job.RETRY_DELAYS_SECONDS)


def test_run_retries_a_pricing_error_then_succeeds():
    outcomes = iter([pricing.PricingError("provider unavailable"), summary()])
    delays = []

    def refresh(_db):
        outcome = next(outcomes)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome

    result = job.run(
        refresh_fn=refresh,
        db_factory=lambda: _database(),
        sleep=delays.append,
    )
    assert result.refreshed == 1
    assert delays == [job.RETRY_DELAYS_SECONDS[0]]


def test_run_retries_systemic_failure_then_succeeds():
    outcomes = iter([summary(systemic_failure=True), summary()])
    delays = []

    def refresh(_db):
        return next(outcomes)

    result = job.run(refresh_fn=refresh, db_factory=lambda: _database(), sleep=delays.append)
    assert result.refreshed == 1
    assert delays == [job.RETRY_DELAYS_SECONDS[0]]


def test_run_retries_database_error_and_fails_after_bound():
    delays = []

    def refresh(_db):
        raise SQLAlchemyError("database unavailable")

    with pytest.raises(job.PricingJobError, match="after 2 attempts"):
        job.run(
            refresh_fn=refresh,
            db_factory=lambda: _database(),
            sleep=delays.append,
            attempts=2,
        )
    assert delays == [job.RETRY_DELAYS_SECONDS[0]]


def test_main_requires_worker_role(monkeypatch):
    monkeypatch.setattr(job.settings, "app_role", "api")
    assert job.main() == 2


def test_main_returns_failure_when_worker_exhausts_retries(monkeypatch):
    monkeypatch.setattr(job.settings, "app_role", "worker")
    monkeypatch.setattr(job, "sync_sets", lambda: None)
    monkeypatch.setattr(job, "run", lambda: (_ for _ in ()).throw(job.PricingJobError("bad")))
    assert job.main() == 1


def test_main_returns_success_for_worker(monkeypatch):
    order = []
    monkeypatch.setattr(job.settings, "app_role", "worker")
    monkeypatch.setattr(job, "sync_sets", lambda: order.append("sets"))
    monkeypatch.setattr(job, "run", lambda: order.append("prices") or summary())
    assert job.main() == 0
    # New sets are linked before prices refresh, so a fresh release is priced the same day.
    assert order == ["sets", "prices"]


def test_sync_sets_logs_its_summary(caplog):
    result = set_sync.SyncSummary(11, 3, 2, ())
    caplog.set_level("INFO", logger=job.logger.name)

    assert job.sync_sets(sync_fn=lambda _db: result, db_factory=_database) is result
    assert "set_sync_complete games=11 created=3 linked=2 errors=0" in caplog.text
    assert "set_sync_game_errors" not in caplog.text


def test_sync_sets_surfaces_per_game_errors(caplog):
    result = set_sync.SyncSummary(11, 0, 0, ("pokemon: timed out",))

    assert job.sync_sets(sync_fn=lambda _db: result, db_factory=_database) is result
    assert "pokemon: timed out" in caplog.text


@pytest.mark.parametrize(
    "error", [pricing.PricingError("catalog down"), SQLAlchemyError("connection lost")]
)
def test_sync_sets_failure_never_blocks_the_price_refresh(caplog, error):
    def failing(_db):
        raise error

    assert job.sync_sets(sync_fn=failing, db_factory=_database) is None
    assert f"set_sync_failed error={type(error).__name__}" in caplog.text


@contextmanager
def _database():
    yield FakeDB()
