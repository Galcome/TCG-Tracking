"""The restore guard compares identities observed by PostgreSQL, not URL spelling."""

import importlib.util
import subprocess
from pathlib import Path


def _guard_module():
    path = Path(__file__).parents[1] / "scripts" / "_same_database.py"
    spec = importlib.util.spec_from_file_location("same_database_guard", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _run_restore(*, confirm=False, allow_same=False, same_database=False):
    repository = Path(__file__).parents[1]
    assignments = [
        "BACKUP_ENCRYPTION_PASSPHRASE=test-passphrase",
        "RESTORE_TARGET_URL=postgresql://scratch@localhost/scratch",
        "R2_BUCKET=test-bucket",
        "R2_ENDPOINT=https://example.invalid",
    ]
    if confirm:
        assignments.append("RESTORE_CONFIRM=DROP_TARGET_SCHEMA")
    if allow_same:
        assignments.append("RESTORE_ALLOW_SAME_DATABASE=i-know")
    if same_database:
        assignments.append("BACKUP_DATABASE_URL=postgresql://source@localhost/source")
    command = " ".join(assignments) + " ./scripts/restore-backup.sh"
    if same_database:
        # The script's identity helper is invoked as `python3`; export a shell function so
        # this behavior test never needs a real database or a filesystem executable stub.
        command = "python3() { printf 'same\\n'; }; export -f python3; " + command
    return subprocess.run(
        ["bash", "-lc", command],
        cwd=repository,
        capture_output=True,
        text=True,
        timeout=5,
    )


def test_restore_requires_per_run_confirmation_before_external_tools_run():
    result = _run_restore()

    assert result.returncode != 0
    assert "RESTORE_CONFIRM=DROP_TARGET_SCHEMA" in result.stderr


def test_same_database_override_cannot_replace_per_run_confirmation():
    result = _run_restore(allow_same=True)

    assert result.returncode != 0
    assert "RESTORE_CONFIRM=DROP_TARGET_SCHEMA" in result.stderr


def test_same_database_restore_requires_a_second_confirmation():
    result = _run_restore(confirm=True, same_database=True)

    assert result.returncode != 0
    assert "RESTORE_ALLOW_SAME_DATABASE=i-know" in result.stderr
    assert "==> Restoring" not in result.stdout


def test_backup_workflow_keeps_the_explicit_restore_confirmation():
    workflow = Path(__file__).parents[1] / ".github" / "workflows" / "backup.yml"

    assert "RESTORE_CONFIRM: DROP_TARGET_SCHEMA" in workflow.read_text(encoding="utf-8")


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


def test_same_database_ignores_connection_interface_for_the_same_database(monkeypatch):
    guard = _guard_module()
    identities = iter(
        [
            "cards\t16384\t127.0.0.1\t5432\n",
            "cards\t16384\tlocal\tlocal\n",
        ]
    )

    monkeypatch.setattr(
        guard.subprocess,
        "run",
        lambda *args, **kwargs: type("Result", (), {"returncode": 0, "stdout": next(identities)})(),
    )

    assert guard.same_database(
        "postgresql://user:secret@localhost/cards",
        "postgresql:///cards",
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
