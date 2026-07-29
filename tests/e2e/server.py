"""The real API, with token verification stubbed, for the end-to-end suite.

Everything the browser talks to here is production code: the same FastAPI app, the same
routes, the same SQLAlchemy models against a real Postgres carrying real migrations, the
same FIFO engine. The single override is `get_current_user`, which normally verifies a
Firebase ID token against Google's JWKS - there is no way to obtain a genuine one in CI,
and forging one would mean weakening `src/auth.py`, which stays untouched.

Run with:
    uv run uvicorn tests.e2e.server:app --port 8001
"""

import uuid

from src.config import settings
from tests.e2e.prepare import resolve

# Redirect to the throwaway database before src.database builds the engine at import time.
#
# Setting os.environ here would be too late and silently do nothing: `settings` is a
# module-level instance, already constructed by the time this line runs, and
# src.database reads the object rather than the environment. That mistake put a full
# browser run's worth of rows in the development database.
settings.database_url = resolve()
settings.direct_database_url = None

from src.auth import get_current_user  # noqa: E402
from src.main import app  # noqa: E402

#: Stable so repeated runs provision one member rather than a new one per request.
E2E_CLAIMS = {
    "sub": f"e2e-{uuid.UUID(int=1)}",
    "email": "e2e@example.test",
    "name": "E2E Tester",
}


def _claims() -> dict:
    return E2E_CLAIMS


app.dependency_overrides[get_current_user] = _claims

__all__ = ["E2E_CLAIMS", "app"]
