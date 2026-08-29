"""Do two connection URLs reach the same database?

The URL is not a database identity. Hostname aliases, alternate schemes, and pooler
endpoints can all describe the same data. The restore script therefore asks each server
for an identity after connecting and uses URL parsing only as a small, offline helper for
diagnostics. The caller still requires an explicit destructive confirmation for *every*
restore; this comparison is defence in depth, not permission to drop a schema.
"""

import socket
import subprocess
import sys
from urllib.parse import urlsplit


def _resolved_hosts(host: str) -> tuple[str, ...]:
    """Resolve aliases to comparable addresses without failing on offline diagnostics."""
    try:
        addresses = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except OSError:
        return (host,)
    resolved = {item[4][0] for item in addresses if item[4]}
    return tuple(sorted(resolved)) or (host,)


def where(url: str) -> tuple[tuple[str, ...], int, str]:
    """Best-effort offline location, useful for diagnostics but not restore authorization."""
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    return _resolved_hosts(host), parts.port or 5432, parts.path.lstrip("/")


_IDENTITY_QUERY = """
SELECT current_database(),
       (SELECT oid::text FROM pg_database WHERE datname = current_database()),
       coalesce(inet_server_addr()::text, 'local'),
       coalesce(inet_server_port()::text, 'local');
""".strip()


def connected_identity(url: str) -> tuple[str, str, str, str]:
    """Return identity observed by PostgreSQL, never inferred from the URL.

    The database OID distinguishes databases with the same name on one server. The server
    address and port are retained for diagnostics, but can legitimately differ when the
    same database is reached through a Unix socket, proxy, or alternate interface. All
    values come from a successful `psql` connection, and no command output is included in
    raised errors so a password embedded in a connection URL cannot leak into logs.
    """
    try:
        result = subprocess.run(
            [
                "psql",
                url,
                "-X",
                "-qAt",
                "-v",
                "ON_ERROR_STOP=1",
                "-c",
                _IDENTITY_QUERY,
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RuntimeError("could not connect to determine database identity") from error

    if result.returncode != 0:
        raise RuntimeError("could not connect to determine database identity")

    rows = [line for line in result.stdout.splitlines() if line.strip()]
    fields = rows[0].split("\t") if len(rows) == 1 else []
    if len(fields) != 4 or any(not field.strip() for field in fields):
        raise RuntimeError("database returned an unusable identity")
    return tuple(field.strip() for field in fields)  # type: ignore[return-value]


def same_database(target: str, source: str) -> bool:
    """Compare the stable database identity obtained from both live connections.

    Server address and port are intentionally not part of the equality check: one logical
    database can report different values through a Unix socket, proxy, or alternate
    network interface. A match is conservative for restore safety because it requires the
    operator's separate same-database confirmation in addition to the per-run confirmation.
    """
    target_identity = connected_identity(target)
    source_identity = connected_identity(source)
    return target_identity[:2] == source_identity[:2]


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: _same_database.py TARGET_URL SOURCE_URL", file=sys.stderr)
        raise SystemExit(2)
    try:
        print("same" if same_database(sys.argv[1], sys.argv[2]) else "different")
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2) from error
