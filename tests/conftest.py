"""
Pytest configuration.

Environment is resolved in this order:
  1. Real environment variables (CI sets these)
  2. A local .env file, if present
  3. The fallbacks below, so import-only tests run with no setup at all

Database-backed tests need a Postgres with `alembic upgrade head` already applied.
CI does that as a build step; locally `make db-upgrade` does it.
"""

import os
import uuid
from collections.abc import Generator

import pytest
from dotenv import load_dotenv
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

# Only to discover where this machine's database lives.
load_dotenv()

# DATABASE_URL is the one setting allowed to vary per machine: CI has a service
# container, a developer has Docker on whatever port was free.
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test")

# Everything else is *forced*, never defaulted. A developer's .env holds real runtime
# values - a populated ALLOWED_MEMBER_EMAILS, a real Firebase project - and letting
# those reach the suite makes tests pass or fail based on which machine ran them.
os.environ["APP_ENV"] = "test"
os.environ["APP_ROLE"] = "test"
os.environ["DEBUG"] = "false"
os.environ["DIRECT_DATABASE_URL"] = ""
os.environ["FIREBASE_PROJECT_ID"] = "test-firebase-project"
# Blank means "any authenticated user", which keeps route tests focused. The allowlist
# itself is covered explicitly in test_members.py and test_config.py.
os.environ["ALLOWED_MEMBER_EMAILS"] = ""
os.environ["ALLOWED_ORIGINS"] = "http://localhost:3000,http://localhost:5173"
os.environ["ALLOWED_ORIGIN_REGEX"] = ""
os.environ["SENTRY_DSN"] = ""
# Blank so no test can reach a real API. The one suite that needs it sets it itself.
os.environ["GEMINI_API_KEY"] = ""
# Pinned so an assertion about the request URL does not change when the default does.
os.environ["GEMINI_MODEL"] = "gemini-flash-lite-latest"

from src.auth import get_current_user  # noqa: E402
from src.database import engine  # noqa: E402
from src.dependencies import db_session  # noqa: E402
from src.main import app  # noqa: E402
from src.models.taxonomy import Game, ProductType  # noqa: E402


@pytest.fixture
def db() -> Generator[Session, None, None]:
    """A session inside a transaction that is always rolled back.

    Tests share one migrated database and never see each other's writes.
    """
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture
def claims() -> dict:
    """Firebase token claims for the signed-in user. Mutate to change identity."""
    return {
        "sub": f"firebase-uid-{uuid.uuid4()}",
        "email": "patrick@example.com",
        "name": "Patrick",
    }


@pytest.fixture
def client(db: Session, claims: dict) -> Generator[TestClient, None, None]:
    """API client with the database and token verification stubbed out.

    Token *verification* is covered directly in test_auth.py; here we care about what
    the routes do once a caller is authenticated.
    """
    app.dependency_overrides[db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: claims
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def game_id(db: Session) -> uuid.UUID:
    return db.scalar(select(Game.id).where(Game.slug == "pokemon"))


@pytest.fixture
def product_type_id(db: Session) -> uuid.UUID:
    return db.scalar(select(ProductType.id).where(ProductType.slug == "booster-box"))


@pytest.fixture
def make_product(client: TestClient, game_id: uuid.UUID, product_type_id: uuid.UUID):
    """Create a product through the API and return its JSON."""

    def _make(name: str = "Vivid Voltage Booster Box", **overrides) -> dict:
        payload = {
            "name": name,
            "game_id": str(game_id),
            "product_type_id": str(product_type_id),
            **overrides,
        }
        response = client.post("/api/v1/products", json=payload)
        assert response.status_code == 201, response.text
        return response.json()

    return _make
