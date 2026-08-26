"""Do two connection URLs point at the same database?

Used by restore-backup.sh before it drops a schema. Comparing the URLs as text is
not enough - the same database reached as `postgresql://` or `postgres://`, with a
different sslmode, or through a pooler hostname, is textually different and would
pass a string comparison while being the very database we must not destroy.
"""

import sys
from urllib.parse import urlsplit


def where(url: str) -> tuple[str, int, str]:
    """Host, port and database name - what actually identifies a database."""
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    # A pooler endpoint is the same database as its direct endpoint, and Neon
    # spells that difference with a hostname suffix. Treat them as one place.
    host = host.replace("-pooler", "")
    return host, parts.port or 5432, parts.path.lstrip("/")


if __name__ == "__main__":
    target, source = sys.argv[1], sys.argv[2]
    print("same" if where(target) == where(source) else "different")
