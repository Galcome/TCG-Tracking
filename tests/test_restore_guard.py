"""The restore guard compares identities observed by PostgreSQL, not URL spelling."""

import importlib.util
from pathlib import Path


def _guard_module():
    path = Path(__file__).parents[1] / "scripts" / "_same_database.py"
    spec = importlib.util.spec_from_file_location("same_database_guard", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_connected_identity_uses_a_parameterless_psql_query_without_logging_output(
    monkeypatch,
):
    guard = _guard_module()
    seen = {}

    class Result:
        returncode = 0
        stdout = "cards\t16384\t10.0.0.3\t5432\n"

    def run(command, **kwargs):
        seen["command"] = command
        seen["kwargs"] = kwargs
        return Result()

    monkeypatch.setattr(guard.subprocess, "run", run)

    assert guard.connected_identity("postgresql://user:secret@example.invalid/cards") == (
        "cards",
        "16384",
        "10.0.0.3",
        "5432",
    )
    assert seen["command"][0:2] == ["psql", "postgresql://user:secret@example.invalid/cards"]
    assert seen["kwargs"]["capture_output"] is True
    assert seen["kwargs"]["text"] is True
    assert seen["kwargs"]["timeout"] == 15


def test_alias_urls_are_same_when_the_server_reports_the_same_identity(monkeypatch):
    guard = _guard_module()
    identities = iter(
        [
            "cards\t16384\t127.0.0.1\t5432\n",
            "cards\t16384\t127.0.0.1\t5432\n",
        ]
    )

    monkeypatch.setattr(
        guard.subprocess,
        "run",
        lambda *args, **kwargs: type("Result", (), {"returncode": 0, "stdout": next(identities)})(),
    )

    assert guard.same_database(
        "postgresql://user:secret@localhost/cards",
        "postgres://user:secret@127.0.0.1/cards?sslmode=require",
    )


def test_identity_failure_is_not_treated_as_different(monkeypatch):
    guard = _guard_module()

    class Result:
        returncode = 1
        stdout = ""

    monkeypatch.setattr(guard.subprocess, "run", lambda *args, **kwargs: Result())

    try:
        guard.connected_identity("postgresql://user:secret@example.invalid/cards")
    except RuntimeError as error:
        assert str(error) == "could not connect to determine database identity"
    else:  # pragma: no cover - assertion keeps the failure explicit
        raise AssertionError("an unusable identity must fail closed")
